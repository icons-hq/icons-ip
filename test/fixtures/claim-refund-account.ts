import type { ClaimRefundAccountContext, ClaimRefundAccountIdentity, ClaimRefundAccountReceipt, ClaimRefundAccountRequest } from '@/lib/orders/claim-refund-account';
export const refundAccountIdentity: ClaimRefundAccountIdentity = {
  actorId: '9c140000-0000-4000-8000-000000000101', sessionId: '9c140000-0000-4000-8000-000000000102',
  orderId: '9c140000-0000-4000-8000-000000000103', claimId: '9c140000-0000-4000-8000-000000000104',
};
export const refundAccountContext: ClaimRefundAccountContext = { actorId: refundAccountIdentity.actorId, orderId: refundAccountIdentity.orderId,
  claimId: refundAccountIdentity.claimId, claimType: 'cancel', stage: 'processing', revision: 1,
  allowed: true, blocker: null, maskedAccount: null, maskedHolder: null, recordedAt: null };
export const refundAccountRequest: ClaimRefundAccountRequest = { ...refundAccountIdentity, version: 1, operationId: '9c140000-0000-4000-8000-000000000105', revision: 1,
  account: { bankName: '합성은행', accountNumber: '000000001234', accountHolder: '합성구매자' } };
export const refundAccountReceipt: ClaimRefundAccountReceipt = { operationId: refundAccountRequest.operationId, actorId: refundAccountIdentity.actorId,
  orderId: refundAccountIdentity.orderId, claimId: refundAccountIdentity.claimId, revision: 1, resultRevision: 2, state: 'saved', createdAt: '2026-10-14T05:00:00.000Z' };
