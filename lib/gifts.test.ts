import { describe, expect, it } from 'vitest';
import { parseGiftDetail, parseGiftOutcome, parseGiftPage, giftError, giftSelectionFromCart, maskRandomGiftItems } from './gifts';
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

/* m27 CUST-1: 선물은 랜덤 판매 굿즈를 받지 않는다(ADR-0027). */
describe('랜덤 판매 굿즈와 선물', () => {
  it('DB의 랜덤 판매 거절을 확정 문구로 옮긴다(접미 굿즈 id가 붙어도 같다)', () => {
    expect(giftError({ code: '23514', message: 'gift_random_option_unsupported' })).toEqual({ error: '랜덤 판매 굿즈는 선물할 수 없어요.' });
    expect(giftError({ code: 'P0001', message: 'gift_random_option_unsupported: random-good' })).toEqual({ error: '랜덤 판매 굿즈는 선물할 수 없어요.' });
  });
  it('선물을 만든 뒤 랜덤 판매로 바뀐 굿즈 품목은 옵션명을 랜덤으로 가린다', () => {
    const detail = parseGiftDetail({ ...gift, items: [...gift.items, { ...gift.items[0], goodId: 'random-good', variantName: '포토카드 A' }] })!;
    const masked = maskRandomGiftItems(detail, new Set(['random-good']));
    expect(masked.items.map(item => item.variantName)).toEqual(['기본', '랜덤']);
    expect(JSON.stringify(masked)).not.toContain('포토카드 A');
    /* 랜덤 굿즈가 없으면 같은 값을 그대로 돌려준다. */
    expect(maskRandomGiftItems(detail, new Set())).toBe(detail);
  });
});
