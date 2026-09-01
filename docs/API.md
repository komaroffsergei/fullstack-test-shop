# API

Интерактивная схема доступна на `/api/docs`, JSON — `/api/openapi.json`.

## Public

- `GET /api/v1/catalog/products` — активный серверный каталог.
- `POST /api/v1/orders` — `{ orderId: UUID, sku, promoCode? }` + `Idempotency-Key`.
  Новый intent: `201`; replay с тем же payload: `200`; тот же ключ с другим payload: `409`.
- `GET /api/v1/orders/:orderId` — снимок, история, выданный code.
- `POST /api/v1/payments/simulate` — `{ orderId, status: paid|failed }`; вызывает webhook по HTTP.
- `POST /api/v1/webhooks/payment` — контракт задания. `amount` приходит в рублях, внутри переводится в копейки.
- `POST /api/v1/promocodes/quote` — предварительный расчёт без резервирования использования.

## Admin

Все запросы требуют `X-Admin-Token`.

- `GET /api/v1/admin/recovery/orders`
- `POST /api/v1/admin/orders/:id/retry-delivery`
- `POST /api/v1/admin/providers/keys`
- `POST /api/v1/admin/providers/mode`
- `POST /api/v1/admin/demo/reset`

Режимы provider: `success`, `out_of_stock`, `server_error_before_issue`, `timeout_after_issue`.

## Operations

- `/api/health/live` — процесс жив.
- `/api/health/ready` — доступен PostgreSQL.
- `/api/metrics` — Prometheus format, включая дубли webhook и длину очереди.

## Общие правила

- Production base URL: `https://test-shop.komaroff-dev.ru`.
- JSON endpoints требуют `Content-Type: application/json`.
- Global ValidationPipe удаление неизвестных полей не делает молча: `forbidNonWhitelisted=true`, поэтому подмена цены получает `400`.
- Каждый ответ API содержит `X-Request-Id`; входной `X-Request-Id` переиспользуется для correlation.
- Публичный order identifier — UUID. Внутренний bigint никогда не выходит в контракт.
- Деньги в read model — целые `*PriceMinor` (копейки); webhook `amount` следует контракту задания и приходит в целых рублях.
- Ошибки используют стандартное NestJS JSON-тело с `statusCode`, `message`, `error`.

## Создание заказа

```http
POST /api/v1/orders
Idempotency-Key: 83c6f6f1-...
Content-Type: application/json

{
  "orderId": "e87e4348-50d1-4f89-9b35-32ac73673ce8",
  "sku": "STEAM-TOPUP-500",
  "promoCode": "WELCOME10"
}
```

Успех:

- `201` — новый intent;
- `200` — replay того же key и canonical payload;
- `409` — key уже связан с другим payload или public order ID занят;
- `404` — SKU отсутствует/неактивен;
- `409/422` — promo исчерпан/невалиден;
- `400` — DTO/UUID/неизвестное поле неверно;
- `422` — Idempotency-Key отсутствует или длиннее 200 символов.

Response содержит `orderId`, SKU/name, текущий status, base/discount/final в копейках, currency, promo, nullable code, timestamps и полную status history.

Клиент не имеет полей `price`, `amount`, `discount` или `currency` в CreateOrder DTO. Это часть threat model, а не случайное упрощение.

## Payment webhook

```http
POST /api/v1/webhooks/payment
Content-Type: application/json

{
  "event_id": "evt_a1b2c3",
  "order_id": "e87e4348-50d1-4f89-9b35-32ac73673ce8",
  "status": "paid",
  "amount": 500,
  "currency": "RUB",
  "created_at": "2026-09-01T09:00:00.000Z"
}
```

Оба результата возвращают `200`:

```json
{ "accepted": true, "duplicate": false }
```

```json
{ "accepted": true, "duplicate": true }
```

`200` означает «событие durable сохранено либо уже было сохранено», но не «заказ уже выдан». Worker применяет его асинхронно. Ранний order UUID легален. Mismatch amount/currency сохраняется и позднее получает `inbox_state=invalid`.

## Payment simulator

```http
POST /api/v1/payments/simulate
Content-Type: application/json

{ "orderId": "...uuid...", "status": "paid" }
```

Simulator сначала читает server order snapshot, формирует уникальный event ID и делает настоящий HTTP POST в `/webhooks/payment`. Поэтому UI не обходит inbox и worker path.

## Promocode quote

```http
POST /api/v1/promocodes/quote
Content-Type: application/json

{ "sku": "STEAM-TOPUP-500", "promoCode": "WELCOME10" }
```

Quote показывает base/discount/final/currency/remainingUses, но не создаёт redemption и не увеличивает counter. Окончательная проверка/резервирование повторяется внутри create-order transaction.

## Admin examples

Во всех примерах header передаётся только из защищённого окружения:

```http
X-Admin-Token: <private server token>
```

Fault mode:

```json
{ "providerId": "A", "mode": "timeout_after_issue", "delayMs": 1500 }
```

Пополнение:

```json
{
  "providerId": "A",
  "sku": "STEAM-TOPUP-500",
  "codes": ["DEMO-RESTOCK-0001"]
}
```

Пустые строки и дубли input codes очищаются; DTO требует массив 1..500 строк длиной до 200 символов. Повтор уже существующего code не падает, но `added` его не считает.

Retry возвращает `202`. Для delivered response сообщает `alreadyDelivered=true`; новый fulfillment/job/code не создаётся.

Reset возвращает `201`, только если нет processing job. Он очищает demo orders/events/jobs/attempts/fulfillments/redemptions, возвращает исходные 50 keys, promo counters и provider success modes. При активной выдаче возвращается `503`.

## Provider contract

Provider A/B недоступны из public Internet и вызываются worker внутри Compose network:

```http
POST /issue
Content-Type: application/json

{
  "request_id": "...uuid...",
  "sku": "STEAM-TOPUP-500",
  "order_id": "...uuid..."
}
```

Успех:

```json
{ "status": "ok", "request_id": "...тот же uuid...", "code": "XXXX-XXXX-XXXX" }
```

Out of stock:

```json
{ "status": "error", "reason": "out_of_stock" }
```

Worker принимает success только при `response.ok`, code и точном совпадении request ID. Повтор request ID обязан вернуть тот же code.

## Машиночитаемая схема

Swagger UI является представлением generated runtime document. `scripts/generate-openapi.ts` проверяет наличие и HTTP method всех 14 operations, поэтому удаление admin/operations endpoint тоже ломает CI, а не только три основных маршрута.
