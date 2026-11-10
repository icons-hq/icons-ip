import { orderReshipmentReceipt } from '@/test/fixtures/order-reshipment';
import { expect, it } from 'vitest';
import { parseGiftClaimContext, parseGiftClaimOutcome } from './gift-claims';
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
