import { existsSync } from 'node:fs';
import { loadEnvFile } from 'node:process';
import { randomUUID } from 'node:crypto';
import { INITIAL_PROVIDER_KEYS, prisma } from '../../packages/database/src/index.js';
import { LiveShopClient, assertCondition, newIntent } from '../support/live-shop.js';

// Локальный запуск читает безопасный developer-файл; CI/production env имеют приоритет.
if (!process.env.CI && existsSync('.env')) loadEnvFile('.env');

const client = new LiveShopClient(
  process.env.BASE_URL ?? 'http://127.0.0.1:4000',
  process.env.ADMIN_TOKEN ?? 'change-me-locally',
);

type ScenarioResult = { name: string; durationMs: number };
const results: ScenarioResult[] = [];

/** Опросом ждёт произвольное состояние БД с ограниченным сроком ожидания. */
async function waitForDatabase(
  predicate: () => Promise<boolean>,
  message: string,
  timeoutMs = 10_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(message);
}

/** Проверяет три независимых доказательства однократности: fulfillment, key и event count. */
async function assertSingleIssue(orderId: string, expectedEvents: number): Promise<void> {
  const order = await prisma.order.findUniqueOrThrow({ where: { publicId: orderId } });
  const [fulfillments, events, requests, jobs] = await Promise.all([
    prisma.fulfillment.count({ where: { orderId: order.id } }),
    prisma.paymentEvent.count({ where: { orderPublicId: orderId } }),
    prisma.providerRequest.findMany({ where: { orderId: order.id }, select: { requestId: true } }),
    prisma.deliveryJob.count({ where: { orderId: order.id } }),
  ]);
  const spentKeys = await prisma.providerKey.count({
    where: { requestId: { in: requests.map((item) => item.requestId) } },
  });
  assertCondition(
    fulfillments === 1 && spentKeys === 1 && events === expectedEvents && jobs === 1,
    JSON.stringify({ orderId, fulfillments, spentKeys, events, expectedEvents, jobs }),
  );
}

/** Выполняет один именованный сценарий и печатает пригодное для CI доказательство времени/успеха. */
async function scenario(name: string, check: () => Promise<void>): Promise<void> {
  const started = Date.now();
  await check();
  const durationMs = Date.now() - started;
  results.push({ name, durationMs });
  console.log(`✓ ${name} (${durationMs} ms)`);
}

/** Проверяет технические endpoints, полный OpenAPI, seed-каталог и fail-closed admin guard. */
async function verifyContracts(): Promise<void> {
  await client.reset();
  const [
    live,
    ready,
    catalog,
    openapi,
    metrics,
    docs,
    tutorial,
    offline,
    readme,
    codemap,
    unauthorized,
  ] = await Promise.all([
    client.json<{ status: string }>('/api/health/live'),
    client.json<{ status: string }>('/api/health/ready'),
    client.json<Array<{ sku: string; priceMinor: number; currency: string }>>(
      '/api/v1/catalog/products',
    ),
    client.json<{ paths?: Record<string, Record<string, unknown>> }>('/api/openapi.json'),
    client.text('/api/metrics'),
    client.text('/api/docs'),
    client.text('/docs/tutorial/'),
    client.text('/docs/offline/'),
    client.text('/docs/README.md'),
    client.text('/docs/CODEMAP.md'),
    client.json('/api/v1/admin/recovery/orders'),
  ]);
  assertCondition(live.status === 200 && live.body.status === 'ok', 'Liveness failed');
  assertCondition(ready.status === 200 && ready.body.status === 'ok', 'Readiness failed');
  assertCondition(
    catalog.status === 200 && catalog.body.length === 12,
    'Catalog seed is incomplete',
  );
  const steam = catalog.body.find((item) => item.sku === 'STEAM-TOPUP-500');
  assertCondition(
    steam?.priceMinor === 50_000 && steam.currency === 'RUB',
    'Server catalog price differs from the assignment material',
  );
  const requiredOperations: Array<[string, string]> = [
    ['/api/v1/catalog/products', 'get'],
    ['/api/v1/orders', 'post'],
    ['/api/v1/orders/{orderId}', 'get'],
    ['/api/v1/payments/simulate', 'post'],
    ['/api/v1/webhooks/payment', 'post'],
    ['/api/v1/promocodes/quote', 'post'],
    ['/api/v1/admin/recovery/orders', 'get'],
    ['/api/v1/admin/orders/{orderId}/retry-delivery', 'post'],
    ['/api/v1/admin/providers/keys', 'post'],
    ['/api/v1/admin/providers/mode', 'post'],
    ['/api/v1/admin/demo/reset', 'post'],
    ['/api/health/live', 'get'],
    ['/api/health/ready', 'get'],
    ['/api/metrics', 'get'],
  ];
  for (const [path, method] of requiredOperations) {
    assertCondition(openapi.body.paths?.[path]?.[method], `OpenAPI is missing ${method} ${path}`);
  }
  assertCondition(
    metrics.status === 200 && metrics.body.includes('shop_delivery_queue_length'),
    'Prometheus metrics are incomplete',
  );
  assertCondition(
    docs.status === 200 && docs.body.includes('swagger-ui'),
    'Swagger UI is unavailable',
  );
  // Публичный домен и локальный стек должны раздавать один и тот же учебный комплект.
  assertCondition(
    tutorial.status === 200 &&
      tutorial.body.includes('Fullstack Test Shop — интерактивный учебник') &&
      offline.status === 200 &&
      offline.body.includes('Исходный код, который можно изучать офлайн') &&
      readme.status === 200 &&
      readme.body.includes('# fullstack-test-shop') &&
      codemap.status === 200 &&
      codemap.body.includes('# CODEMAP: от требования к точной строке кода'),
    'Public documentation bundle is unavailable or stale',
  );
  assertCondition(unauthorized.status === 401, 'Admin API is not fail-closed');

  const malformed = await client.json('/api/v1/orders/not-a-uuid');
  assertCondition(malformed.status === 400, 'Malformed public UUID must return HTTP 400');
}

/** Доказывает HTTP/DB-идемпотентность заказа и недоверие к цене клиента. */
async function verifyOrderIdempotency(): Promise<void> {
  await client.reset();
  const intent = newIntent();
  const doubleClick = await Promise.all([
    client.createOrder({ intent }),
    client.createOrder({ intent }),
  ]);
  const statuses = doubleClick.map((item) => item.status).sort();
  assertCondition(
    statuses[0] === 200 && statuses[1] === 201,
    `Double click returned ${statuses.join(', ')}`,
  );
  assertCondition(
    doubleClick[0].body.orderId === doubleClick[1].body.orderId,
    'Double click created different public orders',
  );
  assertCondition(
    (await prisma.order.count({ where: { idempotencyKey: intent.idempotencyKey } })) === 1,
    'Double click inserted more than one order row',
  );

  const changedPayload = await client.createOrder({ intent, sku: 'STEAM-TOPUP-1000' });
  assertCondition(
    changedPayload.status === 409,
    'Changed idempotency payload must return HTTP 409',
  );
  const reusedPublicId = await client.createOrder({
    intent: { orderId: intent.orderId, idempotencyKey: randomUUID() },
  });
  assertCondition(reusedPublicId.status === 409, 'Reused public orderId must return HTTP 409');

  const beforeTamper = await prisma.order.count();
  const tampered = await client.createOrder({ extraBody: { finalPriceMinor: 1, currency: 'USD' } });
  assertCondition(tampered.status === 400, 'Client-controlled money fields must be rejected');
  assertCondition(
    (await prisma.order.count()) === beforeTamper,
    'Tampered request inserted an order',
  );
  assertCondition(
    doubleClick[0].body.finalPriceMinor === 50_000 && doubleClick[0].body.currency === 'RUB',
    'Order did not use the server catalog snapshot',
  );
}

/** Атакует один заказ 50 одинаковыми webhook и доказывает полный no-op повторов event_id. */
async function verifyDuplicateWebhooks(): Promise<void> {
  await client.reset();
  const order = await client.createOrder();
  assertCondition(order.status === 201, 'Order creation failed');
  const eventId = `evt_${randomUUID()}`;
  const deliveries = await Promise.all(
    Array.from({ length: 50 }, () => client.webhook({ orderId: order.body.orderId, eventId })),
  );
  assertCondition(
    deliveries.every((item) => item.status === 200),
    'Webhook did not answer 200',
  );
  const delivered = await client.waitForStatus(order.body.orderId, 'delivered');
  await assertSingleIssue(order.body.orderId, 1);

  const snapshot = {
    status: delivered.status,
    code: delivered.code,
    history: delivered.history.map((item) => `${item.from}->${item.to}:${item.reason}`),
  };
  await Promise.all(
    Array.from({ length: 10 }, () => client.webhook({ orderId: order.body.orderId, eventId })),
  );
  await new Promise((resolve) => setTimeout(resolve, 300));
  const replayed = (await client.order(order.body.orderId)).body;
  assertCondition(
    JSON.stringify({
      status: replayed.status,
      code: replayed.code,
      history: replayed.history.map((item) => `${item.from}->${item.to}:${item.reason}`),
    }) === JSON.stringify(snapshot),
    'Repeated event_id changed the delivered order',
  );
  await assertSingleIssue(order.body.orderId, 1);
}

/** Сохраняет 50 разных paid events, но допускает только одну job, выдачу и потраченный ключ. */
async function verifyUniquePaidRace(): Promise<void> {
  await client.reset();
  const order = await client.createOrder();
  const deliveries = await Promise.all(
    Array.from({ length: 50 }, () => client.webhook({ orderId: order.body.orderId })),
  );
  assertCondition(
    deliveries.every((item) => item.status === 200),
    'A paid webhook was rejected',
  );
  await client.waitForStatus(order.body.orderId, 'delivered');
  await assertSingleIssue(order.body.orderId, 50);
}

/** Проверяет раннее событие, failed→paid и запрет регрессии delivered от позднего failed. */
async function verifyEarlyAndUnorderedEvents(): Promise<void> {
  await client.reset();
  const earlyIntent = newIntent();
  const earlyEventId = `evt_${randomUUID()}`;
  const early = await client.webhook({ orderId: earlyIntent.orderId, eventId: earlyEventId });
  assertCondition(early.status === 200, 'Early webhook was not durably accepted');
  assertCondition(
    (await prisma.paymentEvent.findUnique({ where: { eventId: earlyEventId } }))?.inboxState ===
      'pending',
    'Early webhook was not retained as pending',
  );
  await client.createOrder({ intent: earlyIntent });
  await client.waitForStatus(earlyIntent.orderId, 'delivered');
  await assertSingleIssue(earlyIntent.orderId, 1);

  const unordered = await client.createOrder();
  await client.webhook({ orderId: unordered.body.orderId, status: 'failed' });
  await client.waitForStatus(unordered.body.orderId, 'payment_failed');
  await client.webhook({ orderId: unordered.body.orderId, status: 'paid' });
  const delivered = await client.waitForStatus(unordered.body.orderId, 'delivered');
  const code = delivered.code;
  await client.webhook({ orderId: unordered.body.orderId, status: 'failed' });
  await waitForDatabase(
    async () =>
      (await prisma.paymentEvent.count({ where: { orderPublicId: unordered.body.orderId } })) === 3,
    'Late failed event was not processed',
  );
  const afterLateFailure = (await client.order(unordered.body.orderId)).body;
  assertCondition(
    afterLateFailure.status === 'delivered' && afterLateFailure.code === code,
    'Late failed event regressed a delivered order',
  );
  await assertSingleIssue(unordered.body.orderId, 3);
}

/** Доказывает, что несовпавшие сумма и валюта помечаются invalid и не запускают выдачу. */
async function verifyPaymentSnapshotValidation(): Promise<void> {
  await client.reset();
  const order = await client.createOrder();
  const amountEvent = `evt_${randomUUID()}`;
  const currencyEvent = `evt_${randomUUID()}`;
  await Promise.all([
    client.webhook({ orderId: order.body.orderId, eventId: amountEvent, amount: 499 }),
    client.webhook({ orderId: order.body.orderId, eventId: currencyEvent, currency: 'USD' }),
  ]);
  await waitForDatabase(
    async () =>
      (await prisma.paymentEvent.count({
        where: { eventId: { in: [amountEvent, currencyEvent] }, inboxState: 'invalid' },
      })) === 2,
    'Invalid payment events were not quarantined',
  );
  const record = await prisma.order.findUniqueOrThrow({ where: { publicId: order.body.orderId } });
  assertCondition(record.status === 'created', 'Invalid money event changed the order status');
  assertCondition(
    (await prisma.deliveryJob.count({ where: { orderId: record.id } })) === 0,
    'Invalid money event created a delivery job',
  );
}

/** Проверяет реальный HTTP payment simulator вместо прямого вызова внутреннего сервиса. */
async function verifyPaymentSimulator(): Promise<void> {
  await client.reset();
  const order = await client.createOrder();
  const simulated = await client.simulate(order.body.orderId, 'paid');
  assertCondition(
    simulated.status === 201 &&
      simulated.body.accepted &&
      simulated.body.eventId.startsWith('evt_'),
    'Payment simulator did not deliver a webhook',
  );
  await client.waitForStatus(order.body.orderId, 'delivered');
  await assertSingleIssue(order.body.orderId, 1);
}

/** Опустошает оба реальных пула и проверяет recovery, пополнение и повторный идемпотентный retry. */
async function verifyOutOfStockRecovery(): Promise<void> {
  await client.reset();
  await prisma.providerKey.deleteMany();
  const order = await client.createOrder();
  await client.webhook({ orderId: order.body.orderId });
  await client.waitForStatus(order.body.orderId, 'out_of_stock');
  const recovery = await client.adminGet<Array<{ orderId: string; status: string }>>(
    '/api/v1/admin/recovery/orders',
  );
  assertCondition(
    recovery.status === 200 &&
      recovery.body.some(
        (item) => item.orderId === order.body.orderId && item.status === 'out_of_stock',
      ),
    'Recoverable order is absent from admin list',
  );
  const added = await client.adminPost<{ added: number }>('/api/v1/admin/providers/keys', {
    providerId: 'A',
    sku: 'STEAM-TOPUP-500',
    codes: ['RACE-RECOVERY-0001'],
  });
  assertCondition(added.status === 201 && added.body.added === 1, 'Provider pool top-up failed');
  const retries = await Promise.all([
    client.adminPost<{ accepted: boolean }>(
      `/api/v1/admin/orders/${order.body.orderId}/retry-delivery`,
    ),
    client.adminPost<{ accepted: boolean }>(
      `/api/v1/admin/orders/${order.body.orderId}/retry-delivery`,
    ),
  ]);
  assertCondition(
    retries.every((item) => item.status === 202),
    'Concurrent manual retry failed',
  );
  await client.waitForStatus(order.body.orderId, 'delivered');
  await assertSingleIssue(order.body.orderId, 1);
  const noOp = await client.adminPost<{ alreadyDelivered: boolean }>(
    `/api/v1/admin/orders/${order.body.orderId}/retry-delivery`,
  );
  assertCondition(noOp.body.alreadyDelivered, 'Retry of delivered order was not a no-op');
  await assertSingleIssue(order.body.orderId, 1);
}

/** Воспроизводит главную timeout-ловушку и запрещает небезопасный переход на Provider B. */
async function verifyTimeoutReplay(): Promise<void> {
  await client.reset();
  await client.adminPost('/api/v1/admin/providers/mode', {
    providerId: 'A',
    mode: 'timeout_after_issue',
    delayMs: 1500,
  });
  const order = await client.createOrder();
  await client.webhook({ orderId: order.body.orderId });
  await client.waitForStatus(order.body.orderId, 'delivered');
  await assertSingleIssue(order.body.orderId, 1);
  const record = await prisma.order.findUniqueOrThrow({ where: { publicId: order.body.orderId } });
  const [attempts, requestsB] = await Promise.all([
    prisma.providerCallAttempt.groupBy({
      by: ['outcome'],
      where: { providerRequest: { orderId: record.id, providerId: 'A' } },
      _count: { _all: true },
    }),
    prisma.providerRequest.count({ where: { orderId: record.id, providerId: 'B' } }),
  ]);
  assertCondition(
    attempts.some((item) => item.outcome === 'timeout') &&
      attempts.some((item) => item.outcome === 'success'),
    `Timeout replay outcomes are incomplete: ${JSON.stringify(attempts)}`,
  );
  assertCondition(requestsB === 0, 'Ambiguous Provider A timeout incorrectly fell back to B');
}

/** Проверяет безопасный fallback A→B только после однозначного ответа out_of_stock. */
async function verifyProviderFallback(): Promise<void> {
  await client.reset();
  await client.adminPost('/api/v1/admin/providers/mode', {
    providerId: 'A',
    mode: 'out_of_stock',
  });
  const order = await client.createOrder();
  await client.webhook({ orderId: order.body.orderId });
  await client.waitForStatus(order.body.orderId, 'delivered');
  const record = await prisma.order.findUniqueOrThrow({
    where: { publicId: order.body.orderId },
    include: { fulfillment: true },
  });
  assertCondition(record.fulfillment?.providerId === 'B', 'Provider B fallback was not used');
  await assertSingleIssue(order.body.orderId, 1);
}

/** Делает обоих поставщиков недоступными, затем восстанавливает заказ теми же request IDs. */
async function verifyDeliveryFailureRecovery(): Promise<void> {
  await client.reset();
  await Promise.all(
    ['A', 'B'].map((providerId) =>
      client.adminPost('/api/v1/admin/providers/mode', {
        providerId,
        mode: 'server_error_before_issue',
      }),
    ),
  );
  const order = await client.createOrder();
  await client.webhook({ orderId: order.body.orderId });
  await client.waitForStatus(order.body.orderId, 'delivery_failed');
  const dbOrder = await prisma.order.findUniqueOrThrow({ where: { publicId: order.body.orderId } });
  const requestIdsBefore = (
    await prisma.providerRequest.findMany({
      where: { orderId: dbOrder.id },
      orderBy: { providerId: 'asc' },
      select: { requestId: true },
    })
  ).map((item) => item.requestId);
  assertCondition(requestIdsBefore.length === 2, 'Both provider attempts were not persisted');

  await Promise.all(
    ['A', 'B'].map((providerId) =>
      client.adminPost('/api/v1/admin/providers/mode', { providerId, mode: 'success' }),
    ),
  );
  await client.adminPost(`/api/v1/admin/orders/${order.body.orderId}/retry-delivery`);
  await client.waitForStatus(order.body.orderId, 'delivered');
  const requestIdsAfter = (
    await prisma.providerRequest.findMany({
      where: { orderId: dbOrder.id },
      orderBy: { providerId: 'asc' },
      select: { requestId: true },
    })
  ).map((item) => item.requestId);
  assertCondition(
    JSON.stringify(requestIdsAfter) === JSON.stringify(requestIdsBefore),
    'Recovery replaced stable provider request IDs',
  );
  await assertSingleIssue(order.body.orderId, 1);
}

/** Проверяет quote, идемпотентный redemption и строгий LIMIT3 под 50 конкурентными заказами. */
async function verifyPromocodes(): Promise<void> {
  await client.reset();
  const quote = await client.json<{
    basePriceMinor: number;
    discountMinor: number;
    finalPriceMinor: number;
    remainingUses: number;
  }>('/api/v1/promocodes/quote', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ sku: 'STEAM-TOPUP-500', promoCode: ' welcome10 ' }),
  });
  assertCondition(
    quote.status === 201 &&
      quote.body.basePriceMinor === 50_000 &&
      quote.body.discountMinor === 5_000 &&
      quote.body.finalPriceMinor === 45_000 &&
      quote.body.remainingUses === 100,
    'WELCOME10 quote is incorrect',
  );
  assertCondition(
    (await prisma.promocode.findUniqueOrThrow({ where: { code: 'WELCOME10' } })).usedCount === 0,
    'Quote consumed a promocode use',
  );

  const onceIntent = newIntent();
  const once = await client.createOrder({ promoCode: 'ONCEONLY', intent: onceIntent });
  const onceReplay = await client.createOrder({ promoCode: ' onceonly ', intent: onceIntent });
  const onceRejected = await client.createOrder({ promoCode: 'ONCEONLY' });
  assertCondition(
    once.status === 201 && onceReplay.status === 200,
    'Promo replay is not idempotent',
  );
  assertCondition(onceRejected.status === 409, 'ONCEONLY exceeded max_uses=1');
  assertCondition(
    (await prisma.promocode.findUniqueOrThrow({ where: { code: 'ONCEONLY' } })).usedCount === 1,
    'Idempotent promo replay incremented used_count twice',
  );

  await client.reset();
  const concurrent = await Promise.all(
    Array.from({ length: 50 }, () => client.createOrder({ promoCode: 'LIMIT3' })),
  );
  const successes = concurrent.filter((item) => item.status === 201).length;
  const conflicts = concurrent.filter((item) => item.status === 409).length;
  const promo = await prisma.promocode.findUniqueOrThrow({ where: { code: 'LIMIT3' } });
  const redemptions = await prisma.promoRedemption.count({ where: { promocodeId: promo.id } });
  assertCondition(
    successes === 3 && conflicts === 47 && promo.usedCount === 3 && redemptions === 3,
    JSON.stringify({ successes, conflicts, usedCount: promo.usedCount, redemptions }),
  );
}

/** Проверяет детерминированный reset и его отказ удалять данные при processing job. */
async function verifySafeReset(): Promise<void> {
  await client.reset();
  const order = await client.createOrder();
  const dbOrder = await prisma.order.findUniqueOrThrow({ where: { publicId: order.body.orderId } });
  await prisma.deliveryJob.create({
    data: {
      orderId: dbOrder.id,
      status: 'processing',
      workerId: 'acceptance-lock',
      leaseUntil: new Date(Date.now() + 60_000),
    },
  });
  const blocked = await client.adminPost('/api/v1/admin/demo/reset');
  assertCondition(blocked.status === 503, 'Reset did not reject an active processing job');
  assertCondition((await prisma.order.count()) === 1, 'Blocked reset deleted demo data');
  await prisma.deliveryJob.update({
    where: { orderId: dbOrder.id },
    data: { status: 'failed', leaseUntil: null },
  });
  await client.reset();
  const [orders, events, keys, usedPromos, badModes] = await Promise.all([
    prisma.order.count(),
    prisma.paymentEvent.count(),
    prisma.providerKey.count(),
    prisma.promocode.count({ where: { usedCount: { not: 0 } } }),
    prisma.providerSetting.count({ where: { faultMode: { not: 'success' } } }),
  ]);
  assertCondition(
    orders === 0 &&
      events === 0 &&
      keys === INITIAL_PROVIDER_KEYS.length &&
      usedPromos === 0 &&
      badModes === 0,
    JSON.stringify({ orders, events, keys, usedPromos, badModes }),
  );
}

/** Последовательно запускает полную приемочную матрицу на живом API и настоящем PostgreSQL. */
async function main(): Promise<void> {
  const checks: Array<[string, () => Promise<void>]> = [
    ['contracts, seed, health, metrics and admin protection', verifyContracts],
    ['double click, idempotency conflicts and server-owned price', verifyOrderIdempotency],
    ['50 identical webhooks and strict duplicate no-op', verifyDuplicateWebhooks],
    ['50 unique paid webhooks: one job, fulfillment and key', verifyUniquePaidRace],
    ['early and unordered payment events without regression', verifyEarlyAndUnorderedEvents],
    ['amount and currency snapshot validation', verifyPaymentSnapshotValidation],
    ['payment simulator delivers a real webhook', verifyPaymentSimulator],
    ['empty pools, admin recovery and idempotent retry', verifyOutOfStockRecovery],
    ['timeout-after-issue reuses A request and never calls B', verifyTimeoutReplay],
    ['explicit Provider A out-of-stock safely falls back to B', verifyProviderFallback],
    [
      'both providers failing remain recoverable with stable request IDs',
      verifyDeliveryFailureRecovery,
    ],
    ['promo quote, replay and LIMIT3 under 50 requests', verifyPromocodes],
    ['reset is deterministic and blocked by processing jobs', verifySafeReset],
  ];
  for (const [name, check] of checks) await scenario(name, check);
  console.log(`\nAcceptance complete: ${results.length}/${checks.length} scenarios passed.`);
}

// CLI всегда закрывает Prisma и возвращает ненулевой exit code при любой нарушенной гарантии.
main()
  .then(() => prisma.$disconnect())
  .catch(async (error: unknown) => {
    console.error(error);
    await prisma.$disconnect();
    process.exitCode = 1;
  });
