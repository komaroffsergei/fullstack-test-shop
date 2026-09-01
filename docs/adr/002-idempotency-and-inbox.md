# ADR-002: Слои идемпотентности и durable payment inbox

- Статус: принято.
- Дата: 2026-08-31.
- Область: browser purchase intent, order API, payment delivery, fulfillment.

## Контекст

«Exactly once delivery» нельзя получить одним флагом. Browser может сделать double click; HTTP-клиент может повторить POST после потери ответа; платёжная система доставляет один `event_id` несколько раз и события не по порядку; несколько разных paid events могут относиться к одному order; worker может упасть после внешнего side effect.

## Решение: несколько независимых барьеров

| Граница               | Идентификатор                             | Барьер                                                     |
| --------------------- | ----------------------------------------- | ---------------------------------------------------------- |
| Purchase intent       | `Idempotency-Key` + canonical fingerprint | `orders.idempotency_key UNIQUE`                            |
| Public order          | client UUID                               | `orders.public_id UNIQUE`                                  |
| Payment delivery      | `event_id`                                | `payment_events.event_id UNIQUE`                           |
| Delivery scheduling   | internal order ID                         | `delivery_jobs.order_id UNIQUE`                            |
| Provider operation    | stable `request_id` per order/provider    | unique request mapping                                     |
| Final business result | order/code                                | `fulfillments.order_id UNIQUE`, `fulfillments.code UNIQUE` |

Ни один слой не заменяет другой. Например, 50 разных event IDs обойдут дедупликацию inbox, но упрётся в единственную job и fulfillment.

## Purchase intent

Angular создаёт один UUID order и один Idempotency-Key до запроса и сохраняет их при transport retry. API строит canonical fingerprint из `orderId`, `sku` и нормализованного promo code.

- тот же key + тот же fingerprint: `200` и исходный order;
- новый key: `201` и новый order;
- тот же key + другой fingerprint: `409`;
- тот же public UUID + другой key: `409`.

При двух одновременных INSERT победителя выбирает UNIQUE. Проигравшая транзакция читает победителя и применяет то же правило fingerprint.

## Durable webhook

`payment_events` не имеет обязательного FK к `orders.public_id`. Это осознанно нарушает привычную ссылочную связь, чтобы внешний webhook можно было сохранить раньше order. Worker делает JOIN и не забирает такую строку, пока order не появится.

API подтверждает событие только после INSERT/UNIQUE resolution. Повтор event ID получает `200 duplicate=true` и не меняет старый payload. Несовпавшие amount/currency не удаляются: они получают `inbox_state=invalid` и reason для расследования.

## Порядок событий

- valid paid переводит `created/payment_failed` в `paid`;
- failed меняет только `created`;
- failed после paid/delivering/delivered — no-op для order;
- delivered не регрессирует;
- все события при этом остаются аудируемыми inbox rows.

## Рассмотренные альтернативы

- Дедупликация только в памяти — теряется при restart и не работает с несколькими процессами.
- «Сначала проверить, потом INSERT» без UNIQUE — классическая race condition.
- FK event→order — приводит к потере/5xx раннего события и зависимости от порядка внешней доставки.
- Считать один `event_id` достаточным — не защищает от 50 разных paid events одного order.

## Последствия и доказательство

Цена решения — дополнительные идентификаторы и таблицы аудита. Польза — каждый повтор имеет определённый no-op результат, а причина видна в БД/history.

Race suite проверяет concurrent create, changed replay `409`, 50 identical, 50 unique, early event, failed→paid→failed, invalid money и повтор delivered retry.

## Как для 10 лет

У каждой покупки несколько номерков: номер просьбы покупателя, номер письма от банка, номер задания кладовщику и номер выдачи. На каждой двери сторож проверяет свой номер. Если один сторож пропустил повтор, следующий всё равно не разрешит положить второй подарок.
