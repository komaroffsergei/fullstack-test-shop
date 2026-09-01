import { describe, expect, it } from 'vitest';
import { calculatePrice, canTransition, fingerprintOrder } from './index.js';

describe('domain rules', () => {
  /** Проверяет, что фиксированная скидка никогда не превращает цену в отрицательную. */
  it('caps fixed discounts at the order price', () => {
    expect(calculatePrice(300, { type: 'amount', value: 500 })).toEqual({
      basePriceMinor: 300,
      discountMinor: 300,
      finalPriceMinor: 0,
    });
  });

  /** Фиксирует терминальность delivered: уже выданный заказ не регрессирует. */
  it('does not allow a delivered order to regress', () => {
    expect(canTransition('delivered', 'paid')).toBe(false);
  });

  /** Доказывает, что косметические различия промокода не меняют intent. */
  it('normalizes the optional promo in an idempotency fingerprint', () => {
    expect(fingerprintOrder({ orderId: 'a', sku: 'b', promoCode: ' welcome10 ' })).toBe(
      '{"orderId":"a","sku":"b","promoCode":"WELCOME10"}',
    );
  });
});
