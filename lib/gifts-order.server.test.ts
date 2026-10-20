import { describe, expect, it, vi } from 'vitest';
import payer from '@/test/fixtures/gift-order-payer.json';
import { parseGiftCheckoutOrder } from './gifts-order.server';
vi.mock('./supabase/server', () => ({ createClient: vi.fn() }));
describe('gift payer projection', () => {
  const id = payer.order.id;
  it('reads the real isolated SQL receipt while retaining no recipient delivery fields', () => {
    const result = parseGiftCheckoutOrder(payer, id);
    expect(result?.kind).toBe('gift');
    if (result?.kind !== 'gift') throw new Error('fixture');
    expect(result.order.total).toBe(19200); expect(result.order.transaction.totals.volumeDiscountTotal).toBe(2000);
    expect(result.order.address).toBeNull(); expect(result.order.shipments[0].trackingNumber).toBeNull();
  });
  it('accepts a renamed catalog slug using immutable line/variant identity', () => {
    const value = structuredClone(payer); value.order.items[0].goodId = 'renamed-good';
    expect(parseGiftCheckoutOrder(value, id)?.kind).toBe('gift');
  });
  it.each(['address', 'phone', 'destinationPostalCode', 'recipientId'])('rejects an extra %s property', key => {
    expect(parseGiftCheckoutOrder({ ...payer, [key]: 'PRIVATE' }, id)).toBeNull();
    expect(parseGiftCheckoutOrder({ ...payer, order: { ...payer.order, [key]: 'PRIVATE' } }, id)).toBeNull();
  });
  it.each(['carrier', 'carrierLabel', 'trackingNumber', 'trackingUrl', 'regionalShipping', 'delivery', 'exportedAt'])('rejects shipment %s disclosure', key => {
    const value = structuredClone(payer); Object.assign(value.order.shipments[0], { [key]: 'PRIVATE' });
    expect(parseGiftCheckoutOrder(value, id)).toBeNull();
  });
  it('rejects amount drift, duplicate lines, a replaced variant, and another order', () => {
    const amount = structuredClone(payer); amount.order.total++; expect(parseGiftCheckoutOrder(amount, id)).toBeNull();
    const duplicate = structuredClone(payer); duplicate.order.items.push(duplicate.order.items[0]); expect(parseGiftCheckoutOrder(duplicate, id)).toBeNull();
    const variant = structuredClone(payer); variant.order.items[0].variantId = '93942000-0000-4000-8000-000000000099'; expect(parseGiftCheckoutOrder(variant, id)).toBeNull();
    expect(parseGiftCheckoutOrder(payer, '93942000-0000-4000-8000-000000000099')).toBeNull();
  });
  it('permits raw fallback only for the exact ordinary discriminator', () => {
    expect(parseGiftCheckoutOrder({ kind: 'ordinary' }, id)).toEqual({ kind: 'ordinary' });
    expect(parseGiftCheckoutOrder({ kind: 'unavailable' }, id)).toEqual({ kind: 'unavailable' });
    expect(parseGiftCheckoutOrder({ kind: 'ordinary', order: payer.order }, id)).toBeNull();
    expect(parseGiftCheckoutOrder(null, id)).toBeNull();
  });
});
