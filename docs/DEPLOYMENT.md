# Deployment

Production: Ubuntu VDS, каталог `/opt/fullstack-test-shop`, отдельный пользователь `shopdeploy`. Наружу публикуется только `127.0.0.1:4400`; PostgreSQL и providers доступны лишь в Compose network.

## Первый запуск

1. Создать DNS A `test-shop` → `62.113.112.185`.
2. Скопировать `compose.production.yaml`, создать `.env.production` по `deploy/env.production.example` и установить mode `600`.
3. Выполнить migration и seed один раз.
4. Добавить отдельный Nginx server block, не изменяя существующие сайты.
5. Проверить HTTP, затем выпустить Certbot certificate и включить redirect.

Пример Nginx:

```nginx
server {
  server_name test-shop.komaroff-dev.ru;
  location / {
    proxy_pass http://127.0.0.1:4400;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
  }
}
```

## Release workflow

`.github/workflows/deploy.yml` вручную собирает образ, публикует `ghcr.io/...:<git SHA>`, подключается как `shopdeploy`, делает `prisma migrate deploy`, health-check, 9 production black-box сценариев, 3 внешних Playwright-теста и финальный reset. Ошибка deploy или server-side black-box запускает rollback к предыдущему image.

Production secrets находятся только в `/opt/fullstack-test-shop/.env.production` и GitHub Actions secrets. Никаких panel/SSH/admin credentials в Git и workflow нет.

## Фактическая production-проверка

- DNS A-запись разрешается в `62.113.112.185`.
- Nginx публикует только `https://test-shop.komaroff-dev.ru`; upstream слушает `127.0.0.1:4400`.
- Сертификат Let's Encrypt установлен с автоматическим renew.
- После deployment проверяются `/api/health/ready`, главная, Angular SPA fallback, каталог, OpenAPI, metrics и публичный комплект `/docs`.
- Admin API возвращает `401` без `X-Admin-Token` и `200` с серверным токеном.
- Внешний Playwright smoke-test проходит полный путь покупки до статуса `delivered`.

Официальные инструкции провайдера: [поддомен](https://vdsina.ru/qa/q/kak-sdelat-poddomen), [SSL](https://vdsina.ru/qa/q/ssl-sertifikaty-kak-vypustit).

## Контейнеры production

| Service      | Назначение                       | Публичный port          |
| ------------ | -------------------------------- | ----------------------- |
| `app`        | NestJS API + static Angular/docs | только `127.0.0.1:4400` |
| `worker`     | payment inbox + delivery queue   | нет                     |
| `provider-a` | internal `/issue` A              | нет                     |
| `provider-b` | internal `/issue` B              | нет                     |
| `postgres`   | durable data/locks               | нет                     |

Все четыре Node service используют один immutable image, но разные command/env. Это исключает расхождение версий API/worker/provider при deploy.

## Порядок ручного workflow

1. Checkout точного Git commit.
2. Login GHCR ephemeral `GITHUB_TOKEN`.
3. Build/push `ghcr.io/...:<github.sha>`.
4. SSH только как `shopdeploy`.
5. Сохранить ID прежнего app image.
6. Pull нового image для всего Compose.
7. Одноразовый container выполняет `prisma migrate deploy`.
8. Одноразовый container выполняет идемпотентный seed справочников.
9. `docker compose up -d` переключает app/worker/providers.
10. До 60 секунд опрашивается loopback readiness.
11. Одноразовый app-контейнер получает admin token только через server-only env и атакует публичный HTTPS девятью black-box сценариями.
12. GitHub runner проходит три Playwright-сценария по публичному домену.
13. Второй одноразовый app-контейнер делает reset и требует `recovery=0`, `ready=ok`.
14. При ошибке до конца server-side проверки старый ID получает локальный tag `rollback`, после чего стек возвращается на него.

Migration выполняется до health switch и должна быть backward-compatible с предыдущим image, иначе автоматический rollback приложения не откатит схему. Для destructive migrations нужен отдельный expand/migrate/contract процесс.

## Проверка после deploy

```bash
curl -fsS https://test-shop.komaroff-dev.ru/api/health/live
curl -fsS https://test-shop.komaroff-dev.ru/api/health/ready
curl -fsS https://test-shop.komaroff-dev.ru/api/v1/catalog/products
curl -fsS https://test-shop.komaroff-dev.ru/api/openapi.json
curl -fsS https://test-shop.komaroff-dev.ru/api/metrics
curl -fsS https://test-shop.komaroff-dev.ru/docs/tutorial/
curl -fsS https://test-shop.komaroff-dev.ru/docs/offline/
curl -fsS https://test-shop.komaroff-dev.ru/docs/README.md
curl -fsS https://test-shop.komaroff-dev.ru/docs/CODEMAP.md
```

Workflow выполняет `pnpm test:production`, production Playwright и финальный reset автоматически. Команды из [TESTING.md](TESTING.md) остаются способом независимого повторного прогона. Простой health-check не доказывает выдачу или конкурентные инварианты.

## Диагностика без раскрытия секретов

На сервере:

```bash
cd /opt/fullstack-test-shop
docker compose --env-file .env.production -f compose.production.yaml ps
docker compose --env-file .env.production -f compose.production.yaml logs --since=15m app worker provider-a provider-b
```

Искать следует correlation fields `requestId`, `orderId`, `eventId`, `providerRequestId`, а не печатать env/header/code. Readiness подтверждает соединение API→PostgreSQL; provider health можно проверять только из Compose network.

## Backup и rollback

- До изменения Nginx первоначальный config копируется в отдельный timestamped backup.
- Compose/data volume не удаляются deploy workflow.
- App rollback меняет image, но не стирает order/payment/fulfillment.
- PostgreSQL в реальном продукте требует ежедневный logical/physical backup и PITR; тестовый проект не притворяется, что локальный volume является backup.
- `docker compose down -v` запрещён в production runbook, потому что уничтожает БД.

## TLS и сеть

- DNS A указывает только на VDS.
- Nginx принимает 80/443; HTTP перенаправляется на HTTPS.
- Certbot renew обслуживает сертификат Let's Encrypt.
- Upstream использует loopback, поэтому app port не доступен извне даже при firewall misconfiguration.
- PostgreSQL/providers не имеют `ports` в production Compose.
- Реальный deployment должен также ограничить SSH firewall и отключить password login для `shopdeploy`.

## Обновление документации

`docs/`, `README.md` и `CODEMAP.md` входят в immutable runtime image. NestJS раздаёт tutorial, автономный source handbook и Markdown-файлы с префиксом `/docs`; Angular-витрина содержит ссылку на этот комплект. Race, production black-box и Playwright требуют точные заголовки каждого материала, поэтому устаревшая или отсутствующая копия блокирует CI/deploy. Production acceptance-модули по-прежнему запускаются одноразовым контейнером рядом с server-only token, не вынося секрет с VDS.
