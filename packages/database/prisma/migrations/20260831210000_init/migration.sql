-- Полная исходная миграция PostgreSQL: типы, таблицы, связи и инварианты гонок.
-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "OrderStatus" AS ENUM ('created', 'paid', 'delivering', 'delivered', 'payment_failed', 'out_of_stock', 'delivery_failed');

-- CreateEnum
CREATE TYPE "PaymentEventStatus" AS ENUM ('paid', 'failed');

-- CreateEnum
CREATE TYPE "InboxState" AS ENUM ('pending', 'processed', 'invalid');

-- CreateEnum
CREATE TYPE "JobStatus" AS ENUM ('pending', 'processing', 'retry', 'succeeded', 'failed');

-- CreateEnum
CREATE TYPE "ProviderId" AS ENUM ('A', 'B');

-- CreateEnum
CREATE TYPE "AttemptOutcome" AS ENUM ('success', 'out_of_stock', 'server_error', 'timeout', 'invalid_response');

-- CreateEnum
CREATE TYPE "PromoType" AS ENUM ('percent', 'amount');

-- CreateEnum
CREATE TYPE "ProviderFaultMode" AS ENUM ('success', 'out_of_stock', 'server_error_before_issue', 'timeout_after_issue');

-- CreateTable
CREATE TABLE "products" (
    "id" BIGSERIAL NOT NULL,
    "sku" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "price_minor" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'RUB',
    "image" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "products_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "orders" (
    "id" BIGSERIAL NOT NULL,
    "public_id" UUID NOT NULL,
    "idempotency_key" TEXT NOT NULL,
    "idempotency_payload" TEXT NOT NULL,
    "product_id" BIGINT NOT NULL,
    "sku" TEXT NOT NULL,
    "base_price_minor" INTEGER NOT NULL,
    "discount_minor" INTEGER NOT NULL DEFAULT 0,
    "final_price_minor" INTEGER NOT NULL,
    "currency" TEXT NOT NULL,
    "promo_code" TEXT,
    "status" "OrderStatus" NOT NULL DEFAULT 'created',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_events" (
    "id" BIGSERIAL NOT NULL,
    "event_id" TEXT NOT NULL,
    "order_public_id" UUID NOT NULL,
    "status" "PaymentEventStatus" NOT NULL,
    "amount_minor" INTEGER NOT NULL,
    "currency" TEXT NOT NULL,
    "occurred_at" TIMESTAMPTZ(3) NOT NULL,
    "received_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "inbox_state" "InboxState" NOT NULL DEFAULT 'pending',
    "processed_at" TIMESTAMPTZ(3),
    "reason" TEXT,
    "payload" JSONB NOT NULL,

    CONSTRAINT "payment_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "delivery_jobs" (
    "id" BIGSERIAL NOT NULL,
    "order_id" BIGINT NOT NULL,
    "status" "JobStatus" NOT NULL DEFAULT 'pending',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "run_after" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lease_until" TIMESTAMPTZ(3),
    "worker_id" TEXT,
    "last_error" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "delivery_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "provider_requests" (
    "id" BIGSERIAL NOT NULL,
    "order_id" BIGINT NOT NULL,
    "provider_id" "ProviderId" NOT NULL,
    "request_id" UUID NOT NULL,
    "last_outcome" "AttemptOutcome",
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "provider_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "provider_call_attempts" (
    "id" BIGSERIAL NOT NULL,
    "provider_request_id" BIGINT NOT NULL,
    "outcome" "AttemptOutcome" NOT NULL,
    "http_status" INTEGER,
    "duration_ms" INTEGER NOT NULL,
    "detail" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "provider_call_attempts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fulfillments" (
    "id" BIGSERIAL NOT NULL,
    "order_id" BIGINT NOT NULL,
    "provider_id" "ProviderId" NOT NULL,
    "request_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fulfillments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_status_history" (
    "id" BIGSERIAL NOT NULL,
    "order_id" BIGINT NOT NULL,
    "from" "OrderStatus",
    "to" "OrderStatus" NOT NULL,
    "reason" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "order_status_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "promocodes" (
    "id" BIGSERIAL NOT NULL,
    "code" TEXT NOT NULL,
    "type" "PromoType" NOT NULL,
    "value" INTEGER NOT NULL,
    "currency" TEXT,
    "max_uses" INTEGER NOT NULL,
    "used_count" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "promocodes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "promo_redemptions" (
    "id" BIGSERIAL NOT NULL,
    "promocode_id" BIGINT NOT NULL,
    "order_id" BIGINT NOT NULL,
    "discount_minor" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "promo_redemptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "provider_keys" (
    "id" BIGSERIAL NOT NULL,
    "provider_id" "ProviderId" NOT NULL,
    "sku" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "issued_at" TIMESTAMPTZ(3),
    "request_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "provider_keys_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "provider_settings" (
    "provider_id" "ProviderId" NOT NULL,
    "fault_mode" "ProviderFaultMode" NOT NULL DEFAULT 'success',
    "delay_ms" INTEGER NOT NULL DEFAULT 1500,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "provider_settings_pkey" PRIMARY KEY ("provider_id")
);

-- CreateIndex
CREATE UNIQUE INDEX "products_sku_key" ON "products"("sku");

-- CreateIndex
CREATE UNIQUE INDEX "orders_public_id_key" ON "orders"("public_id");

-- CreateIndex
CREATE UNIQUE INDEX "orders_idempotency_key_key" ON "orders"("idempotency_key");

-- CreateIndex
CREATE INDEX "orders_product_id_idx" ON "orders"("product_id");

-- CreateIndex
CREATE INDEX "orders_status_created_at_idx" ON "orders"("status", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "payment_events_event_id_key" ON "payment_events"("event_id");

-- CreateIndex
CREATE INDEX "payment_events_inbox_state_received_at_idx" ON "payment_events"("inbox_state", "received_at");

-- CreateIndex
CREATE INDEX "payment_events_order_public_id_occurred_at_idx" ON "payment_events"("order_public_id", "occurred_at");

-- CreateIndex
CREATE UNIQUE INDEX "delivery_jobs_order_id_key" ON "delivery_jobs"("order_id");

-- CreateIndex
CREATE INDEX "delivery_jobs_status_run_after_idx" ON "delivery_jobs"("status", "run_after");

-- CreateIndex
CREATE UNIQUE INDEX "provider_requests_request_id_key" ON "provider_requests"("request_id");

-- CreateIndex
CREATE INDEX "provider_requests_order_id_idx" ON "provider_requests"("order_id");

-- CreateIndex
CREATE UNIQUE INDEX "provider_requests_order_id_provider_id_key" ON "provider_requests"("order_id", "provider_id");

-- CreateIndex
CREATE INDEX "provider_call_attempts_provider_request_id_idx" ON "provider_call_attempts"("provider_request_id");

-- CreateIndex
CREATE UNIQUE INDEX "fulfillments_order_id_key" ON "fulfillments"("order_id");

-- CreateIndex
CREATE UNIQUE INDEX "fulfillments_code_key" ON "fulfillments"("code");

-- CreateIndex
CREATE INDEX "order_status_history_order_id_created_at_idx" ON "order_status_history"("order_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "promocodes_code_key" ON "promocodes"("code");

-- CreateIndex
CREATE UNIQUE INDEX "promo_redemptions_order_id_key" ON "promo_redemptions"("order_id");

-- CreateIndex
CREATE INDEX "promo_redemptions_promocode_id_idx" ON "promo_redemptions"("promocode_id");

-- CreateIndex
CREATE UNIQUE INDEX "provider_keys_code_key" ON "provider_keys"("code");

-- CreateIndex
CREATE UNIQUE INDEX "provider_keys_request_id_key" ON "provider_keys"("request_id");

-- CreateIndex
CREATE INDEX "provider_keys_provider_id_sku_issued_at_idx" ON "provider_keys"("provider_id", "sku", "issued_at");

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "delivery_jobs" ADD CONSTRAINT "delivery_jobs_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "provider_requests" ADD CONSTRAINT "provider_requests_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "provider_call_attempts" ADD CONSTRAINT "provider_call_attempts_provider_request_id_fkey" FOREIGN KEY ("provider_request_id") REFERENCES "provider_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fulfillments" ADD CONSTRAINT "fulfillments_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_status_history" ADD CONSTRAINT "order_status_history_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "promo_redemptions" ADD CONSTRAINT "promo_redemptions_promocode_id_fkey" FOREIGN KEY ("promocode_id") REFERENCES "promocodes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "promo_redemptions" ADD CONSTRAINT "promo_redemptions_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Доменные инварианты, которые Prisma schema выразить не может.
ALTER TABLE "products" ADD CONSTRAINT "products_price_nonnegative" CHECK ("price_minor" >= 0);
ALTER TABLE "orders" ADD CONSTRAINT "orders_money_consistent" CHECK (
  "base_price_minor" >= 0 AND "discount_minor" >= 0
  AND "discount_minor" <= "base_price_minor"
  AND "final_price_minor" = "base_price_minor" - "discount_minor"
);
ALTER TABLE "payment_events" ADD CONSTRAINT "payment_events_amount_nonnegative" CHECK ("amount_minor" >= 0);
ALTER TABLE "promocodes" ADD CONSTRAINT "promocodes_usage_bounded" CHECK (
  "max_uses" >= 0 AND "used_count" >= 0 AND "used_count" <= "max_uses"
);
ALTER TABLE "provider_keys" ADD CONSTRAINT "provider_keys_issue_pair" CHECK (
  ("issued_at" IS NULL AND "request_id" IS NULL)
  OR ("issued_at" IS NOT NULL AND "request_id" IS NOT NULL)
);

-- Частичные индексы ускоряют именно рабочие выборки очередей, не раздувая индекс завершёнными строками.
CREATE INDEX "payment_events_pending_idx" ON "payment_events" ("received_at", "id")
  WHERE "inbox_state" = 'pending';
CREATE INDEX "delivery_jobs_runnable_idx" ON "delivery_jobs" ("run_after", "id")
  WHERE "status" IN ('pending', 'retry');
