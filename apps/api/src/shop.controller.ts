import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ApiHeader, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { randomUUID } from 'node:crypto';
import { prisma } from '@shop/database';
import { AdminGuard } from './admin.guard';
import {
  AddProviderKeysDto,
  CreateOrderDto,
  PaymentWebhookDto,
  ProviderModeDto,
  QuotePromoDto,
  SimulatePaymentDto,
} from './dto';
import { MetricsService } from './metrics.service';
import { ShopService } from './shop.service';

/** Тонкий HTTP-адаптер публичного каталога. */
@ApiTags('catalog')
@Controller('api/v1/catalog')
export class CatalogController {
  /** Получает ShopService из контейнера NestJS. */
  constructor(private readonly shop: ShopService) {}

  /** Делегирует чтение активного каталога прикладному сервису. */
  @Get('products')
  products() {
    return this.shop.catalog();
  }
}

/** HTTP-контракт создания и чтения заказов. */
@ApiTags('orders')
@Controller('api/v1/orders')
export class OrdersController {
  /** Получает ShopService из контейнера NestJS. */
  constructor(private readonly shop: ShopService) {}

  /** Создаёт заказ или возвращает прежний, выставляя 201/200 согласно replay. */
  @Post()
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  async create(
    @Body() input: CreateOrderDto,
    @Headers('idempotency-key') idempotencyKey: string,
    @Res({ passthrough: true }) response: Response,
  ) {
    const result = await this.shop.createOrder(input, idempotencyKey);
    response.status(result.replay ? HttpStatus.OK : HttpStatus.CREATED);
    return result.order;
  }

  /** Возвращает заказ по безопасному публичному UUID, а не внутреннему bigint. */
  @Get(':orderId')
  get(@Param('orderId') orderId: string) {
    return this.shop.order(orderId);
  }
}

/** Контроллер webhook, симулятора оплаты и предварительного расчёта скидки. */
@ApiTags('payments')
@Controller('api/v1')
export class PaymentsController {
  /** Получает ShopService из контейнера NestJS. */
  constructor(private readonly shop: ShopService) {}

  /** Сохраняет платёжное событие в durable inbox перед подтверждением отправителю. */
  @Post('webhooks/payment')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Durably accept a payment event before returning 200' })
  webhook(@Body() event: PaymentWebhookDto) {
    return this.shop.acceptWebhook(event);
  }

  /** Строит реалистичное событие и отправляет его через настоящий webhook endpoint. */
  @Post('payments/simulate')
  async simulate(@Body() input: SimulatePaymentDto) {
    // Сумма берётся из серверного снимка заказа, а не из запроса браузера.
    const order = await this.shop.order(input.orderId);
    const event: PaymentWebhookDto = {
      event_id: `evt_${randomUUID()}`,
      order_id: input.orderId,
      status: input.status,
      amount: order.finalPriceMinor / 100,
      currency: order.currency,
      created_at: new Date().toISOString(),
    };
    const base = process.env.API_ORIGIN ?? `http://127.0.0.1:${process.env.PORT ?? '4000'}`;
    // Даже демо-оплата проходит тот же HTTP-контракт и inbox, что внешний эквайринг.
    const response = await fetch(`${base}/api/v1/webhooks/payment`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(event),
      signal: AbortSignal.timeout(2_000),
    });
    if (!response.ok) throw new Error(`Webhook simulator received HTTP ${response.status}`);
    return { eventId: event.event_id, accepted: true };
  }

  /** Возвращает расчёт промокода без создания заказа. */
  @Post('promocodes/quote')
  quote(@Body() input: QuotePromoDto) {
    return this.shop.quotePromo(input);
  }
}

/** Защищённые операции восстановления и управления заглушками. */
@ApiTags('admin')
@ApiHeader({ name: 'X-Admin-Token', required: true })
@UseGuards(AdminGuard)
@Controller('api/v1/admin')
export class AdminController {
  /** Получает ShopService из контейнера NestJS. */
  constructor(private readonly shop: ShopService) {}

  /** Показывает очередь заказов, требующих ручного восстановления. */
  @Get('recovery/orders')
  recovery() {
    return this.shop.recoveryOrders();
  }

  /** Возвращает конкретный заказ в идемпотентную очередь выдачи. */
  @Post('orders/:orderId/retry-delivery')
  @HttpCode(HttpStatus.ACCEPTED)
  retry(@Param('orderId') orderId: string) {
    return this.shop.retryDelivery(orderId);
  }

  /** Пополняет пул кодов выбранной заглушки поставщика. */
  @Post('providers/keys')
  addKeys(@Body() input: AddProviderKeysDto) {
    return this.shop.addProviderKeys(input);
  }

  /** Переключает воспроизводимый сценарий ответа поставщика. */
  @Post('providers/mode')
  mode(@Body() input: ProviderModeDto) {
    return this.shop.setProviderMode(input);
  }

  /** Запрашивает безопасный сброс демонстрационных данных. */
  @Post('demo/reset')
  reset() {
    return this.shop.resetDemo();
  }
}

/** Технические endpoints для оркестратора и мониторинга. */
@Controller('api')
export class OperationsController {
  /** Получает сервис Prometheus-метрик. */
  constructor(private readonly metrics: MetricsService) {}

  /** Подтверждает, что Node.js процесс жив и отвечает. */
  @Get('health/live')
  live() {
    return { status: 'ok' };
  }

  /** Проверяет готовность приложения реальным запросом к PostgreSQL. */
  @Get('health/ready')
  async ready() {
    await prisma.$queryRaw`SELECT 1`;
    return { status: 'ok' };
  }

  /** Отдаёт актуальный Prometheus exposition document. */
  @Get('metrics')
  async metricsEndpoint(@Res() response: Response) {
    response.type(this.metrics.contentType).send(await this.metrics.render());
  }
}
