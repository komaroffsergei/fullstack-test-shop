# fullstack-test-shop

Тестовый магазин цифровых товаров с главным акцентом на **однократную выдачу под гонками** и безопасное восстановление после сбоев.

- Витрина: Angular 21 LTS, близко к предоставленному Figma-макету.
- API: NestJS + Swagger.
- Данные и очередь: PostgreSQL 17, Prisma и raw SQL для блокировок.
- Выдача: отдельный worker и две HTTP-заглушки поставщиков.
- Production URL: [test-shop.komaroff-dev.ru](https://test-shop.komaroff-dev.ru)
- API docs: [test-shop.komaroff-dev.ru/api/docs](https://test-shop.komaroff-dev.ru/api/docs)
- CI: format, lint, strict typecheck, unit/integration/race/E2E, OpenAPI и runtime Docker smoke-test.

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

Полная проверка:

```bash
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm test:race
pnpm test:e2e
```

Эта же матрица прошла в GitHub Actions. После production deploy дополнительно выполнен Playwright smoke-test прямо на публичном HTTPS-домене: пять обязательных интерактивов, двойной клик «Купить», оплата, выдача кода и отсутствие горизонтального overflow на ширине 390 px.

## Почему код выдаётся ровно один раз

`event_id`, `orders.idempotency_key`, `delivery_jobs.order_id`, `fulfillments.order_id` и `fulfillments.code` защищены UNIQUE-ограничениями. Worker атомарно захватывает одно задание через `FOR UPDATE SKIP LOCKED`, а поставщик атомарно закрепляет свободный ключ за стабильным `request_id`. При timeout worker повторяет **тот же запрос тому же поставщику**: если код уже был зарезервирован, поставщик возвращает его повторно. Внешний HTTP никогда не выполняется внутри транзакции.

## Навигация по проекту

- [Интерактивный HTML-учебник](docs/tutorial/index.html) — подробный курс по стеку и всем критическим потокам, переключатель «профессионально / как для 10 лет», контрольные вопросы и code map с прямыми ссылками на GitHub.
- [CODEMAP.md](CODEMAP.md) — entrypoints, модули, таблицы и карта тестов.
- [docs/REQUIREMENTS_MATRIX.md](docs/REQUIREMENTS_MATRIX.md) — полное соответствие ТЗ.
- [docs/FIDELITY_LEDGER.md](docs/FIDELITY_LEDGER.md) — сверка браузера с макетом.
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — схемы контейнеров, последовательностей и состояний.
- [docs/API.md](docs/API.md), [docs/TESTING.md](docs/TESTING.md), [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md), [docs/SECURITY.md](docs/SECURITY.md).
- [docs/TIMELOG.md](docs/TIMELOG.md) — фактический замер времени.

## Production

Приложение работает с одного origin за Nginx и Let's Encrypt. На VDS запущены `app`, `worker`, `provider-a`, `provider-b` и PostgreSQL; наружу опубликован только `app` на loopback-интерфейсе. Релизный workflow разворачивает immutable GHCR-образ по git SHA, выполняет миграции и health-check. Production-секреты хранятся только на сервере и в GitHub Actions secrets.

## Осознанные границы

Нет реального эквайринга и подписи webhook, пользовательской авторизации, отзывов, полного футера, dark mode и отдельного mobile-макета — они прямо исключены или не требуются в ТЗ. Узкий экран при этом не ломается. Redis/RabbitMQ не используются: для этого объёма PostgreSQL inbox + очередь проще, наблюдаемее и дают необходимые гарантии.

Лицензия: MIT.
