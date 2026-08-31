// Generated surface is kept deliberately small; `pnpm openapi:generate` verifies it against OpenAPI.
export type ProductDto = {
  sku: string;
  name: string;
  type: string;
  priceMinor: number;
  price: number;
  currency: string;
  image: string;
};

export type OrderStatus =
  | 'created'
  | 'paid'
  | 'delivering'
  | 'delivered'
  | 'payment_failed'
  | 'out_of_stock'
  | 'delivery_failed';

export type OrderDto = {
  orderId: string;
  sku: string;
  productName: string;
  status: OrderStatus;
  basePriceMinor: number;
  discountMinor: number;
  finalPriceMinor: number;
  currency: string;
  promoCode: string | null;
  code: string | null;
  createdAt: string;
  updatedAt: string;
  history: Array<{ from: OrderStatus | null; to: OrderStatus; reason: string; createdAt: string }>;
};
