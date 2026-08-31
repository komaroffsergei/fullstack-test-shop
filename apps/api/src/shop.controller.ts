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

@ApiTags('catalog')
@Controller('api/v1/catalog')
export class CatalogController {
  constructor(private readonly shop: ShopService) {}

  @Get('products')
  products() {
    return this.shop.catalog();
  }
}

@ApiTags('orders')
@Controller('api/v1/orders')
export class OrdersController {
  constructor(private readonly shop: ShopService) {}

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

  @Get(':orderId')
  get(@Param('orderId') orderId: string) {
    return this.shop.order(orderId);
  }
}

@ApiTags('payments')
@Controller('api/v1')
export class PaymentsController {
  constructor(private readonly shop: ShopService) {}

  @Post('webhooks/payment')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Durably accept a payment event before returning 200' })
  webhook(@Body() event: PaymentWebhookDto) {
    return this.shop.acceptWebhook(event);
  }

  @Post('payments/simulate')
  async simulate(@Body() input: SimulatePaymentDto) {
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
    const response = await fetch(`${base}/api/v1/webhooks/payment`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(event),
      signal: AbortSignal.timeout(2_000),
    });
    if (!response.ok) throw new Error(`Webhook simulator received HTTP ${response.status}`);
    return { eventId: event.event_id, accepted: true };
  }

  @Post('promocodes/quote')
  quote(@Body() input: QuotePromoDto) {
    return this.shop.quotePromo(input);
  }
}

@ApiTags('admin')
@ApiHeader({ name: 'X-Admin-Token', required: true })
@UseGuards(AdminGuard)
@Controller('api/v1/admin')
export class AdminController {
  constructor(private readonly shop: ShopService) {}

  @Get('recovery/orders')
  recovery() {
    return this.shop.recoveryOrders();
  }

  @Post('orders/:orderId/retry-delivery')
  @HttpCode(HttpStatus.ACCEPTED)
  retry(@Param('orderId') orderId: string) {
    return this.shop.retryDelivery(orderId);
  }

  @Post('providers/keys')
  addKeys(@Body() input: AddProviderKeysDto) {
    return this.shop.addProviderKeys(input);
  }

  @Post('providers/mode')
  mode(@Body() input: ProviderModeDto) {
    return this.shop.setProviderMode(input);
  }

  @Post('demo/reset')
  reset() {
    return this.shop.resetDemo();
  }
}

@Controller('api')
export class OperationsController {
  constructor(private readonly metrics: MetricsService) {}

  @Get('health/live')
  live() {
    return { status: 'ok' };
  }

  @Get('health/ready')
  async ready() {
    await prisma.$queryRaw`SELECT 1`;
    return { status: 'ok' };
  }

  @Get('metrics')
  async metricsEndpoint(@Res() response: Response) {
    response.type(this.metrics.contentType).send(await this.metrics.render());
  }
}
