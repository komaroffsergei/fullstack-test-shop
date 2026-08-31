# ADR-002: Идемпотентность и durable inbox

Статус: принято.

Order intent определяется `Idempotency-Key` + canonical payload fingerprint. Webhook сначала вставляется с UNIQUE `event_id` и только после durable commit получает 200. Ссылка события на публичный UUID намеренно не FK: это позволяет сохранить webhook, пришедший раньше заказа.
