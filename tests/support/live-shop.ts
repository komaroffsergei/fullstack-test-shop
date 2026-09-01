import { randomUUID } from 'node:crypto';

export type HttpResult<T> = {
  status: number;
  body: T;
  headers: Headers;
};

export type PurchaseIntent = {
  orderId: string;
  idempotencyKey: string;
};

export type OrderView = {
  orderId: string;
  sku: string;
  productName: string;
  status: string;
  basePriceMinor: number;
  discountMinor: number;
  finalPriceMinor: number;
  currency: string;
  promoCode: string | null;
  code: string | null;
  history: Array<{ from: string | null; to: string; reason: string; createdAt: string }>;
};

/** Прерывает приемочный сценарий с понятным сообщением, если проверяемое условие ложно. */
export function assertCondition(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

/** Создаёт уникальную пару публичного orderId и HTTP-ключа идемпотентности. */
export function newIntent(): PurchaseIntent {
  return { orderId: randomUUID(), idempotencyKey: randomUUID() };
}

/**
 * Минимальный клиент живого магазина, одинаково работающий с localhost и production HTTPS.
 * Он намеренно общается только по публичным HTTP-контрактам и не подменяет приложение моками.
 */
export class LiveShopClient {
  /** Нормализует origin и сохраняет admin token только в памяти текущего тестового процесса. */
  constructor(
    readonly baseUrl: string,
    private readonly adminToken: string,
  ) {
    this.baseUrl = baseUrl.replace(/\/$/, '');
  }

  /** Выполняет HTTP-запрос и безопасно разбирает JSON даже для ответов об ошибке. */
  async json<T>(path: string, init?: RequestInit): Promise<HttpResult<T>> {
    const response = await fetch(`${this.baseUrl}${path}`, init);
    const text = await response.text();
    let body: T;
    try {
      body = (text ? JSON.parse(text) : undefined) as T;
    } catch {
      throw new Error(`${path} returned non-JSON HTTP ${response.status}: ${text.slice(0, 200)}`);
    }
    return { status: response.status, body, headers: response.headers };
  }

  /** Возвращает сырой текст для Prometheus и других не-JSON endpoints. */
  async text(path: string, init?: RequestInit): Promise<HttpResult<string>> {
    const response = await fetch(`${this.baseUrl}${path}`, init);
    return { status: response.status, body: await response.text(), headers: response.headers };
  }

  /** Создаёт заказ с серверной ценой, позволяя явно переиспользовать purchase intent. */
  createOrder(options?: {
    promoCode?: string;
    intent?: PurchaseIntent;
    sku?: string;
    extraBody?: Record<string, unknown>;
  }): Promise<HttpResult<OrderView>> {
    const intent = options?.intent ?? newIntent();
    return this.json<OrderView>('/api/v1/orders', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'Idempotency-Key': intent.idempotencyKey,
      },
      body: JSON.stringify({
        orderId: intent.orderId,
        sku: options?.sku ?? 'STEAM-TOPUP-500',
        ...(options?.promoCode ? { promoCode: options.promoCode } : {}),
        ...options?.extraBody,
      }),
    });
  }

  /** Читает актуальный read model заказа с историей и выданным кодом. */
  order(orderId: string): Promise<HttpResult<OrderView>> {
    return this.json<OrderView>(`/api/v1/orders/${orderId}`);
  }

  /** Отправляет событие по точному webhook-контракту исходного задания. */
  webhook(options: {
    orderId: string;
    eventId?: string;
    status?: 'paid' | 'failed';
    amount?: number;
    currency?: string;
    createdAt?: string;
  }): Promise<HttpResult<{ accepted: boolean; duplicate: boolean }>> {
    return this.json('/api/v1/webhooks/payment', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        event_id: options.eventId ?? `evt_${randomUUID()}`,
        order_id: options.orderId,
        status: options.status ?? 'paid',
        amount: options.amount ?? 500,
        currency: options.currency ?? 'RUB',
        created_at: options.createdAt ?? new Date().toISOString(),
      }),
    });
  }

  /** Вызывает учебный платёжный симулятор, который сам доставляет настоящий webhook по HTTP. */
  simulate(
    orderId: string,
    status: 'paid' | 'failed',
  ): Promise<HttpResult<{ accepted: boolean; eventId: string }>> {
    return this.json('/api/v1/payments/simulate', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ orderId, status }),
    });
  }

  /** Выполняет защищённый POST административного API, не выводя токен в лог. */
  adminPost<T>(path: string, body: unknown = {}): Promise<HttpResult<T>> {
    return this.json<T>(path, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'X-Admin-Token': this.adminToken },
      body: JSON.stringify(body),
    });
  }

  /** Выполняет защищённый GET административного API. */
  adminGet<T>(path: string): Promise<HttpResult<T>> {
    return this.json<T>(path, { headers: { 'X-Admin-Token': this.adminToken } });
  }

  /** Возвращает демо-БД и оба поставщика к воспроизводимому исходному состоянию. */
  async reset(): Promise<void> {
    const result = await this.adminPost<{ reset: boolean }>('/api/v1/admin/demo/reset');
    assertCondition(
      result.status === 201 && result.body.reset,
      `Demo reset failed: ${result.status}`,
    );
  }

  /** Ждёт один из ожидаемых статусов с deadline, чтобы зависание превратилось в явный тестовый сбой. */
  async waitForStatus(
    orderId: string,
    expected: string | readonly string[],
    timeoutMs = 20_000,
  ): Promise<OrderView> {
    const statuses = Array.isArray(expected) ? expected : [expected];
    const deadline = Date.now() + timeoutMs;
    let latest = 'unknown';
    while (Date.now() < deadline) {
      const result = await this.order(orderId);
      latest = result.body.status;
      if (result.status === 200 && statuses.includes(latest)) return result.body;
      // Небольшая задержка позволяет worker'у работать, не превращая polling в busy loop.
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw new Error(`Order ${orderId} stayed ${latest}; expected ${statuses.join(' or ')}`);
  }
}
