# CODEMAP

Интерактивная версия с двумя уровнями объяснения, контрольными вопросами и прямыми ссылками на конкретные строки кода: [docs/tutorial/index.html](docs/tutorial/index.html).

## Карта каталогов

```text
apps/
  web/                 Angular: /, /orders/:id, /admin
  api/                 Nest REST, Swagger, webhook inbox, payment simulator
  worker/              payment inbox + PostgreSQL delivery queue
  mock-provider/       один образ, запускается как Provider A и B
packages/
  database/            Prisma schema, SQL migration, seed, PrismaClient
  domain/              state machine, деньги, promo calculation, fingerprint
  api-client/          общий DTO-контракт Angular/API
tests/
  race/                состязательные HTTP + DB assertions
  e2e/                 Playwright: 5 интерактивов и полный путь покупки
docs/                  требования, архитектура, API, эксплуатация, ADR
```

## Entrypoints

| Процесс  | Файл                               | Назначение                                       |
| -------- | ---------------------------------- | ------------------------------------------------ |
| Web      | `apps/web/src/main.ts`             | standalone Angular bootstrap                     |
| API      | `apps/api/src/main.ts`             | HTTP, validation, Swagger, static Angular        |
| Worker   | `apps/worker/src/main.ts`          | Nest application context и цикл queue processing |
| Provider | `apps/mock-provider/src/main.ts`   | `/issue`, поведение задаёт `PROVIDER_ID`         |
| Seed     | `packages/database/prisma/seed.ts` | каталог, 50 ключей, 4 промокода                  |

## Критические потоки

| Поток                         | Код                                                                             |
| ----------------------------- | ------------------------------------------------------------------------------- |
| Идемпотентное создание заказа | `ShopService.createOrder`, `fingerprintOrder`, UNIQUE `idempotency_key`         |
| Конкурентный промокод         | `SELECT ... FOR UPDATE` в `ShopService.createOrder`, redemption UNIQUE по order |
| Durable webhook               | `ShopService.acceptWebhook`, UNIQUE `event_id`; ответ после INSERT              |
| Раннее событие                | worker выбирает только inbox-строки, для которых уже существует order           |
| Одна job                      | upsert `DeliveryJob` с UNIQUE `order_id`                                        |
| Claim job                     | raw `UPDATE ... FOR UPDATE SKIP LOCKED ... RETURNING`                           |
| Timeout                       | стабильная строка `ProviderRequest(order, provider)` и повтор того же UUID      |
| Резерв ключа                  | транзакция provider: `FOR UPDATE SKIP LOCKED`, затем `request_id → code`        |
| Финальная выдача              | транзакция с lock order + UNIQUE fulfillment/order/code                         |
| Recovery                      | `/admin/orders/:id/retry-delivery`, переиспользование job/request IDs           |

## Таблицы и владельцы

- API пишет `orders`, `payment_events`, `promo_redemptions`, admin-настройки.
- Worker пишет состояния заказов, `delivery_jobs`, `provider_requests`, attempts и `fulfillments`.
- Provider владеет атомарным резервом `provider_keys` и читает `provider_settings`.
- `order_status_history` — единый аудит переходов.

## Карта тестов

- `packages/domain/src/index.spec.ts` — деньги, переходы, fingerprint.
- `tests/race/run.ts` — пять состязательных критериев и двойной клик.
- `tests/e2e/storefront.spec.ts` — карусель, меню, валюта, hover, покупка/выдача.
- CI дополнительно строит production Docker image и сканирует секреты.
