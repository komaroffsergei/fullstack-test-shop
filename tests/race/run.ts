import { randomUUID } from 'node:crypto';
import { prisma } from '../../packages/database/src/index.js';

const baseUrl = process.env.BASE_URL ?? 'http://127.0.0.1:4000';
const adminToken = process.env.ADMIN_TOKEN ?? 'change-me-locally';

/** Выполняет JSON-запрос к живому API и возвращает вместе тело и HTTP-статус. */
async function request<T>(path: string, init?: RequestInit): Promise<{ status: number; body: T }> {
  const response = await fetch(`${baseUrl}${path}`, init);
  const body = (await response.json()) as T;
  return { status: response.status, body };
}

/** Возвращает БД и mock-provider к воспроизводимому начальному состоянию. */
async function reset(): Promise<void> {
  const result = await request('/api/v1/admin/demo/reset', {
    method: 'POST',
    headers: { 'X-Admin-Token': adminToken },
  });
  if (result.status !== 201) throw new Error(`Demo reset failed: ${result.status}`);
}

/** Создаёт заказ; shared intent нужен для точной симуляции двойного клика. */
async function createOrder(promoCode?: string, shared?: { orderId: string; key: string }) {
  const orderId = shared?.orderId ?? randomUUID();
  const key = shared?.key ?? randomUUID();
  return request<{ orderId: string; finalPriceMinor: number }>('/api/v1/orders', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'Idempotency-Key': key },
    body: JSON.stringify({ orderId, sku: 'STEAM-TOPUP-500', promoCode }),
  });
}

/** Формирует реальное paid webhook-событие для заданного заказа. */
function webhook(orderId: string, eventId: string, amount = 500) {
  return request('/api/v1/webhooks/payment', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      event_id: eventId,
      order_id: orderId,
      status: 'paid',
      amount,
      currency: 'RUB',
      created_at: new Date().toISOString(),
    }),
  });
}

/** Ожидает терминальный успех выдачи через общий polling helper. */
async function waitDelivered(orderId: string): Promise<void> {
  await waitStatus(orderId, 'delivered');
}

/** Опросом ждёт статус с ограниченным deadline, чтобы зависание стало явным падением теста. */
async function waitStatus(orderId: string, expected: string): Promise<void> {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    const result = await request<{ status: string }>(`/api/v1/orders/${orderId}`);
    if (result.body.status === expected) return;
    // Короткая пауза даёт worker'у работать и не создаёт busy loop.
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Order ${orderId} did not reach ${expected} in time`);
}

/** Отправляет защищённую административную команду тестовому стенду. */
function admin(path: string, body: unknown) {
  return request(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'X-Admin-Token': adminToken },
    body: JSON.stringify(body),
  });
}

/** Проверяет три независимых доказательства однократности: fulfillment, key и event count. */
async function assertSingleIssue(orderId: string, expectedEvents: number): Promise<void> {
  const order = await prisma.order.findUniqueOrThrow({ where: { publicId: orderId } });
  const [fulfillments, events, requests] = await Promise.all([
    prisma.fulfillment.count({ where: { orderId: order.id } }),
    prisma.paymentEvent.count({ where: { orderPublicId: orderId } }),
    prisma.providerRequest.findMany({ where: { orderId: order.id }, select: { requestId: true } }),
  ]);
  const spentKeys = await prisma.providerKey.count({
    where: { requestId: { in: requests.map((item) => item.requestId) } },
  });
  if (fulfillments !== 1 || spentKeys !== 1 || events !== expectedEvents) {
    throw new Error(JSON.stringify({ orderId, fulfillments, spentKeys, events, expectedEvents }));
  }
}

/** Последовательно запускает все состязательные критерии приёмки на реальном PostgreSQL. */
async function main(): Promise<void> {
  await reset();

  // Два конкурентных HTTP-запроса используют один intent, как настоящий dblclick.
  const intent = { orderId: randomUUID(), key: randomUUID() };
  const doubleClick = await Promise.all([
    createOrder(undefined, intent),
    createOrder(undefined, intent),
  ]);
  if (doubleClick.some((result) => ![200, 201].includes(result.status)))
    throw new Error('Double click failed');
  if (doubleClick[0].body.orderId !== doubleClick[1].body.orderId)
    throw new Error('Double click created two orders');

  // UNIQUE(event_id) должен схлопнуть 50 доставок в одну запись inbox.
  const duplicateEventId = `evt_${randomUUID()}`;
  await Promise.all(Array.from({ length: 50 }, () => webhook(intent.orderId, duplicateEventId)));
  await waitDelivered(intent.orderId);
  await assertSingleIssue(intent.orderId, 1);
  console.log('✓ 50 identical webhooks: one event, one fulfillment, one key');

  // 50 разных paid events сохраняются все, но job/fulfillment остаются единственными.
  const uniqueOrder = await createOrder();
  await Promise.all(
    Array.from({ length: 50 }, () => webhook(uniqueOrder.body.orderId, `evt_${randomUUID()}`)),
  );
  await waitDelivered(uniqueOrder.body.orderId);
  await assertSingleIssue(uniqueOrder.body.orderId, 50);
  console.log('✓ 50 unique paid events: one fulfillment, one key');

  // FK на order отсутствует намеренно: ранний webhook переживает появление заказа.
  const earlyId = randomUUID();
  await webhook(earlyId, `evt_${randomUUID()}`);
  await createOrder(undefined, { orderId: earlyId, key: randomUUID() });
  await waitDelivered(earlyId);
  await assertSingleIssue(earlyId, 1);
  console.log('✓ early webhook is retained and applied after order creation');

  // Пустые пулы переводят заказ в recovery, после пополнения retry завершается одним кодом.
  await reset();
  await prisma.providerKey.deleteMany();
  const emptyOrder = await createOrder();
  await webhook(emptyOrder.body.orderId, `evt_${randomUUID()}`);
  await waitStatus(emptyOrder.body.orderId, 'out_of_stock');
  await admin('/api/v1/admin/providers/keys', {
    providerId: 'A',
    sku: 'STEAM-TOPUP-500',
    codes: ['RACE-RECOVERY-0001'],
  });
  await admin(`/api/v1/admin/orders/${emptyOrder.body.orderId}/retry-delivery`, {});
  await waitDelivered(emptyOrder.body.orderId);
  await assertSingleIssue(emptyOrder.body.orderId, 1);
  console.log('✓ empty pools recover through top-up and idempotent manual retry');

  // Timeout случается после резервирования; повтор обязан вернуть прежний код от A.
  await reset();
  await admin('/api/v1/admin/providers/mode', {
    providerId: 'A',
    mode: 'timeout_after_issue',
    delayMs: 1500,
  });
  const timeoutOrder = await createOrder();
  await webhook(timeoutOrder.body.orderId, `evt_${randomUUID()}`);
  await waitDelivered(timeoutOrder.body.orderId);
  await assertSingleIssue(timeoutOrder.body.orderId, 1);
  const timeoutRecord = await prisma.order.findUniqueOrThrow({
    where: { publicId: timeoutOrder.body.orderId },
  });
  const timeoutOutcomes = await prisma.providerCallAttempt.groupBy({
    by: ['outcome'],
    where: { providerRequest: { orderId: timeoutRecord.id } },
    _count: { _all: true },
  });
  if (
    !timeoutOutcomes.some((item) => item.outcome === 'timeout') ||
    !timeoutOutcomes.some((item) => item.outcome === 'success')
  ) {
    throw new Error(
      `Timeout replay did not produce timeout + success: ${JSON.stringify(timeoutOutcomes)}`,
    );
  }
  console.log('✓ timeout-after-issue replays the same provider request and code');

  // Только явный out_of_stock разрешает безопасно переключиться с A на B.
  await reset();
  await admin('/api/v1/admin/providers/mode', { providerId: 'A', mode: 'out_of_stock' });
  const fallbackOrder = await createOrder();
  await webhook(fallbackOrder.body.orderId, `evt_${randomUUID()}`);
  await waitDelivered(fallbackOrder.body.orderId);
  const fallbackRecord = await prisma.order.findUniqueOrThrow({
    where: { publicId: fallbackOrder.body.orderId },
    include: { fulfillment: true },
  });
  if (fallbackRecord.fulfillment?.providerId !== 'B')
    throw new Error('Provider B fallback was not used');
  console.log('✓ explicit Provider A out-of-stock safely falls back to B');

  // Row lock промокода не даст 50 запросам превысить max_uses = 3.
  await reset();
  const promoResults = await Promise.all(Array.from({ length: 50 }, () => createOrder('LIMIT3')));
  const successful = promoResults.filter((result) => [200, 201].includes(result.status)).length;
  const promo = await prisma.promocode.findUniqueOrThrow({ where: { code: 'LIMIT3' } });
  if (successful > 3 || promo.usedCount > 3)
    throw new Error(`Promo overused: HTTP=${successful}, DB=${promo.usedCount}`);
  console.log(
    `✓ LIMIT3 under 50 requests: HTTP successes=${successful}, used_count=${promo.usedCount}`,
  );
}

// CLI всегда закрывает Prisma и возвращает ненулевой exit code при любой нарушенной гарантии.
main()
  .then(() => prisma.$disconnect())
  .catch(async (error: unknown) => {
    console.error(error);
    await prisma.$disconnect();
    process.exitCode = 1;
  });
