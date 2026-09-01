# Полное руководство по тестированию

Цель тестов — доказать бизнес-инварианты, а не только получить зелёный HTTP-код. Для критической гарантии «один заказ → максимум один ключ» используются независимые уровни: чистые доменные правила, настоящая PostgreSQL, живые процессы API/worker/providers, браузер и публичный HTTPS.

## 1. Пирамида проверок

| Уровень              | Инструмент                                | Что способен доказать                                                                | Что намеренно не подменяет                         |
| -------------------- | ----------------------------------------- | ------------------------------------------------------------------------------------ | -------------------------------------------------- |
| Static               | Prettier, ESLint typed, TypeScript strict | формат, опасные Promise, несовместимые типы во всех workspace и root scripts         | runtime и гонки                                    |
| Unit                 | Vitest, Angular TestBed                   | деньги в копейках, state transitions, fingerprint, bootstrap UI                      | блокировки PostgreSQL                              |
| Integration/race     | `tests/race/run.ts`                       | HTTP + worker + два providers + настоящие locks/UNIQUE/данные БД                     | внешний production network                         |
| Browser E2E          | Playwright Chromium                       | пять интерактивов, dblclick, simulator, code, assets, CSS hover, responsive overflow | внутреннее число строк БД                          |
| Production black-box | `tests/production/run.ts`                 | те же сценарии через Nginx/TLS/public origin, без прямого доступа к БД               | DB assertions (они остаются локальному race suite) |
| Delivery             | Docker/CI/gitleaks                        | чистая сборка, runtime dependencies, secrets, immutable artifact                     | продуктовую логику без предыдущих уровней          |

## 2. Первый локальный запуск

Команды выполняются из корня репозитория. `dotenv-cli` автоматически читает локальный `.env`, но не перезаписывает переменные, уже заданные CI или shell.

```bash
cp .env.example .env
docker compose up -d postgres
pnpm install --frozen-lockfile
pnpm db:generate
pnpm db:deploy
pnpm db:seed
pnpm dev
```

Проверка готовности:

```bash
curl -fsS http://127.0.0.1:4000/api/health/ready
curl -fsS http://127.0.0.1:4200/
```

Не запускайте race suite против неизвестной БД. Скрипт вызывает защищённый demo reset и предназначен только для выделенного локального/приемочного окружения.

## 3. Статические и unit проверки

```bash
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

`pnpm typecheck` проверяет как семь workspace packages, так и root `tsconfig.json`, куда входят тестовые CLI, Playwright config и генераторы документации. Это закрывает прежнюю типичную дыру monorepo, когда `pnpm -r` не запускает проверку самого корня.

Domain tests проверяют:

- fixed discount с ограничением до нулевой цены;
- процентную скидку без floating point;
- отказ отрицательной, дробной и unsafe цены;
- терминальность `delivered`;
- ветви `payment_failed/out_of_stock/delivery_failed`;
- идемпотентный self-transition каждого статуса;
- нормализацию и различимость idempotency fingerprint.

## 4. Полная локальная race-приемка

При запущенных API, worker и providers:

```bash
pnpm test:race
```

Скрипт последовательно выполняет 13 изолированных сценариев. Каждый сценарий возвращает demo seed перед началом, а критические результаты подтверждаются напрямую в PostgreSQL.

### 4.1 Контракты и защита

1. `live`, `ready`, Swagger, OpenAPI и Prometheus доступны.
2. Каталог содержит 12 товаров; серверная цена `STEAM-TOPUP-500` равна `50_000` копеек.
3. Все 14 обязательных OpenAPI операций существуют с правильными HTTP methods.
4. Admin API без `X-Admin-Token` возвращает `401`.
5. malformed UUID возвращает `400`, а не внутреннюю ошибку Prisma.

### 4.2 Заказ и цена

1. Два одновременных `POST /orders` с одним intent дают ровно `201 + 200`.
2. В БД одна строка для `idempotency_key`.
3. Тот же key с другим SKU — `409`.
4. Тот же public order UUID с другим key — `409`.
5. Неизвестные `finalPriceMinor/currency` — `400`, строка заказа не появляется.
6. Read model содержит server snapshot, а не клиентское значение.

### 4.3 Пять первичных критериев работодателя

1. **50 одинаковых webhook**: одна event row, одна job, один fulfillment, один spent key; ещё 10 повторов не меняют status/code/history.
2. **50 разных paid events**: 50 event rows, но одна job, один fulfillment и один spent key.
3. **Раннее/неупорядоченное событие**: раннее остаётся pending; `failed → paid → failed` не регрессирует delivered.
4. **Пустой пул и recovery**: физически удаляются все ключи; заказ становится `out_of_stock`; два concurrent retry после пополнения дают один code.
5. **Promo LIMIT3**: 50 конкурентных заказов дают ровно 3×`201`, 47×`409`, три redemptions и `used_count=3`.

### 4.4 Дополнительные отказные проверки

- mismatch amount и currency становятся `invalid`, не создают job;
- simulator посылает реальный webhook HTTP-вызовом;
- timeout-after-issue даёт attempts `timeout + success`, остаётся один spent key и отсутствует request к B;
- явный out-of-stock A безопасно переключает на B;
- два 5xx-before-issue дают `delivery_failed`, а ручное восстановление сохраняет прежние request IDs;
- повтор retry уже доставленного заказа — no-op;
- quote не расходует promo; replay ONCEONLY не удваивает counter;
- reset возвращает ровно 50 ключей/нулевые counters/success modes;
- reset при processing job получает `503` и не удаляет данные.

## 5. Browser E2E

Локально с автоматически поднимаемым `pnpm dev`:

```bash
pnpm test:e2e
```

Если стек уже запущен:

```bash
PLAYWRIGHT_EXTERNAL_SERVER=1 WEB_URL=http://127.0.0.1:4200 pnpm test:e2e
```

Проверяется:

- hero: обе стрелки, dots, active state и auto-advance;
- catalog: open, клик внутри, outside close, повторная кнопка;
- валюты ₸/₽ и active class;
- вычисленный CSS transform при hover сервиса и товара;
- ровно пять видимых карточек;
- настоящий double click «Купить»;
- переход на UUID заказа, simulator paid и один code;
- ровно один `delivered` в UI history;
- все 15 видимых PNG в пределах 10 секунд получают `complete=true` и `naturalWidth>0`; проверка ждёт сетевые свойства, а не только готовность DOM;
- viewport 390×844 с открытым catalog не имеет horizontal overflow;
- нет `console.error` и необработанных `pageerror`.

При падении сохраняются screenshot, trace и error context в ignored-каталог `test-results/`.

## 6. Production black-box

Production suite намеренно требует два явных условия: server token и подтверждение demo reset. Токен не записывается в отчёт и не выводится в stdout. Официальный deploy запускает suite одноразовым контейнером на VDS: `ADMIN_TOKEN` читается из `.env.production` внутри Compose и не копируется на GitHub runner или рабочую машину.

PowerShell:

```powershell
$env:PRODUCTION_BASE_URL = 'https://test-shop.komaroff-dev.ru'
$env:PRODUCTION_ADMIN_TOKEN = '<переданный отдельно токен>'
$env:ALLOW_DEMO_RESET = '1'
pnpm test:production
```

Bash:

```bash
PRODUCTION_BASE_URL=https://test-shop.komaroff-dev.ru \
PRODUCTION_ADMIN_TOKEN='<server token>' \
ALLOW_DEMO_RESET=1 \
pnpm test:production
```

Suite проходит 9 black-box сценариев через публичный HTTPS:

1. Angular page, TLS origin, health, catalog, OpenAPI, metrics, anonymous admin `401`;
2. double click/replay/conflict/money tamper;
3. 50 identical + 50 unique webhook;
4. early и unordered events;
5. out-of-stock + recovery + concurrent retry;
6. timeout-after-issue;
7. A out-of-stock → B;
8. два provider 5xx → recovery;
9. LIMIT3 под 50 parallel requests.

Машиночитаемый результат: `test-results/acceptance-production.json`. Он содержит URL, время, длительность и несекретные факты каждого сценария, но не admin token и не выданные коды. После успешного прогона suite делает финальный reset.

Production Playwright:

```bash
PLAYWRIGHT_EXTERNAL_SERVER=1 \
WEB_URL=https://test-shop.komaroff-dev.ru \
pnpm test:e2e
```

После браузерной покупки требуется ещё раз выполнить защищённый reset, чтобы оставить стенд в исходном состоянии. Deploy workflow делает это отдельным server-side шагом с `PRODUCTION_FINAL_RESET_ONLY=1` и одновременно требует пустой recovery list и зелёный readiness.

## 7. OpenAPI и offline documentation gates

При запущенном API:

```bash
pnpm openapi:generate
```

Команда называется исторически, но фактически валидирует живую schema и все операции.

Автономный source handbook:

```bash
pnpm docs:offline
pnpm docs:verify
```

Verifier требует:

- полный список разрешённых tracked/untracked source-файлов;
- SHA-256 текущего содержимого каждого файла;
- line anchors и карточку каждого manifest entry;
- наличие frontend/API/worker/providers/SQL/race/production/E2E/CI/Docker/docs;
- отсутствие `.env`, `node_modules`, lockfile и внешних JS/CSS зависимостей.

## 8. CI quality gate

На каждый push/PR GitHub Actions выполняет:

1. checkout + Node 22 + frozen pnpm install;
2. PostgreSQL 17 service;
3. Prisma generate/migrate/seed;
4. format, typed lint, workspace+root typecheck, unit, docs verifier, build;
5. Chromium install;
6. запуск API/worker/A/B/Angular и ready loop;
7. 13-scenario race acceptance;
8. полный OpenAPI check;
9. 3 Playwright E2E;
10. production Docker build;
11. runtime dependency/Angular/Prisma/OpenSSL smoke;
12. независимый full-history gitleaks job.

При любой ошибке CI прикладывает process logs, Playwright report и test-results. Deployment разрешается только после зелёного CI и использует immutable image по commit SHA.

## 9. Как интерпретировать результат

Зелёный один тест не доказывает exactly-once. Для сдачи нужны одновременно:

- HTTP результат один и тот же;
- одна event/job/fulfillment row согласно сценарию;
- ровно один физически закреплённый provider key;
- один публичный code;
- один переход `delivered`;
- повторный вызов не меняет history;
- тот же сценарий проходит через production HTTPS;
- CI воспроизводит результат в чистом окружении.

Текущий зафиксированный результат находится в [ACCEPTANCE_REPORT.md](ACCEPTANCE_REPORT.md), а связь каждого пункта ТЗ с тестом — в [REQUIREMENTS_MATRIX.md](REQUIREMENTS_MATRIX.md).
