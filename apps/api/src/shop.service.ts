import {
  ConflictException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from '@nestjs/common';
import {
  INITIAL_PROVIDER_KEY_ROWS,
  Prisma,
  ProviderFaultMode,
  ProviderId,
  prisma,
} from '@shop/database';
import { calculatePrice, fingerprintOrder } from '@shop/domain';
import { randomUUID } from 'node:crypto';
import type {
  AddProviderKeysDto,
  CreateOrderDto,
  PaymentWebhookDto,
  ProviderModeDto,
  QuotePromoDto,
} from './dto';
import { MetricsService } from './metrics.service';

type LockedPromo = {
  id: bigint;
  code: string;
  type: 'percent' | 'amount';
  value: number;
  currency: string | null;
  max_uses: number;
  used_count: number;
  active: boolean;
};

@Injectable()
/** Сервис прикладных сценариев магазина: каталог, заказы, inbox, промокоды и recovery. */
export class ShopService {
  /** Получает реестр метрик через dependency injection NestJS. */
  constructor(private readonly metrics: MetricsService) {}

  /** Возвращает только активные товары и переводит цену в удобный для UI read model. */
  async catalog() {
    const products = await prisma.product.findMany({
      where: { active: true },
      orderBy: { id: 'asc' },
    });
    return products.map((product) => ({
      sku: product.sku,
      name: product.name,
      type: product.type,
      priceMinor: product.priceMinor,
      price: product.priceMinor / 100,
      currency: product.currency,
      image: product.image,
    }));
  }

  /**
   * Создаёт заказ ровно один раз для одного Idempotency-Key.
   * Цена, промокод и аудит фиксируются в одной короткой транзакции PostgreSQL.
   */
  async createOrder(input: CreateOrderDto, idempotencyKey: string) {
    if (!idempotencyKey || idempotencyKey.length > 200) {
      throw new UnprocessableEntityException('Idempotency-Key is required');
    }
    const fingerprint = fingerprintOrder(input);
    // Быстрый путь повторного запроса не открывает транзакцию.
    const existing = await prisma.order.findUnique({ where: { idempotencyKey } });
    if (existing) return this.validateReplay(existing, fingerprint);

    try {
      const created = await prisma.$transaction(async (tx) => {
        // Клиент передаёт только SKU: доверенная цена всегда читается из каталога БД.
        const product = await tx.product.findUnique({ where: { sku: input.sku } });
        if (!product?.active) throw new NotFoundException('Product not found');

        let promo: LockedPromo | undefined;
        if (input.promoCode) {
          const normalized = input.promoCode.trim().toUpperCase();
          // FOR UPDATE сериализует конкурирующие применения ограниченного промокода.
          [promo] = await tx.$queryRaw<LockedPromo[]>`
              SELECT id, code, type::text, value, currency, max_uses, used_count, active
              FROM promocodes WHERE code = ${normalized} FOR UPDATE
            `;
          if (!promo?.active) throw new UnprocessableEntityException('Promocode is invalid');
          if (promo.used_count >= promo.max_uses) {
            throw new ConflictException('Promocode usage limit reached');
          }
          if (promo.currency && promo.currency !== product.currency) {
            throw new UnprocessableEntityException('Promocode currency does not match');
          }
        }

        const price = calculatePrice(
          product.priceMinor,
          promo ? { type: promo.type, value: promo.value } : undefined,
        );
        // Сохраняем снимок денег в заказе: будущая смена каталога его уже не изменит.
        const order = await tx.order.create({
          data: {
            publicId: input.orderId,
            idempotencyKey,
            idempotencyPayload: fingerprint,
            productId: product.id,
            sku: product.sku,
            ...price,
            currency: product.currency,
            promoCode: promo?.code,
            histories: { create: { to: 'created', reason: 'order_created' } },
          },
        });
        if (promo) {
          // Redemption и счётчик создаются только вместе с новым заказом.
          await tx.promoRedemption.create({
            data: {
              promocodeId: promo.id,
              orderId: order.id,
              discountMinor: price.discountMinor,
            },
          });
          await tx.promocode.update({
            where: { id: promo.id },
            data: { usedCount: { increment: 1 } },
          });
        }
        return order;
      });
      return { replay: false, order: await this.order(created.publicId) };
    } catch (error) {
      // При гонке двух INSERT уникальный индекс выбирает победителя, второй читает его результат.
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        const winner = await prisma.order.findUnique({ where: { idempotencyKey } });
        if (winner) return this.validateReplay(winner, fingerprint);
        throw new ConflictException('Order ID is already used by another purchase intent');
      }
      throw error;
    }
  }

  /** Сверяет payload повторного запроса и возвращает исходный заказ без побочных эффектов. */
  private async validateReplay(
    order: { publicId: string; idempotencyPayload: string },
    fingerprint: string,
  ) {
    if (order.idempotencyPayload !== fingerprint) {
      throw new ConflictException('Idempotency-Key was already used with a different request');
    }
    return { replay: true, order: await this.order(order.publicId) };
  }

  /** Собирает публичное представление заказа вместе с кодом и полной историей статусов. */
  async order(publicId: string) {
    const order = await prisma.order.findUnique({
      where: { publicId },
      include: { product: true, fulfillment: true, histories: { orderBy: { createdAt: 'asc' } } },
    });
    if (!order) throw new NotFoundException('Order not found');
    return {
      orderId: order.publicId,
      sku: order.sku,
      productName: order.product.name,
      status: order.status,
      basePriceMinor: order.basePriceMinor,
      discountMinor: order.discountMinor,
      finalPriceMinor: order.finalPriceMinor,
      currency: order.currency,
      promoCode: order.promoCode,
      code: order.fulfillment?.code ?? null,
      createdAt: order.createdAt,
      updatedAt: order.updatedAt,
      history: order.histories.map(({ from, to, reason, createdAt }) => ({
        from,
        to,
        reason,
        createdAt,
      })),
    };
  }

  /**
   * Надёжно кладёт webhook в inbox до ответа HTTP 200.
   * Связь с заказом намеренно проверит worker: событие может прийти раньше заказа.
   */
  async acceptWebhook(event: PaymentWebhookDto) {
    try {
      await prisma.paymentEvent.create({
        data: {
          eventId: event.event_id,
          orderPublicId: event.order_id,
          status: event.status,
          amountMinor: event.amount * 100,
          currency: event.currency,
          occurredAt: new Date(event.created_at),
          payload: { ...event },
        },
      });
      return { accepted: true, duplicate: false };
    } catch (error) {
      // UNIQUE(event_id) превращает повторную доставку события в успешный no-op.
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        this.metrics.duplicateWebhooks.inc();
        return { accepted: true, duplicate: true };
      }
      throw error;
    }
  }

  /** Даёт предварительный серверный расчёт скидки, не резервируя использование промокода. */
  async quotePromo(input: QuotePromoDto) {
    const [product, promo] = await Promise.all([
      prisma.product.findUnique({ where: { sku: input.sku } }),
      prisma.promocode.findUnique({ where: { code: input.promoCode.trim().toUpperCase() } }),
    ]);
    if (!product?.active || !promo?.active)
      throw new UnprocessableEntityException('Product or promo is invalid');
    if (promo.usedCount >= promo.maxUses)
      throw new ConflictException('Promocode usage limit reached');
    if (promo.currency && promo.currency !== product.currency)
      throw new UnprocessableEntityException('Promocode currency does not match');
    return {
      ...calculatePrice(product.priceMinor, { type: promo.type, value: promo.value }),
      currency: product.currency,
      remainingUses: promo.maxUses - promo.usedCount,
    };
  }

  /** Возвращает только оплаченные заказы, которые администратор может восстановить. */
  async recoveryOrders() {
    const orders = await prisma.order.findMany({
      where: { status: { in: ['out_of_stock', 'delivery_failed'] } },
      orderBy: { updatedAt: 'desc' },
    });
    return orders.map((order) => ({
      orderId: order.publicId,
      sku: order.sku,
      status: order.status,
      updatedAt: order.updatedAt,
    }));
  }

  /** Идемпотентно возвращает восстановимый заказ в очередь выдачи. */
  async retryDelivery(publicId: string) {
    return prisma.$transaction(async (tx) => {
      const order = await tx.order.findUnique({ where: { publicId } });
      if (!order) throw new NotFoundException('Order not found');
      if (order.status === 'delivered') return { accepted: true, alreadyDelivered: true };
      if (!['out_of_stock', 'delivery_failed', 'paid'].includes(order.status)) {
        throw new ConflictException('Order is not recoverable');
      }
      // UNIQUE(order_id) не разрешает создать вторую job для того же заказа.
      await tx.deliveryJob.upsert({
        where: { orderId: order.id },
        update: {
          status: 'pending',
          runAfter: new Date(),
          leaseUntil: null,
          workerId: null,
          lastError: null,
        },
        create: { orderId: order.id },
      });
      return { accepted: true, alreadyDelivered: false };
    });
  }

  /** Добавляет очищенный от пустых значений и дублей набор кодов выбранному поставщику. */
  async addProviderKeys(input: AddProviderKeysDto) {
    const result = await prisma.providerKey.createMany({
      data: [...new Set(input.codes.map((code) => code.trim()).filter(Boolean))].map((code) => ({
        providerId: input.providerId as ProviderId,
        sku: input.sku,
        code,
      })),
      skipDuplicates: true,
    });
    return { added: result.count };
  }

  /** Настраивает детерминированный режим заглушки для воспроизведения отказов. */
  async setProviderMode(input: ProviderModeDto) {
    return prisma.providerSetting.upsert({
      where: { providerId: input.providerId as ProviderId },
      update: { faultMode: input.mode as ProviderFaultMode, delayMs: input.delayMs ?? 1500 },
      create: {
        providerId: input.providerId as ProviderId,
        faultMode: input.mode as ProviderFaultMode,
        delayMs: input.delayMs ?? 1500,
      },
    });
  }

  /**
   * Восстанавливает демо-состояние, но отказывается работать при активной выдаче.
   * Это защищает reset от удаления данных из-под уже захваченной worker'ом job.
   */
  async resetDemo() {
    return prisma.$transaction(async (tx) => {
      // Табличные locks закрывают гонку «проверили processing=0, а worker тут же захватил job».
      // Порядок соответствует worker: inbox → order → job, поэтому не создаёт обратного lock order.
      await tx.$executeRaw`LOCK TABLE payment_events, orders, delivery_jobs IN ACCESS EXCLUSIVE MODE`;
      const processing = await tx.deliveryJob.count({ where: { status: 'processing' } });
      if (processing)
        throw new ServiceUnavailableException('Cannot reset while jobs are processing');
      // Порядок удаления идёт от зависимых таблиц к родительским согласно внешним ключам.
      await tx.providerCallAttempt.deleteMany();
      await tx.providerRequest.deleteMany();
      await tx.fulfillment.deleteMany();
      await tx.deliveryJob.deleteMany();
      await tx.paymentEvent.deleteMany();
      await tx.orderStatusHistory.deleteMany();
      await tx.promoRedemption.deleteMany();
      await tx.order.deleteMany();
      await tx.providerKey.deleteMany();
      await tx.providerKey.createMany({ data: INITIAL_PROVIDER_KEY_ROWS });
      await tx.promocode.updateMany({ data: { usedCount: 0, active: true } });
      await tx.providerSetting.updateMany({ data: { faultMode: 'success', delayMs: 1500 } });
      return { reset: true, requestId: randomUUID() };
    });
  }
}
