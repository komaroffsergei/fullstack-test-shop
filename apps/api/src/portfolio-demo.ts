import {
  CanActivate,
  ConflictException,
  Controller,
  ExecutionContext,
  Get,
  Injectable,
  NotFoundException,
  OnModuleDestroy,
  OnModuleInit,
  Param,
  Post,
  Req,
  UnprocessableEntityException,
} from '@nestjs/common';
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type { Request, Response } from 'express';
import { DEMO_RESET_ADVISORY_LOCK_ID, prisma } from '@shop/database';
import { ShopService } from './shop.service';
import type { PaymentWebhookDto } from './dto';

export type DemoRequest = Request & { portfolioOwner?: string };
const enabled = () => process.env.PORTFOLIO_DEMO === 'true';
const secret = () => process.env.PORTFOLIO_SECRET ?? '';
const prefix = (owner: string) => `portfolio:${owner}:`;
const sign = (value: string) => createHmac('sha256', secret()).update(value).digest('hex');

/** Сравнивает подписи без утечки совпавшего префикса через время выполнения. */
function equal(a: string, b: string): boolean {
  const left = Buffer.from(a),
    right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

@Injectable()
/** В демо привязывает заказы к подписанной cookie, сохраняя обычный API вне демо. */
export class PortfolioGuard implements CanActivate {
  /** Проверяет сессию и владельца до вызова контроллера и любых побочных эффектов. */
  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (!enabled()) return true;
    if (secret().length < 32)
      throw new Error('PORTFOLIO_SECRET must contain at least 32 characters');
    const request = context.switchToHttp().getRequest<DemoRequest>();
    const response = context.switchToHttp().getResponse<Response>();
    if (
      request.path === '/api/v1/webhooks/payment' &&
      equal(request.header('x-demo-internal') ?? '', sign('internal-webhook'))
    )
      return true;
    const origin = request.header('origin');
    if (origin && origin !== (process.env.PUBLIC_ORIGIN ?? 'https://test-shop.komaroff-dev.ru'))
      throw new NotFoundException();
    let token =
      (request.headers.cookie ?? '')
        .split(';')
        .map((x) => x.trim())
        .find((x) => x.startsWith('portfolio_shop='))
        ?.slice(15) ?? '';
    const parts = token.split('.');
    if (
      !(
        parts.length === 3 &&
        /^[a-f0-9]{48}$/.test(parts[0] ?? '') &&
        Number(parts[1]) > Date.now() &&
        equal(sign(parts.slice(0, 2).join('.')), parts[2] ?? '')
      )
    ) {
      const raw = `${randomBytes(24).toString('hex')}.${Date.now() + 3_600_000}`;
      token = `${raw}.${sign(raw)}`;
      response.cookie('portfolio_shop', token, {
        maxAge: 3_600_000,
        secure: true,
        httpOnly: true,
        sameSite: 'lax',
        path: '/',
      });
    }
    response.setHeader('Cache-Control', 'no-store');
    const owner = createHash('sha256').update(token).digest('hex');
    request.portfolioOwner = owner;
    if (request.path === '/api/v1/orders' && request.method === 'POST') {
      const key = request.header('idempotency-key');
      if (!key || key.length > 200)
        throw new UnprocessableEntityException('Idempotency-Key is required');
      const scenario = request.header('x-demo-scenario') ?? 'normal';
      if (!['normal', 'recovery'].includes(scenario))
        throw new UnprocessableEntityException('Unknown demo scenario');
      request.headers['idempotency-key'] =
        `${prefix(owner)}${createHash('sha256').update(key).digest('hex')}${scenario === 'recovery' ? ':recover' : ''}`;
    }
    const matched = request.path.match(
      /^\/api\/v1\/(?:orders|demo\/orders)\/([a-f0-9-]{36})(?:\/|$)/i,
    );
    const body = request.body as { orderId?: string; order_id?: string } | undefined;
    const orderId =
      matched?.[1] ??
      (request.path === '/api/v1/payments/simulate'
        ? body?.orderId
        : request.path === '/api/v1/webhooks/payment'
          ? body?.order_id
          : undefined);
    if (orderId) {
      if (
        typeof orderId !== 'string' ||
        !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(orderId)
      )
        throw new UnprocessableEntityException('Invalid order ID');
      const order = await prisma.order.findUnique({ where: { publicId: orderId } });
      if (
        !order ||
        !order.idempotencyKey.startsWith(prefix(owner)) ||
        order.createdAt.getTime() < Date.now() - 3_600_000
      )
        throw new NotFoundException('Order not found in this demo session');
      if (
        request.method === 'POST' &&
        ['/api/v1/payments/simulate', '/api/v1/webhooks/payment'].includes(request.path) &&
        (await prisma.paymentEvent.count({ where: { orderPublicId: orderId } })) >= 20
      )
        throw new ConflictException('Demo event limit reached');
    } else if (['/api/v1/payments/simulate', '/api/v1/webhooks/payment'].includes(request.path))
      throw new UnprocessableEntityException('Order ID is required');
    return true;
  }
}

/** Подписывает только внутренний HTTP-вызов симулятора; значение не отправляется браузеру. */
export function internalDemoHeaders(): Record<string, string> {
  return enabled() ? { 'x-demo-internal': sign('internal-webhook') } : {};
}

@Injectable()
/** Удаляет только данные портфолио по TTL или запросу их владельца. */
export class PortfolioCleanup implements OnModuleInit, OnModuleDestroy {
  private timer?: ReturnType<typeof setInterval>;
  /** Запускает периодическую очистку без сохранения резервных копий демо-сессий. */
  onModuleInit(): void {
    if (enabled())
      this.timer = setInterval(
        () => void this.clear().catch(() => console.error('portfolio_cleanup_failed')),
        300_000,
      );
  }
  /** Освобождает таймер при завершении API. */
  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }
  /** Сериализует очистку с claim worker, возвращает тестовые коды и удаляет зависимые записи. */
  async clear(owner?: string) {
    if (!enabled()) throw new NotFoundException();
    return prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT pg_advisory_xact_lock(${DEMO_RESET_ADVISORY_LOCK_ID}) IS NULL AS acquired`;
        const orders = await tx.order.findMany({
          where: {
            idempotencyKey: { startsWith: owner ? prefix(owner) : 'portfolio:' },
            ...(owner ? {} : { createdAt: { lt: new Date(Date.now() - 3_600_000) } }),
          },
          include: { deliveryJob: true, providerRequests: true, promoRedemption: true },
        });
        if (owner && orders.some((x) => x.deliveryJob?.status === 'processing'))
          throw new ConflictException('Дождитесь завершения текущей выдачи');
        const deletable = orders.filter((x) => x.deliveryJob?.status !== 'processing');
        for (const order of deletable) {
          await tx.paymentEvent.deleteMany({ where: { orderPublicId: order.publicId } });
          await tx.providerKey.updateMany({
            where: { requestId: { in: order.providerRequests.map((x) => x.requestId) } },
            data: { requestId: null, issuedAt: null },
          });
          if (order.promoRedemption)
            await tx.promocode.update({
              where: { id: order.promoRedemption.promocodeId },
              data: { usedCount: { decrement: 1 } },
            });
          await tx.order.delete({ where: { id: order.id } });
        }
        return { deletedOrders: deletable.length, ttlSeconds: 3600 };
      },
      { timeout: 15_000 },
    );
  }
}

@Controller('api/v1/demo')
/** Публичные ограниченные сценарии повторения события, восстановления и сброса своего примера. */
export class PortfolioController {
  /** Получает исходный сервис заказов и очистку через NestJS. */
  constructor(
    private readonly shop: ShopService,
    private readonly cleanup: PortfolioCleanup,
  ) {}
  /** Объясняет реальные компоненты, моки и границы хранения. */
  @Get('config')
  config() {
    return {
      enabled: enabled(),
      ttlSeconds: 3600,
      maxOrders: 20,
      real: 'Angular, NestJS, PostgreSQL, inbox, очередь, HTTP webhook и выдача',
      mocks: 'Оплата и два поставщика цифровых кодов; деньги не списываются',
    };
  }
  /** Повторяет сохранённое событие с тем же event_id через исходный durable inbox. */
  @Post('orders/:orderId/replay')
  async replay(@Param('orderId') orderId: string) {
    if (!enabled()) throw new NotFoundException();
    const event = await prisma.paymentEvent.findFirst({
      where: { orderPublicId: orderId },
      orderBy: { receivedAt: 'desc' },
    });
    if (!event) throw new ConflictException('Сначала выполните тестовую оплату');
    return this.shop.acceptWebhook(event.payload as unknown as PaymentWebhookDto);
  }
  /** Повторяет выдачу собственного заказа; guard уже проверил владельца. */
  @Post('orders/:orderId/recover')
  recover(@Param('orderId') orderId: string) {
    if (!enabled()) throw new NotFoundException();
    return this.shop.retryDelivery(orderId);
  }
  /** Сбрасывает только сессию вызывающего посетителя. */
  @Post('reset')
  reset(@Req() request: DemoRequest) {
    if (!request.portfolioOwner) throw new NotFoundException();
    return this.cleanup.clear(request.portfolioOwner);
  }
}
