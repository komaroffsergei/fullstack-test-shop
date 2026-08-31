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

export function canTransition(from: OrderStatus, to: OrderStatus): boolean {
  return from === to || transitions[from].includes(to);
}

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

export function calculatePrice(basePriceMinor: number, promo?: Promo): PriceBreakdown {
  if (!Number.isSafeInteger(basePriceMinor) || basePriceMinor < 0) {
    throw new Error('Base price must be a non-negative integer in minor units');
  }

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
