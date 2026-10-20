import type { ClaimReasonContext, ClaimReasonReceipt, ClaimReasonRequest } from './claim-reason-change';
export const reasonContext: ClaimReasonContext = {
  actorId: 'ce000001-0000-4000-8000-000000000001', claimId: 'ce000002-0000-4000-8000-000000000001', orderId: 'ce000003-0000-4000-8000-000000000001',
  claimType: 'exchange', stage: 'collecting', revision: 2, reasonType: 'change_of_mind', reason: '최초 교환 신청 설명',
  originalReasonType: 'change_of_mind', originalReason: '최초 교환 신청 설명', requestedAt: '2026-10-04T03:00:00Z', deliveredAt: '2026-10-01T03:00:00Z',
  allowed: true, blocker: null, canUseChangeOfMind: true, canUseDefect: true, fee: null, history: [],
};
export const reasonRequest: ClaimReasonRequest = {
  id: 'ce000004-0000-4000-8000-000000000001', actorId: reasonContext.actorId, claimId: reasonContext.claimId, revision: reasonContext.revision,
  reasonType: 'defect', reason: '실제 확인한 상품 하자 설명', agreement: '상담번호 QA-001 고객과 실제 하자를 확인함', confirmed: true, feeReviewed: false,
};
export const reasonReceipt: ClaimReasonReceipt = {
  id: reasonRequest.id, actorId: reasonContext.actorId, claimId: reasonContext.claimId, orderId: reasonContext.orderId,
  revision: reasonContext.revision, resultRevision: reasonContext.revision + 1, fromReasonType: reasonContext.reasonType, fromReason: reasonContext.reason,
  toReasonType: reasonRequest.reasonType, toReason: reasonRequest.reason, agreement: reasonRequest.agreement,
  feeReviewed: false, changed: true, stage: reasonContext.stage, requestedAt: reasonContext.requestedAt, createdAt: '2026-10-14T00:00:00Z',
};
