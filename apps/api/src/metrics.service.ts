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
  private readonly providerAttempts = new Gauge({
    name: 'shop_provider_attempts',
    help: 'Persisted provider attempts by outcome',
    labelNames: ['outcome'],
    registers: [this.registry],
  });
  private readonly orderStatuses = new Gauge({
    name: 'shop_orders',
    help: 'Orders by current status',
    labelNames: ['status'],
    registers: [this.registry],
  });
  private readonly deliveryRetries = new Gauge({
    name: 'shop_delivery_retries',
    help: 'Persisted delivery retry attempts',
    registers: [this.registry],
  });

  constructor() {
    collectDefaultMetrics({ register: this.registry, prefix: 'shop_' });
  }

  async render(): Promise<string> {
    const [count, outcomes, statuses, jobs] = await Promise.all([
      prisma.deliveryJob.count({ where: { status: { in: ['pending', 'retry'] } } }),
      prisma.providerCallAttempt.groupBy({ by: ['outcome'], _count: { _all: true } }),
      prisma.order.groupBy({ by: ['status'], _count: { _all: true } }),
      prisma.deliveryJob.aggregate({ _sum: { attempts: true }, _count: { _all: true } }),
    ]);
    this.queueLength.set(count);
    this.providerAttempts.reset();
    for (const item of outcomes)
      this.providerAttempts.set({ outcome: item.outcome }, item._count._all);
    this.orderStatuses.reset();
    for (const item of statuses) this.orderStatuses.set({ status: item.status }, item._count._all);
    this.deliveryRetries.set(Math.max(0, (jobs._sum.attempts ?? 0) - jobs._count._all));
    return this.registry.metrics();
  }

  get contentType(): string {
    return this.registry.contentType;
  }
}
