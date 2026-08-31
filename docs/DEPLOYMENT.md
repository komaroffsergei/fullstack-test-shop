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

`.github/workflows/deploy.yml` вручную собирает образ, публикует `ghcr.io/...:<git SHA>`, подключается как `shopdeploy`, делает `prisma migrate deploy`, health-check и rollback к предыдущему image при ошибке.

Production secrets находятся только в `/opt/fullstack-test-shop/.env.production` и GitHub Actions secrets. Никаких panel/SSH/admin credentials в Git и workflow нет.

Официальные инструкции провайдера: [поддомен](https://vdsina.ru/qa/q/kak-sdelat-poddomen), [SSL](https://vdsina.ru/qa/q/ssl-sertifikaty-kak-vypustit).
