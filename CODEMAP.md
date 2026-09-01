# CODEMAP: от требования к точной строке кода

Карта читается в двух режимах:

- **Профессионально** — механизм, граница транзакции и инвариант;
- **Как для 10 лет** — простая модель, зачем этот участок существует.

У каждой критической точки две рабочие ссылки:

- **GitHub** — публичная ветка `main`, удобно для проверки работодателем;
- **Офлайн** — точная строка, уже встроенная в [автономный source handbook](docs/offline/index.html); интернет не нужен.

Полный учебный маршрут с контрольными вопросами: [docs/tutorial/index.html](docs/tutorial/index.html). Все 100+ текстовых файлов, поиск и SHA-256: [docs/offline/index.html](docs/offline/index.html).

## 1. Карта каталогов

```text
apps/
  web/                 Angular: /, /orders/:orderId, /admin
  api/                 Nest REST, DTO, Swagger, webhook inbox, simulator, admin
  worker/              payment inbox + PostgreSQL delivery queue + provider calls
  mock-provider/       один образ, два процесса A/B, request_id → code
packages/
  database/            Prisma models, SQL constraints/indexes, seed, shared client
  domain/              state machine, integer money, promo calculation, fingerprint
  api-client/          общий read-model контракт Angular/API
tests/
  support/             HTTP-клиент живого стенда
  race/                13 HTTP + PostgreSQL acceptance scenarios
  production/          9 black-box HTTPS scenarios без прямого доступа к DB
  e2e/                 3 Playwright tests: UI, assets, purchase, responsive
scripts/
  generate-openapi.ts           full operation contract check
  generate-offline-docs.ts      self-contained source handbook generator
  verify-offline-docs.ts        independent manifest/hash/offline verifier
  verify-russian-comments.ts    AST gate: русский комментарий у каждого метода
docs/
  tutorial/index.html           основной курс pro/10-летний + вопросы/quiz
  offline/index.html            встроенный source snapshot
  REQUIREMENTS_MATRIX.md        ТЗ → код → тест → production evidence
  ACCEPTANCE_REPORT.md          фактические результаты
  SUBMISSION_CHECKLIST.md       финальная передача/архив
.github/workflows/              CI и immutable production deployment
```

## 2. Entrypoints

| Процесс               | Назначение                                             | GitHub                                                                                                                                                                                                       | Офлайн                                                                                                                                   |
| --------------------- | ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Angular               | standalone bootstrap и lazy routes                     | [main.ts](https://github.com/komaroffsergei/fullstack-test-shop/blob/main/apps/web/src/main.ts), [routes](https://github.com/komaroffsergei/fullstack-test-shop/blob/main/apps/web/src/app/app.routes.ts#L3) | [main.ts](docs/offline/index.html#file-apps-web-src-main-ts), [routes:3](docs/offline/index.html#file-apps-web-src-app-app-routes-ts-L3) |
| API                   | validation, logs, Swagger, static Angular/docs, listen | [main.ts:14](https://github.com/komaroffsergei/fullstack-test-shop/blob/main/apps/api/src/main.ts#L14)                                                                                                       | [main.ts:14](docs/offline/index.html#file-apps-api-src-main-ts-L14)                                                                      |
| Worker                | Nest application context и polling loop                | [main.ts:6](https://github.com/komaroffsergei/fullstack-test-shop/blob/main/apps/worker/src/main.ts#L6)                                                                                                      | [main.ts:6](docs/offline/index.html#file-apps-worker-src-main-ts-L6)                                                                     |
| Provider A/B          | HTTP `/issue`; identity задаёт env                     | [main.ts:7](https://github.com/komaroffsergei/fullstack-test-shop/blob/main/apps/mock-provider/src/main.ts#L7)                                                                                               | [main.ts:7](docs/offline/index.html#file-apps-mock-provider-src-main-ts-L7)                                                              |
| Seed                  | 12 products, 50 keys, 4 promos, A/B settings           | [seed.ts](https://github.com/komaroffsergei/fullstack-test-shop/blob/main/packages/database/prisma/seed.ts)                                                                                                  | [seed.ts](docs/offline/index.html#file-packages-database-prisma-seed-ts)                                                                 |
| Local acceptance      | 13 DB-backed scenarios                                 | [race main:547](https://github.com/komaroffsergei/fullstack-test-shop/blob/main/tests/race/run.ts#L547)                                                                                                      | [race main:547](docs/offline/index.html#file-tests-race-run-ts-L547)                                                                     |
| Production acceptance | 9 HTTPS scenarios                                      | [production main:332](https://github.com/komaroffsergei/fullstack-test-shop/blob/main/tests/production/run.ts#L332)                                                                                          | [production main:332](docs/offline/index.html#file-tests-production-run-ts-L332)                                                         |

## 3. Критические решения: два объяснения

| Задача                      | Профессионально                                                                                                | Как для 10 лет                                                                  | GitHub                                                                                                                                                               | Офлайн                                                                                                                            |
| --------------------------- | -------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| Purchase intent в Angular   | UUID + Idempotency-Key создаются до HTTP и сохраняются при transport retry; price не отправляется              | Покупка получает один номерок, и два клика показывают кассе тот же номер        | [buy():123](https://github.com/komaroffsergei/fullstack-test-shop/blob/main/apps/web/src/app/storefront.component.ts#L123)                                           | [buy():123](docs/offline/index.html#file-apps-web-src-app-storefront-component-ts-L123)                                           |
| Создание заказа             | product/promo lock/order snapshot/redemption выполняются в одной короткой transaction; P2002 читает победителя | Касса запирает купон, записывает заказ и не даёт второму кассиру сделать копию  | [createOrder():65](https://github.com/komaroffsergei/fullstack-test-shop/blob/main/apps/api/src/shop.service.ts#L65)                                                 | [createOrder():65](docs/offline/index.html#file-apps-api-src-shop-service-ts-L65)                                                 |
| Promo concurrency           | `SELECT … FOR UPDATE` сериализует check-and-increment `used_count`                                             | К одному листу купонов подходят по одному и ставят отметку                      | [promo lock:84](https://github.com/komaroffsergei/fullstack-test-shop/blob/main/apps/api/src/shop.service.ts#L84)                                                    | [promo lock:84](docs/offline/index.html#file-apps-api-src-shop-service-ts-L84)                                                    |
| Durable webhook             | INSERT event выполняется до `200`; event ID UNIQUE превращает replay в no-op                                   | Письмо сначала кладут в несгораемый ящик, потом говорят «получили»              | [acceptWebhook():187](https://github.com/komaroffsergei/fullstack-test-shop/blob/main/apps/api/src/shop.service.ts#L187)                                             | [acceptWebhook():187](docs/offline/index.html#file-apps-api-src-shop-service-ts-L187)                                             |
| Раннее событие              | inbox UUID намеренно без FK; worker JOIN не claim-ит событие до order                                          | Письмо ждёт коробку с таким номером и никуда не исчезает                        | [processPaymentEvent():73](https://github.com/komaroffsergei/fullstack-test-shop/blob/main/apps/worker/src/worker.service.ts#L73)                                    | [processPaymentEvent():73](docs/offline/index.html#file-apps-worker-src-worker-service-ts-L73)                                    |
| Snapshot payment validation | amount/currency сравниваются с immutable order; mismatch → invalid без job                                     | Если в письме неправильная сумма, склад не выдаёт подарок                       | [worker:103](https://github.com/komaroffsergei/fullstack-test-shop/blob/main/apps/worker/src/worker.service.ts#L103)                                                 | [worker:103](docs/offline/index.html#file-apps-worker-src-worker-service-ts-L103)                                                 |
| Одна delivery job           | upsert опирается на UNIQUE `delivery_jobs.order_id`                                                            | На одну коробку разрешена одна рабочая карточка                                 | [worker:128](https://github.com/komaroffsergei/fullstack-test-shop/blob/main/apps/worker/src/worker.service.ts#L128)                                                 | [worker:128](docs/offline/index.html#file-apps-worker-src-worker-service-ts-L128)                                                 |
| Atomic job claim            | `UPDATE … FOR UPDATE SKIP LOCKED … RETURNING`, lease; HTTP после commit                                        | Работник быстро подписывает одну карточку и отпускает шкаф до звонка поставщику | [processDeliveryJob():161](https://github.com/komaroffsergei/fullstack-test-shop/blob/main/apps/worker/src/worker.service.ts#L161)                                   | [processDeliveryJob():161](docs/offline/index.html#file-apps-worker-src-worker-service-ts-L161)                                   |
| Timeout A                   | timeout неоднозначен; retry той же пары order/A; B запрещён                                                    | Первый курьер мог уже принести подарок, поэтому второго пока не зовём           | [timeout branch:200](https://github.com/komaroffsergei/fullstack-test-shop/blob/main/apps/worker/src/worker.service.ts#L200)                                         | [timeout branch:200](docs/offline/index.html#file-apps-worker-src-worker-service-ts-L200)                                         |
| Stable provider request     | upsert `(order, provider)` переиспользует UUID и журналирует каждую попытку                                    | Одна и та же просьба всегда имеет тот же номер                                  | [callProvider():226](https://github.com/komaroffsergei/fullstack-test-shop/blob/main/apps/worker/src/worker.service.ts#L226)                                         | [callProvider():226](docs/offline/index.html#file-apps-worker-src-worker-service-ts-L226)                                         |
| Provider reserve            | request replay читается первым; reserve key/request/issuedAt коммитится до задержки ответа                     | Склад сначала пишет имя на ключе, а потом отвечает; повтор вернёт тот же ключ   | [issue():20](https://github.com/komaroffsergei/fullstack-test-shop/blob/main/apps/mock-provider/src/provider.service.ts#L20)                                         | [issue():20](docs/offline/index.html#file-apps-mock-provider-src-provider-service-ts-L20)                                         |
| Final fulfillment           | order row lock + fulfillment order/code UNIQUE + status/history/job в одной transaction                        | Последняя дверь не пропустит второй ключ в ту же коробку                        | [complete():305](https://github.com/komaroffsergei/fullstack-test-shop/blob/main/apps/worker/src/worker.service.ts#L305)                                             | [complete():305](docs/offline/index.html#file-apps-worker-src-worker-service-ts-L305)                                             |
| Recovery                    | прежняя job переводится pending; provider requests не заменяются                                               | Сломанную карточку возвращают в очередь, но её номера остаются прежними         | [retryDelivery():245](https://github.com/komaroffsergei/fullstack-test-shop/blob/main/apps/api/src/shop.service.ts#L245)                                             | [retryDelivery():245](docs/offline/index.html#file-apps-api-src-shop-service-ts-L245)                                             |
| Safe reset                  | exclusive advisory lock согласован с shared worker claims; processing job → 503                                | Уборщик ждёт, пока работники отпустят карточки, и не запирает весь шкаф         | [resetDemo():299](https://github.com/komaroffsergei/fullstack-test-shop/blob/main/apps/api/src/shop.service.ts#L299)                                                 | [resetDemo():299](docs/offline/index.html#file-apps-api-src-shop-service-ts-L299)                                                 |
| Integer money               | safe integer minor units, bounded discount                                                                     | Деньги считаются целыми копейками, а не неточными дробями                       | [calculatePrice():52](https://github.com/komaroffsergei/fullstack-test-shop/blob/main/packages/domain/src/index.ts#L52)                                              | [calculatePrice():52](docs/offline/index.html#file-packages-domain-src-index-ts-L52)                                              |
| DB last line of defense     | UNIQUE/CHECK/FK/partial indexes живут в migration, не только в TypeScript                                      | У базы есть собственный строгий сторож                                          | [idempotency UNIQUE:205](https://github.com/komaroffsergei/fullstack-test-shop/blob/main/packages/database/prisma/migrations/20260831210000_init/migration.sql#L205) | [idempotency UNIQUE:205](docs/offline/index.html#file-packages-database-prisma-migrations-20260831210000-init-migration-sql-L205) |

## 4. HTTP-контроллеры и экраны

| Surface         | Основной файл            | Что искать                                      | GitHub                                                                                                                                                                                                                                                                                                                                               | Офлайн                                                                                                                                                                                                                                      |
| --------------- | ------------------------ | ----------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Orders REST     | `shop.controller.ts`     | `201/200`, Idempotency-Key, ParseUUID           | [OrdersController:47](https://github.com/komaroffsergei/fullstack-test-shop/blob/main/apps/api/src/shop.controller.ts#L47)                                                                                                                                                                                                                           | [строка 47](docs/offline/index.html#file-apps-api-src-shop-controller-ts-L47)                                                                                                                                                               |
| Payment REST    | `shop.controller.ts`     | durable webhook + real simulator                | [PaymentsController:74](https://github.com/komaroffsergei/fullstack-test-shop/blob/main/apps/api/src/shop.controller.ts#L74)                                                                                                                                                                                                                         | [строка 74](docs/offline/index.html#file-apps-api-src-shop-controller-ts-L74)                                                                                                                                                               |
| Admin REST      | `shop.controller.ts`     | recovery/keys/modes/reset + Guard               | [AdminController:123](https://github.com/komaroffsergei/fullstack-test-shop/blob/main/apps/api/src/shop.controller.ts#L123)                                                                                                                                                                                                                          | [строка 123](docs/offline/index.html#file-apps-api-src-shop-controller-ts-L123)                                                                                                                                                             |
| Storefront      | `storefront.component.*` | 5 interactions, catalog API, purchase           | [TS](https://github.com/komaroffsergei/fullstack-test-shop/blob/main/apps/web/src/app/storefront.component.ts), [HTML](https://github.com/komaroffsergei/fullstack-test-shop/blob/main/apps/web/src/app/storefront.component.html), [CSS](https://github.com/komaroffsergei/fullstack-test-shop/blob/main/apps/web/src/app/storefront.component.css) | [TS](docs/offline/index.html#file-apps-web-src-app-storefront-component-ts), [HTML](docs/offline/index.html#file-apps-web-src-app-storefront-component-html), [CSS](docs/offline/index.html#file-apps-web-src-app-storefront-component-css) |
| Order screen    | `order.component.*`      | polling, simulator, code, history               | [OrderComponent:17](https://github.com/komaroffsergei/fullstack-test-shop/blob/main/apps/web/src/app/order.component.ts#L17)                                                                                                                                                                                                                         | [строка 17](docs/offline/index.html#file-apps-web-src-app-order-component-ts-L17)                                                                                                                                                           |
| Recovery screen | `admin.component.*`      | in-memory token header, mode/top-up/retry/reset | [AdminComponent:16](https://github.com/komaroffsergei/fullstack-test-shop/blob/main/apps/web/src/app/admin.component.ts#L16)                                                                                                                                                                                                                         | [строка 16](docs/offline/index.html#file-apps-web-src-app-admin-component-ts-L16)                                                                                                                                                           |

## 5. Модели данных

| Модель                  | Владелец записи             | Главная гарантия                              | Prisma                                                                                       |
| ----------------------- | --------------------------- | --------------------------------------------- | -------------------------------------------------------------------------------------------- |
| Product                 | seed/admin future           | server price source                           | [Product](docs/offline/index.html#file-packages-database-prisma-schema-prisma-L50)           |
| Order                   | API, status изменяет worker | public/idempotency unique, money snapshot     | [Order:91](docs/offline/index.html#file-packages-database-prisma-schema-prisma-L91)          |
| PaymentEvent            | API inserts, worker marks   | early event + event ID unique                 | [PaymentEvent:119](docs/offline/index.html#file-packages-database-prisma-schema-prisma-L119) |
| DeliveryJob             | worker/admin                | one order → one lease job                     | [DeliveryJob:139](docs/offline/index.html#file-packages-database-prisma-schema-prisma-L139)  |
| ProviderRequest/Attempt | worker                      | one stable request per order/provider + audit | [ProviderRequest](docs/offline/index.html#file-packages-database-prisma-schema-prisma-L160)  |
| ProviderKey             | provider                    | one request → one code; code unique           | [ProviderKey:246](docs/offline/index.html#file-packages-database-prisma-schema-prisma-L246)  |
| Fulfillment             | worker                      | one order/code                                | [Fulfillment:189](docs/offline/index.html#file-packages-database-prisma-schema-prisma-L189)  |
| StatusHistory           | API/worker                  | explain every transition                      | [History](docs/offline/index.html#file-packages-database-prisma-schema-prisma-L204)          |
| Promocode/Redemption    | API                         | bounded use + one promo application/order     | [Promo](docs/offline/index.html#file-packages-database-prisma-schema-prisma-L222)            |

## 6. Карта тестов

| Риск                                  | Автотест                                                                                                          | Дополнительное доказательство                                                         |
| ------------------------------------- | ----------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| Money/state/fingerprint               | [domain unit](https://github.com/komaroffsergei/fullstack-test-shop/blob/main/packages/domain/src/index.spec.ts)  | 7 tests без I/O                                                                       |
| Полные контракты/health/admin         | [race](https://github.com/komaroffsergei/fullstack-test-shop/blob/main/tests/race/run.ts)                         | OpenAPI 14 operations, malformed/tamper negative paths                                |
| 50 identical/unique webhook           | [race](docs/offline/index.html#file-tests-race-run-ts)                                                            | direct counts event/job/fulfillment/spent key                                         |
| Early/unordered/invalid payment       | [race](docs/offline/index.html#file-tests-race-run-ts)                                                            | pending/invalid DB states и public history                                            |
| Empty pool/recovery                   | [race](docs/offline/index.html#file-tests-race-run-ts)                                                            | физическое удаление pool + concurrent retry                                           |
| Timeout/fallback/5xx                  | [race](docs/offline/index.html#file-tests-race-run-ts)                                                            | attempt outcomes, provider ID/request ID assertions                                   |
| Promo limit                           | [race](docs/offline/index.html#file-tests-race-run-ts)                                                            | 3 success/47 conflict/3 rows/counter 3                                                |
| Public Nginx/TLS/docs stack           | [production](docs/offline/index.html#file-tests-production-run-ts)                                                | 9 black-box сценариев, exact tutorial/offline/README/CODEMAP, JSON report без secrets |
| Five UI interactions/full purchase    | [Playwright:14](https://github.com/komaroffsergei/fullstack-test-shop/blob/main/tests/e2e/storefront.spec.ts#L14) | CSS computed values, code/history                                                     |
| Broken images                         | [Playwright](docs/offline/index.html#file-tests-e2e-storefront-spec-ts)                                           | 15× naturalWidth/complete                                                             |
| Mobile open catalog overflow          | [Playwright](docs/offline/index.html#file-tests-e2e-storefront-spec-ts)                                           | `scrollWidth ≤ clientWidth` at 390×844                                                |
| Русские комментарии                   | [AST verifier](docs/offline/index.html#file-scripts-verify-russian-comments-ts)                                   | 156/156 methods/functions                                                             |
| Offline source drift/secret inclusion | [docs verifier](docs/offline/index.html#file-scripts-verify-offline-docs-ts)                                      | independent manifest/hash/allowlist/offline gates                                     |
| Runtime image                         | [CI](https://github.com/komaroffsergei/fullstack-test-shop/blob/main/.github/workflows/ci.yml)                    | Docker build + Node/OpenSSL/Angular/Prisma checks                                     |

## 7. Как читать один вертикальный срез

### Покупка

1. `StorefrontComponent.buy()` создаёт intent.
2. `OrdersController.create()` превращает HTTP в typed DTO.
3. `ShopService.createOrder()` сохраняет money snapshot.
4. `OrderComponent.simulate()` вызывает payment simulator.
5. `PaymentsController.simulate()` делает настоящий webhook HTTP POST.
6. `acceptWebhook()` сохраняет inbox.
7. `processPaymentEvent()` меняет state и создаёт job.
8. `processDeliveryJob()` claim-ит job.
9. `callProvider()` получает stable request ID.
10. `ProviderService.issue()` атомарно резервирует code.
11. `complete()` создаёт fulfillment/status/history.
12. Angular polling показывает code.
13. Race и Playwright повторяют этот путь автоматически.

### Timeout

1. Admin ставит A `timeout_after_issue`.
2. Provider резервирует key/request и задерживает response.
3. Worker фиксирует timeout, но не вызывает B.
4. Job retry использует ту же ProviderRequest.
5. Provider replay находит existing key и отвечает немедленно.
6. Completion создаёт один fulfillment.
7. Race требует `timeout + success`, один key и ноль request B.

### Пустой пул

1. Оба providers однозначно отвечают out-of-stock.
2. Worker ставит `out_of_stock`, job `failed`, payment остаётся сохранён.
3. Admin list показывает order.
4. После top-up два concurrent retry upsert-ят ту же job.
5. Старые ProviderRequest IDs переиспользуются.
6. Один code приводит к одному `delivered`; дальнейший retry no-op.

## 8. Где искать максимально подробное объяснение

- Архитектурные границы и алгоритмы: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)
- Почему приняты решения: [ADR-001](docs/adr/001-postgresql-queue.md), [ADR-002](docs/adr/002-idempotency-and-inbox.md), [ADR-003](docs/adr/003-provider-timeout.md)
- Каждый пункт исходного ТЗ: [docs/REQUIREMENTS_MATRIX.md](docs/REQUIREMENTS_MATRIX.md)
- Команды и смысл assertions: [docs/TESTING.md](docs/TESTING.md)
- API payload/status/error semantics: [docs/API.md](docs/API.md)
- Безопасность и production hardening: [docs/SECURITY.md](docs/SECURITY.md)
- Deployment/rollback/runbook: [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)
- Фактические результаты сдачи: [docs/ACCEPTANCE_REPORT.md](docs/ACCEPTANCE_REPORT.md)
