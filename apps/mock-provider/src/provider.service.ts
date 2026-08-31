import { HttpException, Injectable } from '@nestjs/common';
import { ProviderId, prisma } from '@shop/database';

@Injectable()
export class ProviderService {
  readonly providerId: ProviderId;

  constructor() {
    const configured = process.env.PROVIDER_ID;
    if (configured !== 'A' && configured !== 'B') throw new Error('PROVIDER_ID must be A or B');
    this.providerId = configured;
  }

  async issue(input: { request_id: string; sku: string; order_id: string }) {
    const existing = await prisma.providerKey.findUnique({
      where: { requestId: input.request_id },
    });
    if (existing) return this.success(input.request_id, existing.code);

    const settings = await prisma.providerSetting.findUniqueOrThrow({
      where: { providerId: this.providerId },
    });
    if (settings.faultMode === 'server_error_before_issue') {
      throw new HttpException({ status: 'error', reason: 'provider_unavailable' }, 503);
    }
    if (settings.faultMode === 'out_of_stock') {
      throw new HttpException({ status: 'error', reason: 'out_of_stock' }, 409);
    }

    const reserved = await prisma.$transaction(async (tx) => {
      const prior = await tx.providerKey.findUnique({ where: { requestId: input.request_id } });
      if (prior) return prior;
      const [candidate] = await tx.$queryRaw<Array<{ id: bigint }>>`
        SELECT id FROM provider_keys
        WHERE provider_id = ${this.providerId}::"ProviderId"
          AND sku = ${input.sku} AND issued_at IS NULL
        ORDER BY id LIMIT 1 FOR UPDATE SKIP LOCKED
      `;
      if (!candidate) return null;
      return tx.providerKey.update({
        where: { id: candidate.id },
        data: { requestId: input.request_id, issuedAt: new Date() },
      });
    });

    if (!reserved) throw new HttpException({ status: 'error', reason: 'out_of_stock' }, 409);
    if (settings.faultMode === 'timeout_after_issue') {
      await new Promise((resolve) => setTimeout(resolve, settings.delayMs));
    }
    return this.success(input.request_id, reserved.code);
  }

  private success(requestId: string, code: string) {
    return { status: 'ok', request_id: requestId, code };
  }
}
