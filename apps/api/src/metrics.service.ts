import { Injectable } from '@nestjs/common';
import { Counter, Gauge, Registry, collectDefaultMetrics } from 'prom-client';
import { prisma } from '@shop/database';

@Injectable()
export class MetricsService {
  private readonly registry = new Registry();
  readonly duplicateWebhooks = new Counter({
    name: 'shop_webhook_duplicates_total',
    help: 'Duplicate payment webhooks',
    registers: [this.registry],
  });
  private readonly queueLength = new Gauge({
    name: 'shop_delivery_queue_length',
    help: 'Runnable delivery jobs',
    registers: [this.registry],
  });

  constructor() {
    collectDefaultMetrics({ register: this.registry, prefix: 'shop_' });
  }

  async render(): Promise<string> {
    const count = await prisma.deliveryJob.count({
      where: { status: { in: ['pending', 'retry'] } },
    });
    this.queueLength.set(count);
    return this.registry.metrics();
  }

  get contentType(): string {
    return this.registry.contentType;
  }
}
