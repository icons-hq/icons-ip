import { orderReshipmentReceipt } from '@/test/fixtures/order-reshipment';
import { expect, it } from 'vitest';
import { giftClaimContextView, parseGiftClaimContext, parseGiftClaimOutcome } from './gift-claims';
const giftId = '93942000-0000-4000-8000-000000000010', claimId = '93942000-0000-4000-8000-000000000011', operationId = '93942000-0000-4000-8000-000000000012';
const context = () => ({ giftId, isSender: false, isRecipient: true, canRequest: false, claim: { id: claimId, type: 'return', stage: 'requested', revision: 0, requestedAt: '2026-10-14T00:00:00Z', isRequester: true, canWithdraw: true, refundAccountNeeded: false, maskedRefundAccount: null, reshipCarrier: null, reshipTrackingNumber: null } });
it('accepts the recipient claim projection and its durable operation receipt', () => { expect(parseGiftClaimOutcome({ receipt: { operationId, kind: 'requested', claimId }, context: context() })).not.toBeNull(); });
it.each([{ maskedRefundAccount: '은행 ***0123' }, { refundAccountNeeded: true }, { orderTotal: 10000 }, { address: 'private' }, { canWithdraw: true, isRequester: false }])('rejects a leaked or inconsistent recipient projection %j', patch => { const v = context(); expect(parseGiftClaimContext({ ...v, claim: { ...v.claim, ...patch } })).toBeNull(); });
it('payer context rejects recipient tracking and accepts only its own masked account', () => { const v = { ...context(), isSender: true, isRecipient: false }; expect(parseGiftClaimContext({ ...v, claim: { ...v.claim, reshipTrackingNumber: 'TEST-private' } })).toBeNull(); expect(parseGiftClaimContext({ ...v, claim: { ...v.claim, maskedRefundAccount: 'TEST ***0123' } })).not.toBeNull(); });
it('an immutable old receipt is separate from the current later claim state', () => { const v = context(); v.claim.stage = 'withdrawn'; v.claim.revision = 2; v.claim.canWithdraw = false; expect(parseGiftClaimOutcome({ receipt: { operationId, kind: 'requested', claimId }, context: v })).not.toBeNull(); });

it('recipient sees actual exchanged items while a payer-only projection cannot contain them', () => {
  expect(parseGiftClaimContext({ ...context(), reshipmentHistory: [orderReshipmentReceipt] })?.reshipmentHistory).toEqual([orderReshipmentReceipt]);
  expect(parseGiftClaimContext({ ...context(), isSender: true, isRecipient: false, reshipmentHistory: [orderReshipmentReceipt] })).toBeNull();
  expect(parseGiftClaimContext({ ...context(), isSender: true, isRecipient: false, reshipmentHistory: [] })).not.toBeNull();
});

/* 배송 건 재출고(TKT-166·ADR-0041): 선물 받은 분은 교환 소포마다 운송장을 받고, 보낸 분 문맥에는 실리지 않는다.
   이 키를 모르는 옛 파서와 호환되도록 DB는 배송 건 재출고 기록이 있을 때만 싣는다 — 키가 없는 문맥도 그대로 받는다. */
it('recipient receives per-origin exchange parcels with carrier labels; payer projection rejects them', () => {
  const parcel = { claimId, reshipmentId: '93942000-0000-4000-8000-000000000013', carrier: 'hanjin', trackingNumber: 'RECIPIENT001',
    reshippedAt: '2026-11-10T00:00:00Z', deliveredAt: null, collectionWaived: true, items: [{ orderItemId: '93942000-0000-4000-8000-000000000014', name: '합성 굿즈', variantName: '파랑', qty: 1 }] };
  const recipient = parseGiftClaimContext({ ...context(), reshipmentParcels: [parcel] });
  expect(recipient?.reshipmentParcels).toEqual([parcel]);
  expect(parseGiftClaimContext({ ...context(), isSender: true, isRecipient: false, reshipmentParcels: [parcel] })).toBeNull();
  expect(parseGiftClaimContext({ ...context(), reshipmentParcels: [{ ...parcel, trackingNumber: 'bad' }] })).toBeNull();
  const view = giftClaimContextView(recipient!, [{ code: 'hanjin', label: '한진택배', active: true, trackingUrlTemplate: 'https://synthetic.test/{trackingNumber}' }]);
  expect(view.reshipmentParcels).toMatchObject([{ trackingNumber: 'RECIPIENT001', carrierLabel: '한진택배', trackingUrl: 'https://synthetic.test/RECIPIENT001' }]);
  const old = parseGiftClaimContext(context());
  expect(old && Object.hasOwn(giftClaimContextView(old, []), 'reshipmentParcels')).toBe(false);
});
