import { describe, expect, it } from 'vitest';
import { parseGiftDetail, parseGiftOutcome, parseGiftPage, giftSelectionFromCart } from './gifts';
const id = '93942000-0000-4000-8000-000000000010', variant = '93942000-0000-4000-8000-000000000030';
const gift = { id, revision: 4, message: '선물', senderLabel: '보낸 분', expiresAt: '2026-10-21T00:00:00Z',
  items: [{ goodId: 'good', variantId: variant, name: '굿즈', variantName: '기본', qty: 1, imagePath: null, customInputs: null }],
  party: 'sender', isRecipient: false, state: 'accepted', recipientLabel: '받는 분', createdAt: '2026-10-14T00:00:00Z', acceptedAt: '2026-10-14T01:00:00Z',
  address: null, addressRevision: null, order: null, shipments: [] };
describe('gift privacy and durable mutation DTO', () => {
  it('separates the original receipt from the current gift state', () => {
    expect(parseGiftOutcome({ gift, receipt: { operationId: id, kind: 'created', revision: 1 } })).toMatchObject({ gift: { state: 'accepted', revision: 4 }, receipt: { kind: 'created', revision: 1 } });
    expect(parseGiftOutcome({ gift, receipt: { operationId: id, kind: 'created', revision: 5 } })).toBeNull();
  });
  it('rejects sender address, unexpected token hashes, and recipient payment data', () => {
    expect(parseGiftDetail({ ...gift, address: { recipientName: '수신자', phone: '01000001234', postalCode: '12345', address1: 'PRIVATE' }, addressRevision: 1 })).toBeNull();
    expect(parseGiftDetail({ ...gift, tokenHash: 'PRIVATE' })).toBeNull();
    expect(parseGiftDetail({ ...gift, party: 'recipient', isRecipient: true, state: 'ordered', order: { id, status: 'paid', createdAt: gift.createdAt, expiresAt: null, total: 1000, paymentMethod: 'card' } })).toBeNull();
  });
  it('rejects duplicate list pages and omits invented cart prices', () => {
    expect(parseGiftPage({ items: [gift, gift], hasMore: false })).toBeNull();
    expect(giftSelectionFromCart([{ goodId: 'good', variantId: variant, qty: 1 }])).toEqual([{ goodId: 'good', variantId: variant, qty: 1, inputRevision: 0, inputValues: {} }]);
  });
});
