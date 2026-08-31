import { Injectable, OnApplicationShutdown, OnModuleInit } from '@nestjs/common';
import { AttemptOutcome, OrderStatus, ProviderId, prisma } from '@shop/database';
import { randomUUID } from 'node:crypto';

type ClaimedEvent = {
  id: bigint;
  event_id: string;
  order_public_id: string;
  status: 'paid' | 'failed';
  amount_minor: number;
  currency: string;
};

type ClaimedJob = { id: bigint; order_id: bigint; attempts: number };
type ProviderResult =
  | { kind: 'ok'; code: string; providerId: ProviderId; requestId: string }
  | {
      kind: 'out_of_stock' | 'server_error' | 'timeout' | 'invalid_response';
      providerId: ProviderId;
    };

@Injectable()
export class WorkerService implements OnModuleInit, OnApplicationShutdown {
  private stopped = false;
  private timer?: NodeJS.Timeout;
  private readonly workerId = process.env.WORKER_ID ?? `worker-${process.pid}`;
  private readonly pollMs = Number(process.env.WORKER_POLL_MS ?? 250);

  onModuleInit(): void {
    this.schedule(0);
  }

  onApplicationShutdown(): void {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
  }

  private schedule(delay: number): void {
    if (this.stopped) return;
    this.timer = setTimeout(() => void this.tick(), delay);
  }

  private async tick(): Promise<void> {
    try {
      const eventWorked = await this.processPaymentEvent();
      const jobWorked = await this.processDeliveryJob();
      this.schedule(eventWorked || jobWorked ? 0 : this.pollMs);
    } catch (error) {
      this.log('error', 'worker_tick_failed', { error: this.errorMessage(error) });
      this.schedule(1_000);
    }
  }

  private async processPaymentEvent(): Promise<boolean> {
    const result = await prisma.$transaction(async (tx) => {
      const [event] = await tx.$queryRaw<ClaimedEvent[]>`
        SELECT pe.id, pe.event_id, pe.order_public_id, pe.status::text, pe.amount_minor, pe.currency
        FROM payment_events pe
        JOIN orders o ON o.public_id = pe.order_public_id
        WHERE pe.inbox_state = 'pending'
        ORDER BY pe.received_at, pe.id
        LIMIT 1 FOR UPDATE OF pe SKIP LOCKED
      `;
      if (!event) return null;

      const [order] = await tx.$queryRaw<
        Array<{
          id: bigint;
          status: OrderStatus;
          final_price_minor: number;
          currency: string;
        }>
      >`
        SELECT id, status::text, final_price_minor, currency
        FROM orders WHERE public_id = ${event.order_public_id}::uuid FOR UPDATE
      `;
      if (!order) return null;

      if (event.amount_minor !== order.final_price_minor || event.currency !== order.currency) {
        await tx.paymentEvent.update({
          where: { id: event.id },
          data: {
            inboxState: 'invalid',
            processedAt: new Date(),
            reason: 'amount_or_currency_mismatch',
          },
        });
        return { event, action: 'invalid' };
      }

      if (event.status === 'paid') {
        if (
          !['paid', 'delivering', 'delivered', 'out_of_stock', 'delivery_failed'].includes(
            order.status,
          )
        ) {
          await tx.order.update({ where: { id: order.id }, data: { status: 'paid' } });
          await tx.orderStatusHistory.create({
            data: { orderId: order.id, from: order.status, to: 'paid', reason: 'payment_paid' },
          });
        }
        await tx.deliveryJob.upsert({
          where: { orderId: order.id },
          update: {},
          create: { orderId: order.id },
        });
      } else if (order.status === 'created') {
        await tx.order.update({ where: { id: order.id }, data: { status: 'payment_failed' } });
        await tx.orderStatusHistory.create({
          data: {
            orderId: order.id,
            from: 'created',
            to: 'payment_failed',
            reason: 'payment_failed',
          },
        });
      }

      await tx.paymentEvent.update({
        where: { id: event.id },
        data: { inboxState: 'processed', processedAt: new Date() },
      });
      return { event, action: event.status };
    });
    if (result)
      this.log('info', 'payment_event_processed', {
        eventId: result.event.event_id,
        action: result.action,
      });
    return result !== null;
  }

  private async processDeliveryJob(): Promise<boolean> {
    const [job] = await prisma.$queryRaw<ClaimedJob[]>`
      UPDATE delivery_jobs SET
        status = 'processing', worker_id = ${this.workerId},
        lease_until = now() + interval '30 seconds', attempts = attempts + 1, updated_at = now()
      WHERE id = (
        SELECT id FROM delivery_jobs
        WHERE (status IN ('pending', 'retry') AND run_after <= now())
           OR (status = 'processing' AND lease_until < now())
        ORDER BY run_after, id LIMIT 1 FOR UPDATE SKIP LOCKED
      )
      RETURNING id, order_id, attempts
    `;
    if (!job) return false;

    const order = await prisma.order.findUnique({
      where: { id: job.order_id },
      include: { fulfillment: true },
    });
    if (!order || order.fulfillment || order.status === 'delivered') {
      await prisma.deliveryJob.update({
        where: { id: job.id },
        data: { status: 'succeeded', leaseUntil: null },
      });
      return true;
    }

    await this.markDelivering(order.id, order.status);
    const resultA = await this.callProvider(order.id, order.publicId, order.sku, ProviderId.A);
    if (resultA.kind === 'ok') return this.complete(job.id, order.id, resultA);
    if (resultA.kind === 'timeout') return this.retry(job, 'ambiguous_timeout_provider_A');

    const resultB = await this.callProvider(order.id, order.publicId, order.sku, ProviderId.B);
    if (resultB.kind === 'ok') return this.complete(job.id, order.id, resultB);
    if (resultB.kind === 'timeout') return this.retry(job, 'ambiguous_timeout_provider_B');

    const bothEmpty = resultA.kind === 'out_of_stock' && resultB.kind === 'out_of_stock';
    return this.recoverable(job.id, order.id, bothEmpty ? 'out_of_stock' : 'delivery_failed');
  }

  private async markDelivering(orderId: bigint, previous: OrderStatus): Promise<void> {
    if (previous === 'delivering') return;
    await prisma.$transaction([
      prisma.order.update({ where: { id: orderId }, data: { status: 'delivering' } }),
      prisma.orderStatusHistory.create({
        data: { orderId, from: previous, to: 'delivering', reason: 'delivery_started' },
      }),
    ]);
  }

  private async callProvider(
    orderId: bigint,
    publicId: string,
    sku: string,
    providerId: ProviderId,
  ): Promise<ProviderResult> {
    const request = await prisma.providerRequest.upsert({
      where: { orderId_providerId: { orderId, providerId } },
      update: {},
      create: { orderId, providerId, requestId: randomUUID() },
    });
    const started = Date.now();
    const url =
      providerId === ProviderId.A ? process.env.PROVIDER_A_URL : process.env.PROVIDER_B_URL;
    if (!url) throw new Error(`Provider ${providerId} URL is missing`);

    let outcome: AttemptOutcome = 'invalid_response';
    let httpStatus: number | undefined;
    let detail: string | undefined;
    let code: string | undefined;
    try {
      const response = await fetch(`${url}/issue`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ request_id: request.requestId, sku, order_id: publicId }),
        signal: AbortSignal.timeout(Number(process.env.PROVIDER_TIMEOUT_MS ?? 800)),
      });
      httpStatus = response.status;
      const body = (await response.json()) as {
        status?: string;
        reason?: string;
        code?: string;
        request_id?: string;
      };
      if (
        response.ok &&
        body.status === 'ok' &&
        body.code &&
        body.request_id === request.requestId
      ) {
        outcome = 'success';
        code = body.code;
      } else if (body.reason === 'out_of_stock') outcome = 'out_of_stock';
      else if (response.status >= 500) outcome = 'server_error';
      else outcome = 'invalid_response';
      detail = body.reason;
    } catch (error) {
      outcome = 'timeout';
      detail = this.errorMessage(error);
    }
    await prisma.$transaction([
      prisma.providerRequest.update({ where: { id: request.id }, data: { lastOutcome: outcome } }),
      prisma.providerCallAttempt.create({
        data: {
          providerRequestId: request.id,
          outcome,
          httpStatus,
          durationMs: Date.now() - started,
          detail,
        },
      }),
    ]);
    this.log('info', 'provider_call', {
      orderId: publicId,
      providerRequestId: request.requestId,
      providerId,
      outcome,
    });
    return code
      ? { kind: 'ok', code, providerId, requestId: request.requestId }
      : { kind: outcome as Exclude<ProviderResult['kind'], 'ok'>, providerId };
  }

  private async complete(
    jobId: bigint,
    orderId: bigint,
    result: Extract<ProviderResult, { kind: 'ok' }>,
  ): Promise<boolean> {
    await prisma.$transaction(async (tx) => {
      const [locked] = await tx.$queryRaw<Array<{ status: OrderStatus }>>`
        SELECT status::text FROM orders WHERE id = ${orderId} FOR UPDATE
      `;
      const existing = await tx.fulfillment.findUnique({ where: { orderId } });
      if (!existing) {
        await tx.fulfillment.create({
          data: {
            orderId,
            providerId: result.providerId,
            requestId: result.requestId,
            code: result.code,
          },
        });
      }
      if (locked?.status !== 'delivered') {
        await tx.order.update({ where: { id: orderId }, data: { status: 'delivered' } });
        await tx.orderStatusHistory.create({
          data: {
            orderId,
            from: locked?.status ?? 'delivering',
            to: 'delivered',
            reason: 'code_issued',
          },
        });
      }
      await tx.deliveryJob.update({
        where: { id: jobId },
        data: { status: 'succeeded', leaseUntil: null, lastError: null },
      });
    });
    return true;
  }

  private async retry(job: ClaimedJob, reason: string): Promise<boolean> {
    if (job.attempts >= 6) return this.recoverable(job.id, job.order_id, 'delivery_failed');
    await prisma.deliveryJob.update({
      where: { id: job.id },
      data: {
        status: 'retry',
        runAfter: new Date(Date.now() + 500),
        leaseUntil: null,
        lastError: reason,
      },
    });
    return true;
  }

  private async recoverable(
    jobId: bigint,
    orderId: bigint,
    status: 'out_of_stock' | 'delivery_failed',
  ): Promise<boolean> {
    await prisma.$transaction(async (tx) => {
      const order = await tx.order.findUniqueOrThrow({ where: { id: orderId } });
      if (order.status !== 'delivered') {
        await tx.order.update({ where: { id: orderId }, data: { status } });
        await tx.orderStatusHistory.create({
          data: { orderId, from: order.status, to: status, reason: status },
        });
      }
      await tx.deliveryJob.update({
        where: { id: jobId },
        data: { status: 'failed', leaseUntil: null, lastError: status },
      });
    });
    return true;
  }

  private log(level: 'info' | 'error', message: string, context: Record<string, unknown>): void {
    console[level](
      JSON.stringify({
        level,
        message,
        workerId: this.workerId,
        timestamp: new Date().toISOString(),
        ...context,
      }),
    );
  }

  private errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }
}
