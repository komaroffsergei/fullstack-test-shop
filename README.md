# fullstack-test-shop

Тестовый магазин цифровых товаров с главным акцентом на **однократную выдачу под гонками** и безопасное восстановление после сбоев.

- Витрина: Angular 21 LTS, близко к предоставленному Figma-макету.
- API: NestJS + Swagger.
- Данные и очередь: PostgreSQL 17, Prisma и raw SQL для блокировок.
- Выдача: отдельный worker и две HTTP-заглушки поставщиков.
- Production URL: [test-shop.komaroff-dev.ru](https://test-shop.komaroff-dev.ru)
- API docs: [test-shop.komaroff-dev.ru/api/docs](https://test-shop.komaroff-dev.ru/api/docs)
- Offline release: [v1.1.0 с чистым ZIP](https://github.com/komaroffsergei/fullstack-test-shop/releases/tag/v1.1.0)
- CI: format, typed lint, strict typecheck (workspace + root), unit, 13-scenario race, E2E, OpenAPI, offline-doc verification, Docker runtime smoke и gitleaks.

## Быстрый запуск

Нужны Node.js 22, pnpm 11 и Docker.

```bash
cp .env.example .env
docker compose up -d postgres
pnpm install
pnpm db:generate
pnpm db:deploy
pnpm db:seed
pnpm dev
```

Откройте `http://localhost:4200`. API слушает `http://localhost:4000`, поставщики — `4101/4102`. Значение `ADMIN_TOKEN` из локального `.env` вводится на `/admin`; frontend его не сохраняет.

## Как пройти основной сценарий

1. На витрине нажать «Купить» или «Оплатить 500 ₽».
2. На странице заказа нажать «Оплатить успешно».
3. Заглушка оплаты отправит настоящий webhook в inbox.
4. Worker применит событие, запросит поставщика и покажет выданный код.

Для воспроизводимого сбоя в `/admin` выберите `out-of-stock`, `5xx before issue` или `timeout after issue`. После пополнения пула ручной retry использует те же provider request IDs.

## Проверка гонок

При запущенном стеке:

```bash
pnpm test:race
```

Скрипт создаёт реальные конкурентные HTTP-запросы и затем проверяет PostgreSQL: одно событие для одинакового `event_id`, максимум один fulfillment, ровно один потраченный ключ, сохранение раннего webhook и лимит промокода.

Текущая расширенная матрица содержит **13/13 сценариев**: помимо пяти критериев ТЗ она проверяет конфликт idempotency payload, server-owned price, amount/currency mismatch, payment simulator, timeout без fallback на B, два provider 5xx, стабильность request IDs и безопасный reset.

Полная проверка:

```bash
pnpm format:check
pnpm lint
pnpm typecheck
pnpm comments:verify
pnpm test
pnpm build
pnpm test:race
pnpm test:e2e
pnpm docs:verify
```

Эта же матрица прошла в GitHub Actions. После production deploy дополнительно выполнен Playwright smoke-test прямо на публичном HTTPS-домене: пять обязательных интерактивов, двойной клик «Купить», оплата, выдача кода и отсутствие горизонтального overflow на ширине 390 px.

Полная black-box приемка публичного стенда (9 сценариев) запускается с отдельно переданным server token и явным разрешением demo reset:

```bash
PRODUCTION_BASE_URL=https://test-shop.komaroff-dev.ru \
PRODUCTION_ADMIN_TOKEN='<private>' \
ALLOW_DEMO_RESET=1 \
pnpm test:production
```

Подробности и точный смысл каждого assertion: [docs/TESTING.md](docs/TESTING.md).

## Подтверждённая приёмка

Проверенный runtime commit [`b83fadf85c55`](https://github.com/komaroffsergei/fullstack-test-shop/commit/b83fadf85c55fbb249edb95094f4567f24b37fbb) прошёл:

- [финальный CI `33499836115`](https://github.com/komaroffsergei/fullstack-test-shop/actions/runs/33499836115) — `success`;
- [production deploy `33500223414`](https://github.com/komaroffsergei/fullstack-test-shop/actions/runs/33500223414) — `success`, immutable GHCR-образ;
- 13/13 локальных PostgreSQL race-сценариев;
- 9/9 black-box сценариев через настоящий `https://test-shop.komaroff-dev.ru`;
- 3/3 локальных и 3/3 production Playwright-тестов;
- 156/156 методов и функций с ведущими русскими комментариями;
- финальный demo reset: `recovery=0`, `ready=ok`.

Точные времена, assertions, найденные дефекты и внесённые исправления приведены в [отчёте полной приёмки](docs/ACCEPTANCE_REPORT.md).

## Почему код выдаётся ровно один раз

`event_id`, `orders.idempotency_key`, `delivery_jobs.order_id`, `fulfillments.order_id` и `fulfillments.code` защищены UNIQUE-ограничениями. Worker атомарно захватывает одно задание через `FOR UPDATE SKIP LOCKED`, а поставщик атомарно закрепляет свободный ключ за стабильным `request_id`. При timeout worker повторяет **тот же запрос тому же поставщику**: если код уже был зарезервирован, поставщик возвращает его повторно. Внешний HTTP никогда не выполняется внутри транзакции.

## Навигация по проекту

- [Интерактивный HTML-учебник](docs/tutorial/index.html) — подробный курс по стеку и всем критическим потокам, переключатель «профессионально / как для 10 лет», контрольные вопросы и code map с прямыми ссылками на GitHub.
- [Автономный HTML source handbook](docs/offline/index.html) — 100+ точных текстовых исходников внутри одного HTML: поиск по именам/коду, номера строк, deep links, копирование/скачивание, две версии объяснения и SHA-256 каждого файла. Интернет не нужен.
- [CODEMAP.md](CODEMAP.md) — entrypoints, модули, таблицы и карта тестов.
- [docs/REQUIREMENTS_MATRIX.md](docs/REQUIREMENTS_MATRIX.md) — полное соответствие ТЗ.
- [docs/ACCEPTANCE_REPORT.md](docs/ACCEPTANCE_REPORT.md) — фактические локальные/CI/production результаты.
- [docs/SUBMISSION_CHECKLIST.md](docs/SUBMISSION_CHECKLIST.md) — финальный preflight и создание чистого архива.
- [docs/FIDELITY_LEDGER.md](docs/FIDELITY_LEDGER.md) — сверка браузера с макетом.
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — схемы контейнеров, последовательностей и состояний.
- [docs/API.md](docs/API.md), [docs/TESTING.md](docs/TESTING.md), [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md), [docs/SECURITY.md](docs/SECURITY.md).
- [docs/TIMELOG.md](docs/TIMELOG.md) — фактический замер времени.

## Production

Приложение работает с одного origin за Nginx и Let's Encrypt. На VDS запущены `app`, `worker`, `provider-a`, `provider-b` и PostgreSQL; наружу опубликован только `app` на loopback-интерфейсе. Релизный workflow разворачивает immutable GHCR-образ по git SHA, выполняет миграции и health-check. Production-секреты хранятся только на сервере и в GitHub Actions secrets.

## Осознанные границы

Нет реального эквайринга и подписи webhook, пользовательской авторизации, отзывов, полного футера, dark mode и отдельного mobile-макета — они прямо исключены или не требуются в ТЗ. Узкий экран при этом не ломается. Redis/RabbitMQ не используются: для этого объёма PostgreSQL inbox + очередь проще, наблюдаемее и дают необходимые гарантии.

Лицензия: MIT.
