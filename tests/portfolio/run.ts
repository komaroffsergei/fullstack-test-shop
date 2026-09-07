import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { prisma } from '../../packages/database/src/index.js';

const base = process.env.PORTFOLIO_TEST_URL ?? 'http://127.0.0.1:4001';
/** Получает отдельную подписанную сессию для проверки реальной HTTP-изоляции. */
async function session(): Promise<string> {
  const response = await fetch(`${base}/api/v1/demo/config`);
  assert.equal(response.status, 200);
  return response.headers.getSetCookie()[0]!.split(';')[0]!;
}
/** Вызывает JSON API с cookie одного посетителя и возвращает полный HTTP-ответ. */
async function call(cookie: string, path: string, body?: unknown, key = randomUUID()) {
  return fetch(base + '/api/v1/' + path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { cookie, 'content-type': 'application/json', 'idempotency-key': key },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}
/** Проверяет владение, гонку идемпотентности, лимиты и удаление только своих заказов. */
async function main(): Promise<void> {
  const a = await session(),
    b = await session();
  const orderId = randomUUID(),
    key = randomUUID(),
    payload = { orderId, sku: 'STEAM-TOPUP-500' };
  const race = await Promise.all(Array.from({ length: 5 }, () => call(a, 'orders', payload, key)));
  assert.deepEqual(race.map((x) => x.status).sort(), [200, 200, 200, 200, 201]);
  assert.equal(await prisma.order.count({ where: { publicId: orderId } }), 1);
  assert.equal((await call(a, 'orders', { ...payload, sku: 'INVALID' }, key)).status, 409);
  assert.equal((await call(b, `orders/${orderId}`)).status, 404);
  assert.equal((await call(b, 'payments/simulate', { orderId, status: 'paid' })).status, 404);
  assert.equal((await call(b, `demo/orders/${orderId}/recover`, {})).status, 404);
  assert.equal((await call(b, `demo/orders/${orderId}/replay`, {})).status, 404);
  await call(b, 'demo/reset', {});
  assert.equal((await call(a, `orders/${orderId}`)).status, 200);
  for (let i = 0; i < 19; i++)
    assert.equal(
      (await call(a, 'orders', { orderId: randomUUID(), sku: 'STEAM-TOPUP-500' })).status,
      201,
    );
  assert.equal(
    (await call(a, 'orders', { orderId: randomUUID(), sku: 'STEAM-TOPUP-500' })).status,
    409,
  );
  await prisma.order.update({
    where: { publicId: orderId },
    data: { createdAt: new Date(Date.now() - 3_700_000) },
  });
  assert.equal((await call(a, `orders/${orderId}`)).status, 404);
  assert.equal((await call(a, 'demo/reset', {})).status, 201);
  assert.equal(await prisma.order.count({ where: { publicId: orderId } }), 0);
  console.log(
    'Portfolio HTTP isolation, concurrent replay, expiry boundary, quotas and scoped reset passed',
  );
}
void main().finally(() => prisma.$disconnect());
