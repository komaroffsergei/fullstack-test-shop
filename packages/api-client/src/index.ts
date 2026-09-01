// Контракт frontend намеренно мал; `pnpm openapi:generate` сверяет наличие маршрутов с OpenAPI.
/** Публичное представление товара, которое Angular получает из серверного каталога. */
export type ProductDto = {
  sku: string;
  name: string;
  type: string;
  priceMinor: number;
  price: number;
  currency: string;
  image: string;
};

/** Все статусы, которые frontend обязан уметь отобразить пользователю. */
export type OrderStatus =
  | 'created'
  | 'paid'
  | 'delivering'
  | 'delivered'
  | 'payment_failed'
  | 'out_of_stock'
  | 'delivery_failed';

/** Полный read model заказа: цена-снимок, выдача и аудируемая история переходов. */
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
