import type { ClaimHoldContext, ClaimHoldReceipt, ClaimHoldRequest } from './claim-hold';
export const holdContext: ClaimHoldContext = {
  actorId: 'bd000001-0000-4000-8000-000000000001',
  claimId: 'bd000002-0000-4000-8000-000000000001',
  orderId: 'bd000003-0000-4000-8000-000000000001',
  claimType: 'return', stage: 'collecting', revision: 2, heldFrom: null, holdReason: null, canHold: true, canResume: false,
};
export const holdRequest: ClaimHoldRequest = {
  id: 'bd000004-0000-4000-8000-000000000001', actorId: holdContext.actorId,
  claimId: holdContext.claimId, claimType: 'return', revision: 2, decision: 'hold',
  note: '합성 고객 문의의 확인을 기다리는 중입니다', confirmed: true,
};
export const holdReceipt: ClaimHoldReceipt = {
  id: holdRequest.id, actorId: holdContext.actorId, claimId: holdContext.claimId, orderId: holdContext.orderId,
  claimType: 'return', revision: 2, decision: 'hold', note: holdRequest.note,
  fromStage: 'collecting', stage: 'on_hold', resultRevision: 3, createdAt: '2026-10-13T12:00:00Z',
};
