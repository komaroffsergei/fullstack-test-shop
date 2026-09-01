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
/**
 * Фоновый обработчик двух PostgreSQL-очередей: payment inbox и delivery jobs.
 * Несколько экземпляров могут безопасно работать параллельно благодаря row locks и lease.
 */
export class WorkerService implements OnModuleInit, OnApplicationShutdown {
  private stopped = false;
  private timer?: NodeJS.Timeout;
  private readonly workerId = process.env.WORKER_ID ?? `worker-${process.pid}`;
  private readonly pollMs = Number(process.env.WORKER_POLL_MS ?? 250);

  /** Запускает первый проход цикла сразу после инициализации NestJS-контекста. */
  onModuleInit(): void {
    this.schedule(0);
  }

  /** Останавливает новые итерации и очищает таймер при корректном завершении процесса. */
  onApplicationShutdown(): void {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
  }

  /** Планирует одну следующую итерацию, не создавая пересекающихся interval-вызовов. */
  private schedule(delay: number): void {
    if (this.stopped) return;
    this.timer = setTimeout(() => void this.tick(), delay);
  }

  /** Обрабатывает максимум одно платёжное событие и одну job, затем выбирает задержку. */
  private async tick(): Promise<void> {
    try {
      const eventWorked = await this.processPaymentEvent();
      const jobWorked = await this.processDeliveryJob();
      // Пока очередь непуста, идём без паузы; в простое снижаем нагрузку на PostgreSQL.
      this.schedule(eventWorked || jobWorked ? 0 : this.pollMs);
    } catch (error) {
      this.log('error', 'worker_tick_failed', { error: this.errorMessage(error) });
      this.schedule(1_000);
    }
  }

  /**
   * Атомарно захватывает одно применимое payment event и меняет заказ.
   * Раннее событие остаётся pending, потому что JOIN увидит его только после появления заказа.
   */
  private async processPaymentEvent(): Promise<boolean> {
    const result = await prisma.$transaction(async (tx) => {
      // SKIP LOCKED распределяет разные события между worker'ами без ожидания друг друга.
      const [event] = await tx.$queryRaw<ClaimedEvent[]>`
        SELECT pe.id, pe.event_id, pe.order_public_id, pe.status::text, pe.amount_minor, pe.currency
        FROM payment_events pe
        JOIN orders o ON o.public_id = pe.order_public_id
        WHERE pe.inbox_state = 'pending'
        ORDER BY pe.received_at, pe.id
        LIMIT 1 FOR UPDATE OF pe SKIP LOCKED
      `;
      if (!event) return null;

      // Заказ блокируется отдельно, чтобы события одного заказа применялись последовательно.
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

      // Подменённая сумма/валюта фиксируется как invalid и никогда не запускает выдачу.
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
        // Paid сильнее failed: поздняя успешная оплата восстанавливает payment_failed.
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
        // UNIQUE(order_id) гарантирует максимум одну delivery job даже для 50 paid events.
        await tx.deliveryJob.upsert({
          where: { orderId: order.id },
          update: {},
          create: { orderId: order.id },
        });
      } else if (order.status === 'created') {
        // Failed меняет только новый заказ и не способен откатить paid/delivered.
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

  /** Захватывает одну задачу выдачи, вызывает поставщиков вне транзакции и завершает job. */
  private async processDeliveryJob(): Promise<boolean> {
    // UPDATE ... RETURNING делает claim атомарным; истёкший lease позволяет восстановиться после crash.
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

    // После короткого claim внешняя сеть вызывается уже без открытой БД-транзакции.
    const order = await prisma.order.findUnique({
      where: { id: job.order_id },
      include: { fulfillment: true },
    });
    // Повторно найденная job становится no-op, если результат уже существует.
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
    // Timeout неоднозначен: A мог выдать код, поэтому переключаться на B опасно.
    if (resultA.kind === 'timeout') return this.retry(job, 'ambiguous_timeout_provider_A');

    // B вызывается только после однозначного ответа A без успешной выдачи.
    const resultB = await this.callProvider(order.id, order.publicId, order.sku, ProviderId.B);
    if (resultB.kind === 'ok') return this.complete(job.id, order.id, resultB);
    if (resultB.kind === 'timeout') return this.retry(job, 'ambiguous_timeout_provider_B');

    const bothEmpty = resultA.kind === 'out_of_stock' && resultB.kind === 'out_of_stock';
    return this.recoverable(job.id, order.id, bothEmpty ? 'out_of_stock' : 'delivery_failed');
  }

  /** Идемпотентно переводит заказ в delivering и пишет аудиторскую запись. */
  private async markDelivering(orderId: bigint, previous: OrderStatus): Promise<void> {
    if (previous === 'delivering') return;
    await prisma.$transaction([
      prisma.order.update({ where: { id: orderId }, data: { status: 'delivering' } }),
      prisma.orderStatusHistory.create({
        data: { orderId, from: previous, to: 'delivering', reason: 'delivery_started' },
      }),
    ]);
  }

  /**
   * Вызывает выбранного поставщика со стабильным request_id и журналирует каждую попытку.
   * Один order/provider всегда переиспользует одну запись ProviderRequest.
   */
  private async callProvider(
    orderId: bigint,
    publicId: string,
    sku: string,
    providerId: ProviderId,
  ): Promise<ProviderResult> {
    // Стабильный UUID является ключом идемпотентности на стороне поставщика.
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
      // Timeout ограничивает зависший HTTP, но не доказывает, что поставщик ничего не выдал.
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
      // Успех принимается только при совпадении request_id и наличии кода.
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
      // Любая транспортная неопределённость трактуется консервативно как timeout.
      outcome = 'timeout';
      detail = this.errorMessage(error);
    }
    // Итог request и неизменяемая запись attempt сохраняются совместно.
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

  /** Атомарно закрепляет fulfillment, финальный статус и успех job. */
  private async complete(
    jobId: bigint,
    orderId: bigint,
    result: Extract<ProviderResult, { kind: 'ok' }>,
  ): Promise<boolean> {
    await prisma.$transaction(async (tx) => {
      // FOR UPDATE сериализует возможные параллельные завершения одного заказа.
      const [locked] = await tx.$queryRaw<Array<{ status: OrderStatus }>>`
        SELECT status::text FROM orders WHERE id = ${orderId} FOR UPDATE
      `;
      const existing = await tx.fulfillment.findUnique({ where: { orderId } });
      // UNIQUE(order_id) и UNIQUE(code) дублируют эту проверку на уровне БД.
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

  /** Возвращает неоднозначную попытку в очередь с ограниченным числом повторов. */
  private async retry(job: ClaimedJob, reason: string): Promise<boolean> {
    if (job.attempts >= 6) return this.recoverable(job.id, job.order_id, 'delivery_failed');
    // Тот же job и provider request будут использованы снова — новые сущности не создаются.
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

  /** Фиксирует восстановимый бизнес-исход и завершает автоматическую обработку job. */
  private async recoverable(
    jobId: bigint,
    orderId: bigint,
    status: 'out_of_stock' | 'delivery_failed',
  ): Promise<boolean> {
    await prisma.$transaction(async (tx) => {
      const order = await tx.order.findUniqueOrThrow({ where: { id: orderId } });
      // Терминальный delivered никогда не регрессирует даже при запоздалом worker'е.
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

  /** Пишет машиночитаемый JSON с correlation-полями для поиска одного заказа. */
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

  /** Безопасно приводит неизвестное исключение к строке для structured log. */
  private errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }
}
