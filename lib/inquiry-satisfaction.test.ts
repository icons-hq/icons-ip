import { describe, expect, it } from 'vitest';
import { inquirySatisfactionPercent, parseInquirySatisfactionOperation, parseInquirySatisfactionReceipt, parseInquirySatisfactionRequest, parseMyInquirySatisfaction } from './inquiry-satisfaction';
import { satisfactionCompleted as completed, satisfactionCurrent as current, satisfactionIds as ids, satisfactionReceipt as receipt, satisfactionRequest as request } from '@/test/fixtures/inquiry-satisfaction';

describe('inquiry satisfaction boundary', () => {
  it('requires an explicit desired value; missing, undefined, empty and extra payloads never withdraw', () => {
    const missing = Object.fromEntries(Object.entries(request).filter(([key]) => key !== 'desiredValue'));
    for (const invalid of [missing, { ...request, desiredValue: undefined }, { ...request, desiredValue: '' }, { ...request, body: 'copied conversation' }])
      expect(parseInquirySatisfactionRequest(invalid)).toBeNull();
    expect(parseInquirySatisfactionRequest({ ...request, desiredValue: null })?.desiredValue).toBeNull();
  });
  it('normalizes UUID casing without changing the frozen request fields', () => {
    expect(parseInquirySatisfactionRequest({ ...request, inquiryId: ids.inquiry.toUpperCase() })).toEqual(request);
  });
  it('accepts a readonly legacy answer at virtual revision zero and an inactive owner', () => {
    expect(parseMyInquirySatisfaction(current)).toEqual(current);
    expect(parseMyInquirySatisfaction({ ...current, canEvaluate: false, unavailableReason: 'account_unavailable' })).not.toBeNull();
  });
  it('rejects impossible current targets and timestamps rather than manufacturing unrated data', () => {
    for (const invalid of [null, { ...current, value: 'satisfied' }, { ...current, answerId: null }, { ...current, canEvaluate: false },
      { ...current, ratedAt: '2026-02-31T01:00:00Z' }, { ...current, revision: -1 }]) expect(parseMyInquirySatisfaction(invalid)).toBeNull();
    expect(parseMyInquirySatisfaction({ ...current, answerId: null, answerCreatedAt: null, canEvaluate: false, unavailableReason: 'no_answer' })).not.toBeNull();
  });
  it('keeps an old successful receipt separate from a newly registered unanswered staff reply', () => {
    const afterReply = { ...completed, current: { ...current, answerId: ids.newAnswer, revision: 2 } };
    expect(parseInquirySatisfactionOperation(afterReply, request)).toEqual(afterReply);
    expect(parseInquirySatisfactionOperation(afterReply, request)?.current.value).toBeNull();
  });
  it('binds receipt recovery to every frozen input, owner and session', () => {
    for (const changed of [{ expectedAnswerId: ids.newAnswer }, { expectedRevision: 1 }, { desiredValue: null }, { expectedSessionId: ids.newSession }])
      expect(parseInquirySatisfactionOperation(completed, { ...request, ...changed })).toBeNull();
    expect(parseInquirySatisfactionOperation({ ...completed, current: { ...completed.current, sessionId: ids.newSession } }, request)).toBeNull();
  });
  it('checks changed/unchanged revision arithmetic including withdrawal', () => {
    expect(parseInquirySatisfactionReceipt({ ...receipt, afterRevision: 2 })).toBeNull();
    expect(parseInquirySatisfactionReceipt({ ...receipt, outcome: 'unchanged' })).toBeNull();
    expect(parseInquirySatisfactionReceipt({ ...receipt, beforeValue: 'satisfied', beforeRevision: 1, expectedRevision: 1,
      afterRevision: 2, desiredValue: null, afterValue: null })).not.toBeNull();
    expect(parseInquirySatisfactionReceipt({ ...receipt, beforeValue: 'satisfied', beforeRevision: 1, expectedRevision: 1,
      afterRevision: 1, outcome: 'unchanged' })).not.toBeNull();
  });
  it('does not confuse unresolved recovery with a completed response', () => {
    expect(parseInquirySatisfactionOperation({ operation: 'unresolved', receipt: null, current }, request)?.operation).toBe('unresolved');
    expect(parseInquirySatisfactionOperation({ operation: 'completed', receipt: null, current }, request)).toBeNull();
  });
  it('uses only evaluation responses in the denominator, with no-response distinct from zero percent', () => {
    expect(inquirySatisfactionPercent({ satisfied: 3, dissatisfied: 1, unrated: 6 })).toBe(75);
    expect(inquirySatisfactionPercent({ satisfied: 0, dissatisfied: 0, unrated: 10 })).toBeNull();
    expect(inquirySatisfactionPercent({ satisfied: 0, dissatisfied: 2, unrated: 8 })).toBe(0);
  });
});
