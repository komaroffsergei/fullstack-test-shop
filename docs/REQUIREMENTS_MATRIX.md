# Матрица требований и доказательств приемки

Матрица составлена по первичному документу «Тестовое задание Фуллстек разработчик.docx», а не по пересказу плана. Номера страниц относятся к исходному DOCX. Вакансия использовалась только как контекст инженерного качества и не расширяет обязательный объём задания.

Статусы:

- **PASS** — требование реализовано и имеет автоматическое либо воспроизводимое доказательство;
- **N/A по ТЗ** — исходный документ прямо разрешает не реализовывать функцию;
- **MANUAL** — визуальное свойство дополнительно проверяется человеком, хотя базовая геометрия автоматизирована.

## 1. Обязательный функциональный объём

| ID   | Требование источника                                                                                         | Статус        | Реализация                                                                                                               | Автоматическое доказательство                                                               | Проверка на production                                     |
| ---- | ------------------------------------------------------------------------------------------------------------ | ------------- | ------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| R-01 | Верхняя часть витрины структурно близка к макету: шапка, баннер, сервисы, Steam, один ряд товаров (стр. 1–3) | PASS / MANUAL | [Angular storefront](../apps/web/src/app/storefront.component.html), [CSS](../apps/web/src/app/storefront.component.css) | [Playwright](../tests/e2e/storefront.spec.ts): 5 карточек, assets, desktop/mobile геометрия | Browser screenshot и [FIDELITY_LEDGER](FIDELITY_LEDGER.md) |
| R-02 | Карусель переключается автоматически и/или стрелками, активны точки (стр. 2–3)                               | PASS          | Angular signals + 5-секундный timer                                                                                      | Playwright проверяет обе стрелки, точку, active class и auto-advance                        | Публичная `/`, интерактив №1                               |
| R-03 | «Каталог» открывается; повторный клик или клик вне закрывает (стр. 3)                                        | PASS          | document HostListener + stopPropagation                                                                                  | Playwright проверяет open, внутренний клик, outside close и повторную кнопку                | Публичная `/`, интерактив №2                               |
| R-04 | Валюты `$ / ₸ / ₽` кликабельны, меняется active; пересчёт не нужен (стр. 3)                                  | PASS          | Angular signal `currency`                                                                                                | Playwright переключает ₸ и ₽ и проверяет class                                              | Публичная `/`, интерактив №3                               |
| R-05 | Иконки сервисов плавно выделяются при hover (стр. 3)                                                         | PASS          | CSS transition/transform                                                                                                 | Playwright проверяет вычисленный `transform`                                                | Публичная `/`, интерактив №4                               |
| R-06 | Карточки товара выделяются при hover (стр. 3)                                                                | PASS          | CSS lift/shadow/border                                                                                                   | Playwright проверяет вычисленный `transform`                                                | Публичная `/`, интерактив №5                               |
| R-07 | Покупка начинается с «Купить» на карточке (стр. 1–2)                                                         | PASS          | `StorefrontComponent.buy()`                                                                                              | Playwright делает настоящий `dblclick`                                                      | Публичный полный UI flow                                   |
| R-08 | Создание заказа и страница статуса (стр. 1)                                                                  | PASS          | `POST /orders`, `GET /orders/:id`, Angular order screen                                                                  | Race + Playwright                                                                           | `/orders/<uuid>`                                           |
| R-09 | Оплата — кнопка/endpoint-заглушка, реально посылающая webhook; реального списания нет (стр. 1–2, 5)          | PASS          | `POST /payments/simulate` вызывает webhook по HTTP                                                                       | Race scenario `payment simulator delivers a real webhook`; Playwright                       | Кнопка «Оплатить успешно»                                  |
| R-10 | Автоматическая выдача ключа из пула (стр. 1, 4)                                                              | PASS          | Worker → Provider A/B → fulfillment                                                                                      | Race проверяет fulfillment + spent provider key; E2E видит code                             | Статус `delivered` и один код                              |
| R-11 | Один ключ не должен уйти в два заказа (стр. 1, 4)                                                            | PASS          | атомарный reserve, `provider_keys.code UNIQUE`, `fulfillments.code UNIQUE`                                               | 50-webhook race + DB assertions                                                             | Косвенно: один публичный code и один delivered transition  |
| R-12 | Каталог и тестовые цены/валюта из приложения (стр. 4)                                                        | PASS          | 12 seed products, integer minor units                                                                                    | Acceptance сверяет 12 товаров и `STEAM-TOPUP-500 = 50_000` коп.                             | `GET /api/v1/catalog/products`                             |
| R-13 | Все 50 ключей из материалов доступны для выдачи (стр. 4–5)                                                   | PASS          | `INITIAL_PROVIDER_KEYS`, seed A/B                                                                                        | Safe-reset scenario требует ровно 50 исходных ключей                                        | Защищённый reset возвращает seed                           |

## 2. Однократная выдача и конкурентность

| ID   | Критерий                                                                                       | Статус | Механизм                                                                         | Доказательство                                                                   |
| ---- | ---------------------------------------------------------------------------------------------- | ------ | -------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| C-01 | Двойной клик создаёт один заказ (стр. 1)                                                       | PASS   | один browser intent; `orders.idempotency_key UNIQUE`; fingerprint replay         | Два конкурентных `POST`: ровно `201 + 200`, одна строка заказа                   |
| C-02 | Один Idempotency-Key с другим payload отклоняется                                              | PASS   | сохранённый `idempotency_payload`                                                | Acceptance ожидает `409`; повтор public UUID с новым key тоже `409`              |
| C-03 | 50 параллельных `paid` по одному заказу дают один факт выдачи и один потраченный ключ (стр. 3) | PASS   | event inbox, `delivery_jobs.order_id UNIQUE`, `fulfillments.order_id UNIQUE`     | 50 разных событий: 50 inbox rows, 1 job, 1 fulfillment, 1 provider key           |
| C-04 | 50 повторов одного `event_id` ничего не дублируют (стр. 1, 3, 5)                               | PASS   | `payment_events.event_id UNIQUE`                                                 | 50 + 10 replay: одна event row; неизменны status/code/history                    |
| C-05 | Webhook сохраняется до ответа `200` (стр. 5)                                                   | PASS   | `ShopService.acceptWebhook()` сначала INSERT, затем return                       | Race проверяет HTTP 200 и наличие строки; OpenAPI фиксирует контракт             |
| C-06 | Webhook раньше заказа не теряется (стр. 3, 5)                                                  | PASS   | inbox без обязательного FK; worker выбирает событие только после появления order | Раннее событие сначала `pending`, затем приводит заказ к `delivered`             |
| C-07 | События могут прийти не по порядку (стр. 3, 5)                                                 | PASS   | paid имеет приоритет; failed меняет только `created`; delivered не регрессирует  | Цепочка `failed → paid → failed` заканчивается прежним `delivered` и тем же code |
| C-08 | Подменённая сумма/валюта не запускает выдачу                                                   | PASS   | сверка с immutable order snapshot; inbox state `invalid`                         | Два события quarantined; order остаётся `created`; job отсутствует               |
| C-09 | Цена и скидка считаются сервером, клиенту нельзя доверять (стр. 1, 3, 6)                       | PASS   | DTO запрещает неизвестные money fields; каталог читается в транзакции            | Подмена `finalPriceMinor/currency` получает `400`, заказ не создаётся            |
| C-10 | Деньги не вычисляются floating point                                                           | PASS   | целые копейки + `orders_money_consistent CHECK`                                  | Domain unit tests: percent/fixed/cap/invalid money                               |

## 3. Поставщики, timeout и восстановление (бонусный этап 3)

| ID   | Требование                                                                  | Статус | Реализация                                                       | Доказательство                                                     |
| ---- | --------------------------------------------------------------------------- | ------ | ---------------------------------------------------------------- | ------------------------------------------------------------------ |
| P-01 | Две заглушки по `POST /issue {request_id, sku, order_id}` (стр. 5–6)        | PASS   | один NestJS образ с `PROVIDER_ID=A/B`                            | Compose запускает два процесса; health возвращает identity         |
| P-02 | Настраиваемые success, out-of-stock, 5xx до выдачи, timeout после выдачи    | PASS   | `provider_settings`, защищённый admin endpoint                   | Acceptance детерминированно воспроизводит каждый режим             |
| P-03 | Повтор того же `request_id` возвращает тот же code (стр. 6)                 | PASS   | `provider_keys.request_id UNIQUE`; replay читается до fault mode | Timeout scenario видит attempts `timeout + success`, один key      |
| P-04 | Timeout не считается отказом и не разрешает вызвать B (стр. 6)              | PASS   | A timeout → retry той же job/request A                           | DB assertion: после неоднозначного timeout нет ProviderRequest B   |
| P-05 | Явный out-of-stock A разрешает fallback B (стр. 5–6)                        | PASS   | B вызывается после однозначного ответа A                         | A принудительно OOS; fulfillment создан Provider B                 |
| P-06 | Оба пула пусты: заказ `out_of_stock`, API не падает (стр. 1, 3, 6)          | PASS   | recoverable status + failed job                                  | Race физически удаляет все provider keys и получает `out_of_stock` |
| P-07 | Оба поставщика 5xx: заказ остаётся восстановимым `delivery_failed` (стр. 6) | PASS   | history + failed job, данные оплаты сохранены                    | Два `server_error_before_issue` → `delivery_failed`                |
| P-08 | Админка показывает «оплачен, но не выдан» (стр. 1)                          | PASS   | `/admin/recovery/orders`, Angular admin                          | Race требует наличие OOS/failure order в списке                    |
| P-09 | Пополнение и ручной retry дают ровно один code (стр. 1, 3, 6)               | PASS   | upsert прежней job; стабильные ProviderRequest                   | Два параллельных retry + повтор после delivered остаются no-op     |
| P-10 | Recovery переиспользует provider request IDs                                | PASS   | `@@unique([orderId, providerId])`                                | До/после восстановления массив request IDs идентичен               |
| P-11 | Внешний HTTP не держит DB transaction                                       | PASS   | job claim commit до `fetch`, completion отдельной транзакцией    | Архитектурная проверка кода + bounded provider timeout             |

## 4. Промокоды (бонусный этап 4)

| ID   | Требование                                                     | Статус | Реализация                                                                | Доказательство                                                   |
| ---- | -------------------------------------------------------------- | ------ | ------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| M-01 | Все четыре промокода из материалов (стр. 6)                    | PASS   | `WELCOME10`, `GG500`, `LIMIT3`, `ONCEONLY` в seed                         | Safe reset проверяет нулевые counters; quote проверяет WELCOME10 |
| M-02 | Предварительный quote не расходует лимит                       | PASS   | read-only `quotePromo()`                                                  | До/после quote `used_count = 0`                                  |
| M-03 | Один заказ применяет промокод один раз                         | PASS   | `promo_redemptions.order_id UNIQUE`; redemption внутри create transaction | `ONCEONLY`: create `201`, replay `200`, used_count остаётся 1    |
| M-04 | LIMIT3 под 50 запросами применяется не более N раз (стр. 3, 6) | PASS   | `SELECT promocode FOR UPDATE`, bounded CHECK                              | Ровно 3×`201`, 47×`409`, 3 redemptions, used_count 3             |
| M-05 | Фиксированная скидка не делает цену отрицательной              | PASS   | `calculatePrice()` ограничивает discount диапазоном цены                  | Domain unit test `500 > 300 → final 0`                           |

## 5. Статусы и переходы

| ID   | Требование (стр. 6)                                         | Статус | Доказательство                                           |
| ---- | ----------------------------------------------------------- | ------ | -------------------------------------------------------- |
| S-01 | `created → paid → delivering → delivered`                   | PASS   | E2E и payment simulator race                             |
| S-02 | `created → payment_failed`; поздний paid может восстановить | PASS   | unordered event race                                     |
| S-03 | `delivering → out_of_stock → delivering → delivered`        | PASS   | empty-pool recovery race                                 |
| S-04 | `delivering → delivery_failed → delivering → delivered`     | PASS   | two-provider-5xx recovery race                           |
| S-05 | Повтор оплаты/выдачи не меняет финальный заказ              | PASS   | duplicate no-op + retry delivered no-op                  |
| S-06 | История аудирует каждый реальный переход                    | PASS   | Order read model + E2E требует один delivered transition |

## 6. API, эксплуатация и инженерное качество

| ID   | Требование/решение                                          | Статус | Доказательство                                                                   |
| ---- | ----------------------------------------------------------- | ------ | -------------------------------------------------------------------------------- |
| O-01 | REST API и валидация DTO                                    | PASS   | NestJS ValidationPipe allowlist; malformed UUID → 400; unknown money field → 400 |
| O-02 | Swagger/OpenAPI                                             | PASS   | `/api/docs`, `/api/openapi.json`; checker требует все 14 операций                |
| O-03 | Admin token                                                 | PASS   | Guard fail-closed; без header → 401; production token серверный                  |
| O-04 | Liveness/readiness                                          | PASS   | `/api/health/live`; readiness выполняет реальный `SELECT 1`                      |
| O-05 | Наблюдаемость                                               | PASS   | JSON HTTP/worker logs; Prometheus queue/events/status/retry/provider outcomes    |
| O-06 | Безопасный reset                                            | PASS   | advisory RW-lock не допускает claim между check/delete; processing job → 503     |
| O-07 | Реальная PostgreSQL в race tests                            | PASS   | CI service PostgreSQL 17, никаких in-memory DB mocks                             |
| O-08 | UI assets не сломаны                                        | PASS   | Playwright проверяет `complete && naturalWidth > 0` для всех 15 видимых images   |
| O-09 | Узкий экран не ломается, хотя mobile design не обязателен   | PASS   | 390×844, открытый catalog, `scrollWidth <= clientWidth`                          |
| O-10 | Production image собирается и содержит runtime dependencies | PASS   | CI Docker build + `reflect-metadata`, OpenSSL, Prisma/tsx, Angular index smoke   |
| O-11 | Secret hygiene                                              | PASS   | `.env*` ignore, gitleaks full history, offline generator исключает secrets       |
| O-12 | Reproducible CI/CD и rollback                               | PASS   | CI на push; manual immutable SHA deployment + health-check + rollback            |

## 7. Что требуется от кандидата в ответе

| ID   | Deliverable (стр. 4)                      | Статус | Где находится                                                                                                                                                                                                                                  |
| ---- | ----------------------------------------- | ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D-01 | Ссылка на живую версию или README запуска | PASS   | [Production](https://test-shop.komaroff-dev.ru), [публичный учебник](https://test-shop.komaroff-dev.ru/docs/), [README](../README.md)                                                                                                          |
| D-02 | Исходники GitHub или архив                | PASS   | [GitHub](https://github.com/komaroffsergei/fullstack-test-shop); чистый ZIP приложен к [release v1.1.1](https://github.com/komaroffsergei/fullstack-test-shop/releases/tag/v1.1.1)                                                             |
| D-03 | Как воспроизвести гонки                   | PASS   | [TESTING.md](TESTING.md), `pnpm test:race`                                                                                                                                                                                                     |
| D-04 | Пара строк о гарантии однократности       | PASS   | README «Почему код выдаётся ровно один раз», [ADR-002](adr/002-idempotency-and-inbox.md), [ADR-003](adr/003-provider-timeout.md)                                                                                                               |
| D-05 | Фактическое время                         | PASS   | [TIMELOG.md](TIMELOG.md) и README                                                                                                                                                                                                              |
| D-06 | Чистота кода и способность объяснить      | PASS   | Русские комментарии у методов/критических мест, [HTML-учебник](tutorial/index.html), [offline source](offline/index.html), [CODEMAP](../CODEMAP.md); те же материалы доступны на [production `/docs`](https://test-shop.komaroff-dev.ru/docs/) |

## 8. Прямо разрешённые исключения

| ID   | Не требуется источником                 | Статус    | Решение                                                         |
| ---- | --------------------------------------- | --------- | --------------------------------------------------------------- |
| X-01 | Реальный эквайринг и списание денег     | N/A по ТЗ | только payment simulator + webhook                              |
| X-02 | Проверка подписи/секрета webhook        | N/A по ТЗ | упрощено; production-рекомендации описаны в SECURITY            |
| X-03 | Пользовательская авторизация            | N/A по ТЗ | admin закрыт простым server token                               |
| X-04 | Полная страница, отзывы, большой footer | N/A по ТЗ | реализован только требуемый верх + минимальный служебный footer |
| X-05 | Отдельный mobile и dark дизайн          | N/A по ТЗ | дизайн не создавался, но overflow исключён                      |
| X-06 | Пиксель-perfect                         | N/A по ТЗ | структурная fidelity по макету, детали в FIDELITY_LEDGER        |

## Итоговая трассируемость

- Первичные пять критериев работодателя: **5/5 PASS**.
- Обязательный этап 1: **PASS**.
- Ключевой этап 2: **PASS**.
- Бонусный этап 3: **PASS**.
- Бонусный этап 4: **PASS**.
- Production black-box: **9/9 PASS** на публичном HTTPS в deploy [`33500223414`](https://github.com/komaroffsergei/fullstack-test-shop/actions/runs/33500223414); результат формируется без секретов.
- Production Playwright: **3/3 PASS**; финальный reset: `recovery=0`, `ready=ok`.
- Точные времена, исправления и ссылки на CI/deploy зафиксированы в [ACCEPTANCE_REPORT.md](ACCEPTANCE_REPORT.md).
