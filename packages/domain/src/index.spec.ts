import { describe, expect, it } from 'vitest';
import { calculatePrice, canTransition, fingerprintOrder, ORDER_STATUSES } from './index.js';

describe('domain rules', () => {
  /** Проверяет, что фиксированная скидка никогда не превращает цену в отрицательную. */
  it('caps fixed discounts at the order price', () => {
    expect(calculatePrice(300, { type: 'amount', value: 500 })).toEqual({
      basePriceMinor: 300,
      discountMinor: 300,
      finalPriceMinor: 0,
    });
  });

  /** Проверяет процентную скидку в целых копейках с предсказуемым округлением вниз. */
  it('calculates percent discounts without floating point money', () => {
    expect(calculatePrice(12_345, { type: 'percent', value: 17 })).toEqual({
      basePriceMinor: 12_345,
      discountMinor: 2_098,
      finalPriceMinor: 10_247,
    });
  });

  /** Отбрасывает отрицательную или дробную исходную цену до любого бизнес-расчёта. */
  it('rejects invalid minor-unit prices', () => {
    expect(() => calculatePrice(-1)).toThrow(/non-negative integer/);
    expect(() => calculatePrice(10.5)).toThrow(/non-negative integer/);
    expect(() => calculatePrice(Number.MAX_SAFE_INTEGER + 1)).toThrow(/non-negative integer/);
  });

  /** Фиксирует терминальность delivered: уже выданный заказ не регрессирует. */
  it('does not allow a delivered order to regress', () => {
    expect(canTransition('delivered', 'paid')).toBe(false);
  });

  /** Фиксирует все разрешённые ветви восстановления, а не только happy path. */
  it('allows the documented recovery transitions', () => {
    expect(canTransition('created', 'payment_failed')).toBe(true);
    expect(canTransition('payment_failed', 'paid')).toBe(true);
    expect(canTransition('out_of_stock', 'delivering')).toBe(true);
    expect(canTransition('delivery_failed', 'delivering')).toBe(true);
  });

  /** Убеждается, что каждый известный статус допускает идемпотентный self-transition. */
  it('treats repeated status writes as idempotent', () => {
    for (const status of ORDER_STATUSES) expect(canTransition(status, status)).toBe(true);
  });

  /** Доказывает, что косметические различия промокода не меняют intent. */
  it('normalizes the optional promo in an idempotency fingerprint', () => {
    expect(fingerprintOrder({ orderId: 'a', sku: 'b', promoCode: ' welcome10 ' })).toBe(
      '{"orderId":"a","sku":"b","promoCode":"WELCOME10"}',
    );
  });

  /** Различает purchase intents с разными SKU и отсутствие промокода от конкретного кода. */
  it('keeps business-significant fingerprint fields distinct', () => {
    const base = fingerprintOrder({ orderId: 'a', sku: 'STEAM-TOPUP-500' });
    expect(base).not.toBe(fingerprintOrder({ orderId: 'a', sku: 'STEAM-TOPUP-1000' }));
    expect(base).not.toBe(
      fingerprintOrder({ orderId: 'a', sku: 'STEAM-TOPUP-500', promoCode: 'WELCOME10' }),
    );
  });
});
