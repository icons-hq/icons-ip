import type { InquirySatisfactionRequest, InquirySatisfactionReceipt, MyInquirySatisfaction } from '@/lib/inquiry-satisfaction';
export const satisfactionIds = { inquiry: 'd5150000-0000-4000-8000-000000000001', actor: 'd5150000-0000-4000-8000-000000000002',
  session: 'd5150000-0000-4000-8000-000000000003', answer: 'd5150000-0000-4000-8000-000000000004', operation: 'd5150000-0000-4000-8000-000000000005',
  newAnswer: 'd5150000-0000-4000-8000-000000000006', newSession: 'd5150000-0000-4000-8000-000000000007' };
export const satisfactionCurrent: MyInquirySatisfaction = { inquiryId: satisfactionIds.inquiry, actorId: satisfactionIds.actor, sessionId: satisfactionIds.session,
  answerId: satisfactionIds.answer, answerCreatedAt: '2026-10-15T01:00:00Z', value: null, ratedAt: null, revision: 0, canEvaluate: true, unavailableReason: null };
export const satisfactionRequest: InquirySatisfactionRequest = { operationId: satisfactionIds.operation, inquiryId: satisfactionIds.inquiry, expectedActorId: satisfactionIds.actor,
  expectedSessionId: satisfactionIds.session, expectedAnswerId: satisfactionIds.answer, expectedRevision: 0, desiredValue: 'satisfied' };
export const satisfactionReceipt: InquirySatisfactionReceipt = { ...satisfactionRequest, beforeValue: null, afterValue: 'satisfied', beforeRevision: 0, afterRevision: 1,
  outcome: 'changed', createdAt: '2026-10-15T02:00:00Z' };
export const satisfactionCompleted = { operation: 'completed' as const, receipt: satisfactionReceipt,
  current: { ...satisfactionCurrent, revision: 1, value: 'satisfied' as const, ratedAt: satisfactionReceipt.createdAt } };
