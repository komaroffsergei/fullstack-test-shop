# ADR-001: PostgreSQL как inbox и очередь

Статус: принято.

Для задания важнее атомарность с order/fulfillment, чем независимое масштабирование брокера. Поэтому webhook inbox и delivery jobs находятся в PostgreSQL, claim использует `FOR UPDATE SKIP LOCKED`, а lease возвращает зависшие jobs. Redis/RabbitMQ дали бы ещё одну точку согласования без пользы для данного объёма.
