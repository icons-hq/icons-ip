import { describe, expect, it } from 'vitest';
import { orderReshipmentReceipt } from '@/test/fixtures/order-reshipment';
import { parseOrderReshipmentHistory } from './reshipment-items';

describe('actual reshipment history', () => {
  it('keeps the physical shipment label and stable item identity', () => {
    expect(parseOrderReshipmentHistory([orderReshipmentReceipt])).toEqual([orderReshipmentReceipt]);
    expect(parseOrderReshipmentHistory([])).toEqual([]);
  });
  it.each([
    null,
    [orderReshipmentReceipt, orderReshipmentReceipt],
    [{ ...orderReshipmentReceipt, actorId: 'internal' }],
    [{ ...orderReshipmentReceipt, reshippedAt: 'invalid' }],
    [{ ...orderReshipmentReceipt, items: [] }],
    [{ ...orderReshipmentReceipt, items: [...orderReshipmentReceipt.items, ...orderReshipmentReceipt.items] }],
    [{ ...orderReshipmentReceipt, items: [{ ...orderReshipmentReceipt.items[0], qty: 0 }] }],
    [{ ...orderReshipmentReceipt, items: [{ ...orderReshipmentReceipt.items[0], qty: 2147483648 }] }],
    [{ ...orderReshipmentReceipt, items: [{ ...orderReshipmentReceipt.items[0], name: '' }] }],
    [{ ...orderReshipmentReceipt, items: [{ ...orderReshipmentReceipt.items[0], operationPath: [] }] }],
  ])('rejects incomplete, duplicate or private receipt data %#', value => {
    expect(parseOrderReshipmentHistory(value)).toBeNull();
  });
});
