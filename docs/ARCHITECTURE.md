# Архитектура

## Контейнеры

```mermaid
flowchart LR
  B[Browser / Angular] -->|same origin REST| A[Nest API]
  A --> P[(PostgreSQL)]
  W[Worker] -->|claim inbox/jobs| P
  W -->|POST /issue stable request_id| PA[Provider A]
  W -->|safe fallback| PB[Provider B]
  PA --> P
  PB --> P
  A -. serves static build .-> B
```

PostgreSQL — единственная координирующая система. Это убирает distributed transaction между БД и отдельным брокером и достаточно для объёма тестового проекта.

## Оплата и выдача

```mermaid
sequenceDiagram
  participant UI
  participant API
  participant DB
  participant Worker
  participant A as Provider A
  participant B as Provider B
  UI->>API: POST /orders + Idempotency-Key
  API->>DB: transaction: promo lock + order
  API-->>UI: 201 или replay 200
  UI->>API: simulate paid
  API->>API: реальный HTTP webhook
  API->>DB: INSERT event ON UNIQUE event_id
  API-->>UI: 200 быстро
  Worker->>DB: lock inbox, update order, UPSERT job
  Worker->>DB: claim job SKIP LOCKED
  Worker->>A: /issue stable request_id
  alt success
    A-->>Worker: same code for every retry
  else unambiguous out-of-stock/5xx-before-issue
    Worker->>B: /issue stable B request_id
    B-->>Worker: code/error
  else timeout
    Worker->>DB: retry same provider/request_id
  end
  Worker->>DB: short transaction: UNIQUE fulfillment + delivered
```

## State machine

```mermaid
stateDiagram-v2
  [*] --> created
  created --> payment_failed: failed
  created --> paid: valid paid
  payment_failed --> paid: late valid paid wins
  paid --> delivering
  delivering --> delivered
  delivering --> out_of_stock
  delivering --> delivery_failed
  out_of_stock --> delivering: admin retry
  delivery_failed --> delivering: admin retry
  delivered --> delivered: all repeats are no-op
```

`delivered` никогда не регрессирует. Валидный `paid` имеет приоритет над ранее пришедшим `failed`; сумма и валюта сверяются с серверным снимком заказа.

## Блокировки

- Транзакции короткие; HTTP поставщика выполняется после commit claim.
- Inbox и job используют одинаковый порядок: сначала event/job, затем order.
- Promo row блокируется до проверки `used_count` и создания redemption.
- FK-поля и частые фильтры индексированы; есть partial indexes для pending inbox и runnable jobs.
