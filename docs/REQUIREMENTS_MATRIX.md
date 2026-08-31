# Матрица требований

| Пункт ТЗ                                   | Реализация                                                 | Автопроверка             | Ручная проверка                    |
| ------------------------------------------ | ---------------------------------------------------------- | ------------------------ | ---------------------------------- |
| Шапка, баннер, сервисы, Steam, ряд товаров | `StorefrontComponent`, исходные Figma assets               | Playwright               | `/` desktop screenshot             |
| 1. Карусель                                | timer, arrows, active dots                                 | E2E banner 2             | подождать 5 секунд/стрелки         |
| 2. Каталог open/close/outside              | document click + stop propagation                          | E2E                      | кнопка и клик вне меню             |
| 3. Валюта                                  | Angular signal активного состояния                         | E2E                      | `$ / ₸ / ₽`                        |
| 4. Hover сервисов                          | CSS transform/color transition                             | E2E hover                | навести мышь                       |
| 5. Hover товара                            | CSS lift/shadow/border                                     | E2E hover                | навести мышь                       |
| Создание заказа                            | `POST /api/v1/orders`                                      | race + E2E               | Купить                             |
| Серверная цена                             | product snapshot из БД; клиент сумму не передаёт           | API contract             | DevTools body                      |
| Двойной клик                               | стабильные UUID/key в UI + DB UNIQUE/fingerprint           | race                     | double click Купить                |
| Webhook stub                               | simulator делает HTTP на webhook                           | E2E                      | успешная/неуспешная кнопка         |
| Повтор event_id                            | UNIQUE `payment_events.event_id`                           | 50 identical race        | повторить curl                     |
| 50 разных paid                             | UNIQUE job/order и fulfillment/order                       | 50 unique race           | `pnpm test:race`                   |
| Ранний webhook                             | inbox без обязательного FK, worker join order              | race                     | событие до order                   |
| Не по порядку                              | monotonic state policy, paid priority                      | domain/race              | failed затем paid                  |
| Один ключ одному заказу                    | provider reserve transaction, code UNIQUE                  | race DB assertions       | таблицы provider_keys/fulfillments |
| Пустой пул                                 | `out_of_stock`, API не падает                              | race suite scenario/docs | admin fault mode                   |
| Админка recovery                           | list/add keys/retry/reset, X-Admin-Token                   | E2E/API                  | `/admin`                           |
| Идемпотентный retry                        | одна job, стабильные provider requests                     | race/manual              | повторить Retry                    |
| Два поставщика                             | A, затем B только после однозначного результата            | worker logic             | fault modes                        |
| Timeout после выдачи                       | mapping сохраняется до задержки; same request returns code | race/manual              | `timeout_after_issue`              |
| Промокод N                                 | row lock, redemption UNIQUE, CHECK used ≤ max              | 50 concurrent LIMIT3     | `pnpm test:race`                   |
| Swagger                                    | `/api/docs`, `/api/openapi.json`                           | CI contract check        | открыть URL                        |
| Документация/CODEMAP                       | README, CODEMAP, docs, ADR                                 | CI link review           | репозиторий                        |
| Deployment                                 | Compose, Nginx, TLS, manual immutable workflow             | health check             | production URL                     |
