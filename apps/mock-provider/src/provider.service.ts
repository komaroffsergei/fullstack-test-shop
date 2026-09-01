import { HttpException, Injectable } from '@nestjs/common';
import { ProviderId, prisma } from '@shop/database';

@Injectable()
/** Одна реализация mock-provider запускается как независимые экземпляры A и B. */
export class ProviderService {
  readonly providerId: ProviderId;

  /** Валидирует идентичность экземпляра из окружения при старте, а не при первом запросе. */
  constructor() {
    const configured = process.env.PROVIDER_ID;
    if (configured !== 'A' && configured !== 'B') throw new Error('PROVIDER_ID must be A or B');
    this.providerId = configured;
  }

  /**
   * Резервирует максимум один код на request_id и воспроизводит заданный режим отказа.
   * Повтор того же request_id всегда возвращает уже закреплённый код.
   */
  async issue(input: { request_id: string; sku: string; order_id: string }) {
    // Быстрый replay нужен после потери HTTP-ответа: второй код не расходуется.
    const existing = await prisma.providerKey.findUnique({
      where: { requestId: input.request_id },
    });
    if (existing) return this.success(input.request_id, existing.code);

    const settings = await prisma.providerSetting.findUniqueOrThrow({
      where: { providerId: this.providerId },
    });
    // Эти два режима однозначно происходят до резервирования кода.
    if (settings.faultMode === 'server_error_before_issue') {
      throw new HttpException({ status: 'error', reason: 'provider_unavailable' }, 503);
    }
    if (settings.faultMode === 'out_of_stock') {
      throw new HttpException({ status: 'error', reason: 'out_of_stock' }, 409);
    }

    const reserved = await prisma.$transaction(async (tx) => {
      // Повторная проверка закрывает гонку между быстрым чтением и входом в транзакцию.
      const prior = await tx.providerKey.findUnique({ where: { requestId: input.request_id } });
      if (prior) return prior;
      // SKIP LOCKED позволяет нескольким запросам брать разные свободные ключи параллельно.
      const [candidate] = await tx.$queryRaw<Array<{ id: bigint }>>`
        SELECT id FROM provider_keys
        WHERE provider_id = ${this.providerId}::"ProviderId"
          AND sku = ${input.sku} AND issued_at IS NULL
        ORDER BY id LIMIT 1 FOR UPDATE SKIP LOCKED
      `;
      if (!candidate) return null;
      // requestId записывается вместе с issuedAt до формирования HTTP-ответа.
      return tx.providerKey.update({
        where: { id: candidate.id },
        data: { requestId: input.request_id, issuedAt: new Date() },
      });
    });

    if (!reserved) throw new HttpException({ status: 'error', reason: 'out_of_stock' }, 409);
    if (settings.faultMode === 'timeout_after_issue') {
      // Ключ уже закреплён: задержка имитирует потерянный ответ после реальной выдачи.
      await new Promise((resolve) => setTimeout(resolve, settings.delayMs));
    }
    return this.success(input.request_id, reserved.code);
  }

  /** Формирует единый успешный контракт поставщика. */
  private success(requestId: string, code: string) {
    return { status: 'ok', request_id: requestId, code };
  }
}
