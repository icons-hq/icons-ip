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

/* QNA-019: 나눠 보낸 상자의 추가 운송장은 상자를 받는 수령인 화면에만 온다. 보내는 분 화면에 오면 응답 전체를 버린다. */
describe('선물 수령인 화면의 추가 운송장', () => {
  const shipment = { id: '93942000-0000-4000-8000-000000000050', status: 'shipping', shippedAt: '2026-10-15T00:00:00Z', deliveredAt: null, expectedShipDate: null,
    carrier: 'hanjin', trackingNumber: '123456789012' };
  const received = { ...gift, party: 'recipient', isRecipient: true, state: 'ordered',
    order: { id: '93942000-0000-4000-8000-000000000040', status: 'shipping', createdAt: gift.createdAt, expiresAt: null, total: null, paymentMethod: null } };
  const extras = [{ carrier: 'hanjin', trackingNumber: '223456789012' }, { carrier: 'hanjin', trackingNumber: '323456789012' }];
  it('수령인은 대표 운송장과 함께 추가 운송장을 받는다(없는 배송 건은 종전 모양 그대로)', () => {
    expect(parseGiftDetail({ ...received, shipments: [{ ...shipment, extraTrackings: extras }] })?.shipments[0].extraTrackings).toEqual(extras);
    const plain = parseGiftDetail({ ...received, shipments: [shipment] });
    expect(plain?.shipments[0]).toEqual(shipment);
    expect(plain?.shipments[0]).not.toHaveProperty('extraTrackings');
  });
  it('보내는 분 화면에 추가 운송장이 오거나 모양이 틀리면 버린다', () => {
    const sent = { ...received, party: 'sender', isRecipient: false, order: { ...received.order, total: 1000, paymentMethod: 'card' } };
    expect(parseGiftDetail({ ...sent, shipments: [{ ...shipment, carrier: null, trackingNumber: null }] })).not.toBeNull();
    expect(parseGiftDetail({ ...sent, shipments: [{ ...shipment, carrier: null, trackingNumber: null, extraTrackings: extras }] })).toBeNull();
    for (const bad of [[], [{ carrier: 'hanjin' }], [{ ...extras[0], phone: '01000001234' }], [{ carrier: 'hanjin', trackingNumber: '' }],
      Array.from({ length: 20 }, (_, index) => ({ carrier: 'hanjin', trackingNumber: `9${index}`.padEnd(12, '0') }))]) {
      expect(parseGiftDetail({ ...received, shipments: [{ ...shipment, extraTrackings: bad }] })).toBeNull();
    }
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
