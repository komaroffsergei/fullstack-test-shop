// Чистый доменный слой: здесь нет HTTP, Prisma и Angular — только правила бизнеса,
// которые одинаково понимают API, worker и тесты.
export const ORDER_STATUSES = [
  'created',
  'paid',
  'delivering',
  'delivered',
  'payment_failed',
  'out_of_stock',
  'delivery_failed',
] as const;

export type OrderStatus = (typeof ORDER_STATUSES)[number];

const transitions: Readonly<Record<OrderStatus, readonly OrderStatus[]>> = {
  created: ['paid', 'payment_failed'],
  payment_failed: ['paid'],
  paid: ['delivering'],
  delivering: ['delivered', 'out_of_stock', 'delivery_failed'],
  out_of_stock: ['delivering'],
  delivery_failed: ['delivering'],
  delivered: [],
};

/** Проверяет, разрешён ли переход заказа между двумя состояниями конечного автомата. */
export function canTransition(from: OrderStatus, to: OrderStatus): boolean {
  return from === to || transitions[from].includes(to);
}

/** Прерывает выполнение, если вызывающий код пытается сделать запрещённый переход статуса. */
export function assertTransition(from: OrderStatus, to: OrderStatus): void {
  if (!canTransition(from, to)) {
    throw new Error(`Invalid order transition: ${from} -> ${to}`);
  }
}

export type Promo = {
  type: 'percent' | 'amount';
  value: number;
};

export type PriceBreakdown = {
  basePriceMinor: number;
  discountMinor: number;
  finalPriceMinor: number;
};

/**
 * Считает цену только в целых минимальных денежных единицах (копейках).
 * Это исключает ошибки двоичной арифметики с числами вроде 0.1 + 0.2.
 */
export function calculatePrice(basePriceMinor: number, promo?: Promo): PriceBreakdown {
  if (!Number.isSafeInteger(basePriceMinor) || basePriceMinor < 0) {
    throw new Error('Base price must be a non-negative integer in minor units');
  }

  // Сначала получаем «сырую» скидку, затем обязательно ограничиваем её диапазоном 0..цена.
  const rawDiscount = promo
    ? promo.type === 'percent'
      ? Math.floor((basePriceMinor * promo.value) / 100)
      : promo.value
    : 0;
  const discountMinor = Math.max(0, Math.min(basePriceMinor, rawDiscount));

  return {
    basePriceMinor,
    discountMinor,
    finalPriceMinor: basePriceMinor - discountMinor,
  };
}

/**
 * Строит стабильный отпечаток purchase intent для проверки повторного Idempotency-Key.
 * Нормализация промокода делает эквивалентными `welcome10` и ` WELCOME10 `.
 */
export function fingerprintOrder(input: {
  orderId: string;
  sku: string;
  promoCode?: string;
}): string {
  return JSON.stringify({
    orderId: input.orderId,
    sku: input.sku,
    promoCode: input.promoCode?.trim().toUpperCase() ?? null,
  });
}
