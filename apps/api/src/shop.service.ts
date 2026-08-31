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
export class ShopService {
  constructor(private readonly metrics: MetricsService) {}

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

  async createOrder(input: CreateOrderDto, idempotencyKey: string) {
    if (!idempotencyKey || idempotencyKey.length > 200) {
      throw new UnprocessableEntityException('Idempotency-Key is required');
    }
    const fingerprint = fingerprintOrder(input);
    const existing = await prisma.order.findUnique({ where: { idempotencyKey } });
    if (existing) return this.validateReplay(existing, fingerprint);

    try {
      const created = await prisma.$transaction(async (tx) => {
        const product = await tx.product.findUnique({ where: { sku: input.sku } });
        if (!product?.active) throw new NotFoundException('Product not found');

        let promo: LockedPromo | undefined;
        if (input.promoCode) {
          const normalized = input.promoCode.trim().toUpperCase();
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
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        const winner = await prisma.order.findUnique({ where: { idempotencyKey } });
        if (winner) return this.validateReplay(winner, fingerprint);
        throw new ConflictException('Order ID is already used by another purchase intent');
      }
      throw error;
    }
  }

  private async validateReplay(
    order: { publicId: string; idempotencyPayload: string },
    fingerprint: string,
  ) {
    if (order.idempotencyPayload !== fingerprint) {
      throw new ConflictException('Idempotency-Key was already used with a different request');
    }
    return { replay: true, order: await this.order(order.publicId) };
  }

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
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        this.metrics.duplicateWebhooks.inc();
        return { accepted: true, duplicate: true };
      }
      throw error;
    }
  }

  async quotePromo(input: QuotePromoDto) {
    const [product, promo] = await Promise.all([
      prisma.product.findUnique({ where: { sku: input.sku } }),
      prisma.promocode.findUnique({ where: { code: input.promoCode.trim().toUpperCase() } }),
    ]);
    if (!product?.active || !promo?.active)
      throw new UnprocessableEntityException('Product or promo is invalid');
    if (promo.usedCount >= promo.maxUses)
      throw new ConflictException('Promocode usage limit reached');
    return {
      ...calculatePrice(product.priceMinor, { type: promo.type, value: promo.value }),
      currency: product.currency,
      remainingUses: promo.maxUses - promo.usedCount,
    };
  }

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

  async retryDelivery(publicId: string) {
    return prisma.$transaction(async (tx) => {
      const order = await tx.order.findUnique({ where: { publicId } });
      if (!order) throw new NotFoundException('Order not found');
      if (order.status === 'delivered') return { accepted: true, alreadyDelivered: true };
      if (!['out_of_stock', 'delivery_failed', 'paid'].includes(order.status)) {
        throw new ConflictException('Order is not recoverable');
      }
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

  async resetDemo() {
    const processing = await prisma.deliveryJob.count({ where: { status: 'processing' } });
    if (processing) throw new ServiceUnavailableException('Cannot reset while jobs are processing');
    await prisma.$transaction(async (tx) => {
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
    });
    return { reset: true, requestId: randomUUID() };
  }
}
