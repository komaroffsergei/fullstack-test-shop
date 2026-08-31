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
