import { expect, it } from 'vitest';
import { isCsReplyRevision, parseCsReplyOperation, parseCsReplyReceipt } from './cs-reply-mutations';
import { parseReviewReplyDraft } from './cs-editor-drafts';
const operation = { operationId: '44444444-4444-4444-8444-444444444444', accountId: '33333333-3333-4333-8333-333333333333', id: '11111111-1111-4111-8111-111111111111', surface: 'review' as const, body: '작성 중 문구', expectedRevision: '9007199254740993' };
it('JS 안전정수를 넘는 bigint revision도 문자열로 손실 없이 보존한다', () => {
  expect(parseCsReplyOperation(operation)).toEqual(operation);
  expect(isCsReplyRevision('9223372036854775807')).toBe(true);
  for (const value of ['01','-1','1.5','9223372036854775808',9007199254740992]) expect(isCsReplyRevision(value)).toBe(false);
  expect(parseCsReplyReceipt({ ...operation, revision: '9007199254740994', changed: true, savedAt: '2026-10-14T00:00:00Z' }, operation)?.revision).toBe('9007199254740994');
  expect(parseCsReplyReceipt({ ...operation, revision: '9007199254740993', changed: true, savedAt: '2026-10-14T00:00:00Z' }, operation)).toBeNull();
});
it('미확정 요청은 초안의 문구·버전·표면과 일치할 때만 복구한다', () => {
  const draft = { body: operation.body, sourceVersion: `reply:${operation.expectedRevision}`, pending: operation };
  expect(parseReviewReplyDraft(draft)).toEqual(draft);
  expect(parseReviewReplyDraft({ ...draft, body: '다른 문구' })).toBeNull();
  expect(parseReviewReplyDraft({ ...draft, sourceVersion: 'reply:1' })).toBeNull();
  expect(parseReviewReplyDraft({ ...draft, pending: { ...operation, surface: 'product_question' } })).toBeNull();
  expect(parseReviewReplyDraft({ body: '이전 형식 초안', sourceVersion: '[null,null,"visible"]' })).not.toBeNull();
});
