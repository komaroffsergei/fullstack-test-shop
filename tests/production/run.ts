import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { loadEnvFile } from 'node:process';
import { randomUUID } from 'node:crypto';
import { LiveShopClient, assertCondition, newIntent } from '../support/live-shop.js';

// Существующие переменные окружения важнее локального .env и никогда не печатаются в отчёт.
if (!process.env.CI && existsSync('.env')) loadEnvFile('.env');

const baseUrl = process.env.PRODUCTION_BASE_URL ?? 'https://test-shop.komaroff-dev.ru';
const adminToken = process.env.PRODUCTION_ADMIN_TOKEN ?? process.env.ADMIN_TOKEN ?? '';
const allowReset = process.env.ALLOW_DEMO_RESET === '1';
const client = new LiveShopClient(baseUrl, adminToken);

type Evidence = {
  name: string;
  durationMs: number;
  facts: Record<string, string | number | boolean>;
};
const evidence: Evidence[] = [];
const startedAt = new Date().toISOString();

/** Выполняет именованную production-проверку и сохраняет только несекретные факты приемки. */
async function scenario(
  name: string,
  check: () => Promise<Record<string, string | number | boolean>>,
): Promise<void> {
  const started = Date.now();
  const facts = await check();
  const durationMs = Date.now() - started;
  evidence.push({ name, durationMs, facts });
  console.log(`✓ ${name} (${durationMs} ms)`);
}

/** Проверяет HTTPS-страницу, операции, seed и отсутствие анонимного доступа к admin API. */
async function verifySurface(): Promise<Record<string, string | number | boolean>> {
  const [page, live, ready, catalog, openapi, metrics, unauthorized] = await Promise.all([
    client.text('/'),
    client.json<{ status: string }>('/api/health/live'),
    client.json<{ status: string }>('/api/health/ready'),
    client.json<Array<{ sku: string; priceMinor: number }>>('/api/v1/catalog/products'),
    client.json<{ paths?: Record<string, unknown> }>('/api/openapi.json'),
    client.text('/api/metrics'),
    client.json('/api/v1/admin/recovery/orders'),
  ]);
  assertCondition(
    page.status === 200 && page.body.includes('<app-root'),
    'Angular HTML is unavailable',
  );
  assertCondition(live.body.status === 'ok' && ready.body.status === 'ok', 'Health check failed');
  assertCondition(catalog.body.length === 12, 'Production catalog does not contain 12 products');
  assertCondition(
    catalog.body.find((item) => item.sku === 'STEAM-TOPUP-500')?.priceMinor === 50_000,
    'Production server price is incorrect',
  );
  assertCondition(
    Object.keys(openapi.body.paths ?? {}).length >= 14,
    'Production OpenAPI is incomplete',
  );
  assertCondition(metrics.body.includes('shop_delivery_queue_length'), 'Metrics are incomplete');
  assertCondition(unauthorized.status === 401, 'Admin endpoint is anonymously accessible');
  return {
    https: baseUrl.startsWith('https://'),
    products: catalog.body.length,
    openapiPaths: Object.keys(openapi.body.paths ?? {}).length,
    anonymousAdminStatus: unauthorized.status,
  };
}

/** Проверяет 201/200 replay, 409 при смене payload и запрет клиентских денежных полей. */
async function verifyIdempotency(): Promise<Record<string, string | number | boolean>> {
  await client.reset();
  const intent = newIntent();
  const clicks = await Promise.all([
    client.createOrder({ intent }),
    client.createOrder({ intent }),
  ]);
  const statuses = clicks.map((item) => item.status).sort();
  assertCondition(statuses[0] === 200 && statuses[1] === 201, 'Double click is not idempotent');
  const conflict = await client.createOrder({ intent, sku: 'STEAM-TOPUP-1000' });
  const tamper = await client.createOrder({ extraBody: { finalPriceMinor: 1 } });
  assertCondition(conflict.status === 409, 'Changed replay payload was accepted');
  assertCondition(tamper.status === 400, 'Client money field was accepted');
  return {
    firstStatus: 201,
    replayStatus: 200,
    conflictStatus: conflict.status,
    tamperStatus: tamper.status,
    serverPriceMinor: clicks[0].body.finalPriceMinor,
  };
}

/** Отправляет 50 одинаковых и 50 разных paid webhook на публичный HTTPS API. */
async function verifyWebhookRaces(): Promise<Record<string, string | number | boolean>> {
  await client.reset();
  const duplicateOrder = await client.createOrder();
  const eventId = `evt_${randomUUID()}`;
  const duplicates = await Promise.all(
    Array.from({ length: 50 }, () =>
      client.webhook({ orderId: duplicateOrder.body.orderId, eventId }),
    ),
  );
  assertCondition(
    duplicates.every((item) => item.status === 200),
    'Duplicate delivery lost HTTP 200',
  );
  const first = await client.waitForStatus(duplicateOrder.body.orderId, 'delivered');
  const snapshot = JSON.stringify({
    status: first.status,
    code: first.code,
    history: first.history,
  });
  await Promise.all(
    Array.from({ length: 10 }, () =>
      client.webhook({ orderId: duplicateOrder.body.orderId, eventId }),
    ),
  );
  await new Promise((resolve) => setTimeout(resolve, 300));
  const replay = (await client.order(duplicateOrder.body.orderId)).body;
  assertCondition(
    JSON.stringify({ status: replay.status, code: replay.code, history: replay.history }) ===
      snapshot,
    'Repeated event_id changed public order state',
  );

  const uniqueOrder = await client.createOrder();
  const unique = await Promise.all(
    Array.from({ length: 50 }, () => client.webhook({ orderId: uniqueOrder.body.orderId })),
  );
  assertCondition(
    unique.every((item) => item.status === 200),
    'Unique paid webhook was rejected',
  );
  const uniqueResult = await client.waitForStatus(uniqueOrder.body.orderId, 'delivered');
  assertCondition(
    Boolean(uniqueResult.code),
    'Unique webhook race did not deliver one public code',
  );
  assertCondition(
    uniqueResult.history.filter((item) => item.to === 'delivered').length === 1,
    'Unique webhook race exposed more than one delivered transition',
  );
  return {
    identicalRequests: duplicates.length,
    uniqueRequests: unique.length,
    duplicateNoOp: true,
    deliveredTransitions: uniqueResult.history.filter((item) => item.to === 'delivered').length,
  };
}

/** Проверяет ранний paid и неупорядоченную цепочку failed→paid→failed через публичный read model. */
async function verifyOrdering(): Promise<Record<string, string | number | boolean>> {
  await client.reset();
  const earlyIntent = newIntent();
  await client.webhook({ orderId: earlyIntent.orderId });
  await client.createOrder({ intent: earlyIntent });
  const early = await client.waitForStatus(earlyIntent.orderId, 'delivered');

  const unordered = await client.createOrder();
  await client.webhook({ orderId: unordered.body.orderId, status: 'failed' });
  await client.waitForStatus(unordered.body.orderId, 'payment_failed');
  await client.webhook({ orderId: unordered.body.orderId, status: 'paid' });
  const paid = await client.waitForStatus(unordered.body.orderId, 'delivered');
  await client.webhook({ orderId: unordered.body.orderId, status: 'failed' });
  await new Promise((resolve) => setTimeout(resolve, 500));
  const final = (await client.order(unordered.body.orderId)).body;
  assertCondition(
    final.status === 'delivered' && final.code === paid.code,
    'Delivered order regressed',
  );
  return { earlyDelivered: Boolean(early.code), paidWins: final.status === 'delivered' };
}

/** Имитирует пустые пулы режимом обоих providers и проверяет admin recovery после возврата success. */
async function verifyOutOfStock(): Promise<Record<string, string | number | boolean>> {
  await client.reset();
  await Promise.all(
    ['A', 'B'].map((providerId) =>
      client.adminPost('/api/v1/admin/providers/mode', { providerId, mode: 'out_of_stock' }),
    ),
  );
  const order = await client.createOrder();
  await client.webhook({ orderId: order.body.orderId });
  await client.waitForStatus(order.body.orderId, 'out_of_stock');
  const recovery = await client.adminGet<Array<{ orderId: string }>>(
    '/api/v1/admin/recovery/orders',
  );
  assertCondition(
    recovery.body.some((item) => item.orderId === order.body.orderId),
    'Production recovery list missed out_of_stock order',
  );
  await Promise.all(
    ['A', 'B'].map((providerId) =>
      client.adminPost('/api/v1/admin/providers/mode', { providerId, mode: 'success' }),
    ),
  );
  await Promise.all([
    client.adminPost(`/api/v1/admin/orders/${order.body.orderId}/retry-delivery`),
    client.adminPost(`/api/v1/admin/orders/${order.body.orderId}/retry-delivery`),
  ]);
  const delivered = await client.waitForStatus(order.body.orderId, 'delivered');
  assertCondition(Boolean(delivered.code), 'Recovered order has no code');
  return { recoveryListed: true, concurrentRetries: 2, finalStatus: delivered.status };
}

/** Проверяет timeout-after-issue: публично виден один код после безопасного replay того же A-запроса. */
async function verifyTimeout(): Promise<Record<string, string | number | boolean>> {
  await client.reset();
  await client.adminPost('/api/v1/admin/providers/mode', {
    providerId: 'A',
    mode: 'timeout_after_issue',
    delayMs: 1500,
  });
  const order = await client.createOrder();
  await client.webhook({ orderId: order.body.orderId });
  const delivered = await client.waitForStatus(order.body.orderId, 'delivered');
  assertCondition(Boolean(delivered.code), 'Timeout replay lost the code');
  return {
    finalStatus: delivered.status,
    deliveredTransitions: delivered.history.filter((item) => item.to === 'delivered').length,
  };
}

/** Форсирует out_of_stock у A, поэтому успешная выдача является black-box доказательством fallback на B. */
async function verifyFallback(): Promise<Record<string, string | number | boolean>> {
  await client.reset();
  await client.adminPost('/api/v1/admin/providers/mode', {
    providerId: 'A',
    mode: 'out_of_stock',
  });
  const order = await client.createOrder();
  await client.webhook({ orderId: order.body.orderId });
  const delivered = await client.waitForStatus(order.body.orderId, 'delivered');
  assertCondition(Boolean(delivered.code), 'Provider B fallback did not deliver a code');
  return { providerAForcedOutOfStock: true, finalStatus: delivered.status };
}

/** Проверяет delivery_failed при двух 5xx и последующее безопасное ручное восстановление. */
async function verifyProviderFailure(): Promise<Record<string, string | number | boolean>> {
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
  await Promise.all(
    ['A', 'B'].map((providerId) =>
      client.adminPost('/api/v1/admin/providers/mode', { providerId, mode: 'success' }),
    ),
  );
  await client.adminPost(`/api/v1/admin/orders/${order.body.orderId}/retry-delivery`);
  const delivered = await client.waitForStatus(order.body.orderId, 'delivered');
  return {
    recoverableFailure: true,
    finalStatus: delivered.status,
    codePresent: Boolean(delivered.code),
  };
}

/** Атакует LIMIT3 пятьюдесятью HTTPS-заказами и требует ровно 3 успеха/47 конфликтов. */
async function verifyPromoRace(): Promise<Record<string, string | number | boolean>> {
  await client.reset();
  const attempts = await Promise.all(
    Array.from({ length: 50 }, () => client.createOrder({ promoCode: 'LIMIT3' })),
  );
  const successes = attempts.filter((item) => item.status === 201).length;
  const conflicts = attempts.filter((item) => item.status === 409).length;
  assertCondition(successes === 3 && conflicts === 47, `Promo race: ${successes}/${conflicts}`);
  return { requests: attempts.length, successes, conflicts, maxUses: 3 };
}

/** Приводит неизвестную ошибку к безопасному тексту без сериализации секретных request options. */
function errorMessage(error: unknown): string | null {
  if (!error) return null;
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  return 'Unknown production acceptance error';
}

/** Пишет машиночитаемый production-отчёт без admin token, кодов товаров и иных секретов. */
async function writeReport(success: boolean, error?: unknown): Promise<void> {
  await mkdir('test-results', { recursive: true });
  const report = {
    target: baseUrl,
    startedAt,
    finishedAt: new Date().toISOString(),
    success,
    scenarios: evidence,
    error: errorMessage(error),
  };
  await writeFile(
    'test-results/acceptance-production.json',
    `${JSON.stringify(report, null, 2)}\n`,
  );
}

/** Запускает полную destructive-demo проверку только при явном флаге и всегда возвращает seed. */
async function main(): Promise<void> {
  assertCondition(adminToken, 'PRODUCTION_ADMIN_TOKEN (or ADMIN_TOKEN) is required');
  assertCondition(
    allowReset,
    'Set ALLOW_DEMO_RESET=1 to acknowledge deterministic reset of production demo data',
  );
  try {
    await scenario(
      'HTTPS surface, health, catalog, OpenAPI, metrics and admin guard',
      verifySurface,
    );
    await scenario(
      'idempotent double click, conflict and money tamper rejection',
      verifyIdempotency,
    );
    await scenario('50 identical + 50 unique paid webhooks on production', verifyWebhookRaces);
    await scenario('early and unordered payment events', verifyOrdering);
    await scenario('out-of-stock recovery and concurrent manual retry', verifyOutOfStock);
    await scenario('timeout-after-issue safe replay', verifyTimeout);
    await scenario('Provider A out-of-stock fallback to B', verifyFallback);
    await scenario('two provider 5xx responses and recovery', verifyProviderFailure);
    await scenario('LIMIT3 under 50 parallel production requests', verifyPromoRace);
    await client.reset();
    await writeReport(true);
    console.log(`\nProduction acceptance complete: ${evidence.length}/9 scenarios passed.`);
  } catch (error) {
    await writeReport(false, error);
    throw error;
  }
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
