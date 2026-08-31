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
