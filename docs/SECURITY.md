# Security

- `.env*` исключены из Git, кроме безопасного `.env.example`.
- Admin API сравнивает `X-Admin-Token` только на сервере; UI не сохраняет токен.
- DTO проходят allowlist validation, неизвестные поля публичного API отклоняются.
- Цена, скидка и валюта берутся с сервера; webhook сверяется со snapshot заказа.
- Helmet включён; приложение работает same-origin без production CORS.
- DB user в production не публикуется наружу; app bind — loopback.
- Логи не выводят headers, token или выданный code. Correlation IDs — order/event/provider request.
- CI запускает gitleaks.

Упрощения задания: подпись webhook и пользовательская auth намеренно отсутствуют. Для реального продукта обязательны HMAC/mTLS webhook, rate limiting, secret rotation, audit retention и шифрование чувствительных кодов.

О проблемах безопасности: приватное сообщение владельцу репозитория; не публиковать рабочие токены в issue.

## Границы доверия

| Источник        | Доверяем                                     | Не доверяем                                               |
| --------------- | -------------------------------------------- | --------------------------------------------------------- |
| Browser         | выбору SKU и public UUID формата             | цене, скидке, валюте, admin token                         |
| Payment sender  | форме валидированного события                | уникальности доставки, порядку, amount/currency до сверки |
| Provider HTTP   | success только при совпавшем request ID/code | timeout как доказательству отказа                         |
| Admin browser   | token только в памяти формы                  | URL/query/localStorage как месту хранения секрета         |
| CI              | committed source и ephemeral secrets         | файлам `.env`, произвольному `latest` image               |
| Public Internet | обычным REST запросам                        | доступу к DB/providers/SSH                                |

## Секреты

- Локальный `.env` ignored и не входит в `git archive`.
- Разрешён только `.env.example` с демонстрационными значениями.
- Production `.env.production` находится в `/opt/fullstack-test-shop`, mode `600`.
- GitHub хранит SSH key/host как Actions secrets.
- Logs не сериализуют headers/body provider success, поэтому token и code не попадают в stdout.
- Offline handbook открывает только text source allowlist и исключает `.env`, dependencies, lockfile, binary assets; verifier сравнивает manifest/hash.
- gitleaks проверяет всю Git history, а не только HEAD.

## HTTP и валидация

- Helmet включает стандартные security headers; CSP отключена только из-за embedded Swagger UI и должна быть настроена отдельно в реальном продукте.
- Production same-origin устраняет необходимость широкого CORS.
- ValidationPipe: `whitelist + forbidNonWhitelisted + transform`.
- UUID route params проверяются до Prisma.
- Размер массива admin keys ограничен 500, строки — 200 символами.
- Idempotency-Key обязателен и ограничен 200 символами.
- API создаёт/возвращает correlation ID, но не принимает его как authorization.

## Данные и бизнес-безопасность

- Цены хранятся в integer minor units и защищены CHECK.
- Client не может прислать money fields в CreateOrder.
- Webhook mismatch не запускает delivery, но сохраняется для аудита.
- Codes глобально UNIQUE; один fulfillment на order.
- Timeout не включает B автоматически.
- Reset блокирует рабочие таблицы и отказывается при processing job.
- Admin UI не сохраняет token в local/session storage; refresh очищает его.

## Что обязательно добавить перед реальными деньгами

1. HMAC/mTLS + replay window для payment webhook.
2. Rate limiting/WAF для order, webhook, quote и admin.
3. Настоящую user auth/session/authorization и CSRF policy.
4. Hash/rotation/revocation admin credentials вместо одного static token.
5. Encryption/controlled reveal для digital codes и masking в support UI.
6. Audit actor/IP для admin commands и immutable retention.
7. Provider credentials в secret manager, egress allowlist и certificate validation policy.
8. Reconciliation jobs для payment/provider settlement.
9. Backup/restore drills, PITR и отдельные least-privilege DB roles.
10. Dependency/SBOM/image signing/vulnerability gates.
11. Настроенный CSP без `unsafe-inline`, SRI где применимо.
12. Privacy/retention policy и удаление пользовательских данных.

## Проверки

- anonymous admin `401` входит в local и production acceptance;
- money tamper `400` входит в обе приемки;
- malformed UUID `400` входит в local acceptance;
- gitleaks — отдельный CI job;
- Docker публикует app только на `127.0.0.1`, DB/providers имеют только internal network;
- production black-box report специально не сохраняет token или выданные codes.
