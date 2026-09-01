# ADR-001: PostgreSQL как durable inbox и очередь

- Статус: принято.
- Дата: 2026-08-31.
- Область: payment events, delivery jobs, worker coordination.

## Контекст

Задание проверяет не максимальную пропускную способность брокера, а отсутствие потерь/дублей при 50 параллельных webhook, раннем событии, сбое worker и ручном восстановлении. Order, payment event, job, status history и fulfillment уже находятся в PostgreSQL. Если добавить RabbitMQ/Redis, появляется граница dual write: нужно доказать согласованность коммита БД и публикации сообщения.

## Решение

Использовать две таблицы PostgreSQL:

- `payment_events` — durable inbox внешних at-least-once событий;
- `delivery_jobs` — очередь выдачи, одна строка на order.

Worker забирает работу через row locks и `SKIP LOCKED`. Внешний HTTP поставщика выполняется после завершения claim transaction. Для job используется lease: `processing` с истёкшим `lease_until` снова доступен другому worker.

## Детальная семантика

1. API делает INSERT payment event и только после commit отвечает `200`.
2. `event_id UNIQUE` схлопывает повторную доставку.
3. Worker выбирает только pending event, для которого существует order; раннее событие остаётся pending.
4. Event row и order row блокируются, поэтому события одного заказа применяются последовательно.
5. `delivery_jobs.order_id UNIQUE` не даёт создать вторую job.
6. Claim — один `UPDATE … WHERE id=(SELECT … FOR UPDATE SKIP LOCKED) RETURNING`.
7. После claim transaction закрыта; HTTP не удерживает locks.
8. Success/failure/retry фиксируются отдельной короткой записью.

## Почему не RabbitMQ/Redis

Они полезны при независимом масштабировании, огромном потоке, сложной маршрутизации или отдельной команде платформы. Здесь они:

- не устраняют необходимость в idempotency таблицах;
- требуют outbox/consumer acknowledgements и ещё одного набора recovery-процедур;
- усложняют локальный запуск и проверку работодателем;
- не усиливают ключевую гарантию относительно PostgreSQL UNIQUE/transaction.

## Последствия

Плюсы:

- один источник истины и один transaction manager;
- раннее событие, job и order диагностируются обычным SQL;
- CI воспроизводит реальную конкурентную семантику одной PostgreSQL service;
- меньше эксплуатационных компонентов.

Ограничения:

- polling создаёт небольшую постоянную нагрузку;
- очень большая очередь потребует partitioning/archive/tuning;
- длительность lease и retry policy должны соответствовать timeout внешнего API;
- таблицы нужно очищать/архивировать по retention policy в реальном продукте.

## Доказательство

`tests/race/run.ts` запускает 50 identical, 50 unique, early event, timeout, provider failure и recovery. DB assertions требуют одну job/fulfillment/key. CI использует настоящий PostgreSQL 17.

## Как для 10 лет

Вместо отдельного почтового отделения мы кладём письма и рабочие карточки в один защищённый шкаф. Работник запирает только одну карточку, быстро пишет на ней своё имя и закрывает шкаф. Потом долго звонит на склад уже без ключа от шкафа, поэтому остальные могут продолжать работу.
