# ADR-003: Неоднозначный timeout и безопасный fallback поставщика

- Статус: принято.
- Дата: 2026-08-31.
- Область: Provider A/B, `POST /issue`, retry/recovery.

## Контекст

HTTP timeout сообщает только «клиент не получил ответ вовремя». Он ничего не говорит о том, успел ли поставщик выполнить side effect. Самая опасная последовательность:

1. Provider A закрепил code за request.
2. Ответ потерялся или пришёл после client timeout.
3. Worker считает A неуспешным и вызывает Provider B.
4. B выдаёт второй code тому же order.

Такой дубль нельзя исправить UNIQUE fulfillment: второй provider key уже физически потрачен, даже если в локальную fulfillment table попадёт один.

## Решение

Для каждой пары `(order, provider)` создаётся один стабильный UUID `request_id`. Все transport retry конкретного provider используют его повторно. Заглушка поставщика сохраняет mapping `request_id → code` атомарно до отправки HTTP-ответа.

Политика worker:

- `success` A — завершить order;
- `timeout` A — повторить A с тем же request ID; B не вызывать;
- explicit `out_of_stock` A — безопасно вызвать B;
- детерминированный `server_error_before_issue` A — side effect по контракту не начат, можно вызвать B;
- аналогичный timeout B — повторять B, а не возвращаться к A;
- исчерпание/две однозначные ошибки — recoverable status, не потеря order.

## Семантика mock-provider

1. Быстрый replay сначала ищет existing request mapping и возвращает прежний code независимо от текущего fault mode.
2. Для нового request режимы `server_error_before_issue` и `out_of_stock` выполняются до reserve.
3. В success/timeout режиме транзакция выбирает свободный key через `FOR UPDATE SKIP LOCKED`.
4. `request_id` и `issued_at` записываются одной операцией.
5. Только после commit `timeout_after_issue` задерживает ответ дольше client timeout.
6. Второй вызов видит existing mapping и немедленно возвращает тот же code.

## Почему fallback не делается после любого exception

Transport error, connection reset, malformed response и timeout могут произойти после side effect. Универсальное «catch → B» оптимистично, но нарушает exactly-once. Переключение требует contract-level доказательства, что A ничего не выдал.

В реальной интеграции таким доказательством может быть:

- документированный idempotency contract;
- status lookup по request ID;
- signed response `not_issued`;
- reconciliation API.

Если поставщик не предоставляет ни одного механизма, безопаснее оставить order в ручном recovery, чем автоматически потратить второй товар.

## Последствия

- ProviderRequest rows и attempt journal увеличивают объём БД, но дают трассировку.
- Recovery обязан переиспользовать request IDs; генерация новых UUID запрещена.
- Provider timeout должен быть меньше job lease или lease должен продлеваться.
- Нельзя удалять provider mapping раньше конца business retention.

## Доказательство

Race mode `timeout_after_issue` требует одновременно:

- attempt A с outcome `timeout`;
- следующий attempt A `success`;
- одну ProviderRequest A;
- ноль ProviderRequest B;
- один spent ProviderKey;
- один fulfillment и один code.

Отдельные сценарии проверяют explicit A out-of-stock → B и два 5xx → `delivery_failed` → recovery с неизменными request IDs.

## Как для 10 лет

Ты попросил первого друга положить подарок у двери, но связь оборвалась. Нельзя сразу просить второго друга принести ещё один подарок: первый мог уже всё сделать. Сначала повтори первому тот же номер просьбы. Он посмотрит запись и либо вернёт тот же подарок, либо точно скажет, что ничего не делал.
