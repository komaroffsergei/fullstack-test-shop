import { describe, expect, it } from 'vitest';
import { calculatePrice, canTransition, fingerprintOrder } from './index.js';

describe('domain rules', () => {
  it('caps fixed discounts at the order price', () => {
    expect(calculatePrice(300, { type: 'amount', value: 500 })).toEqual({
      basePriceMinor: 300,
      discountMinor: 300,
      finalPriceMinor: 0,
    });
  });

  it('does not allow a delivered order to regress', () => {
    expect(canTransition('delivered', 'paid')).toBe(false);
  });

  it('normalizes the optional promo in an idempotency fingerprint', () => {
    expect(fingerprintOrder({ orderId: 'a', sku: 'b', promoCode: ' welcome10 ' })).toBe(
      '{"orderId":"a","sku":"b","promoCode":"WELCOME10"}',
    );
  });
});
