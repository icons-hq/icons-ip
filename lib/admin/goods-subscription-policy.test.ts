import { describe, expect, it } from 'vitest';
import { createGoodsSubscriptionRequestLane, goodsSubscriptionDraft, goodsSubscriptionReceiptMatches, parseGoodsSubscriptionDraft,
  parseGoodsSubscriptionPolicy, parseGoodsSubscriptionPolicyRequest, parseGoodsSubscriptionRecovery, sameGoodsSubscriptionPolicy,
  type GoodsSubscriptionPolicy, type GoodsSubscriptionPolicyRequest } from './goods-subscription-policy';

const actor = 'b1711000-0000-4000-8000-000000000004';
const base: GoodsSubscriptionPolicy = { goodId: 'subscription-policy-fixture', revision: 0, goodUpdatedAt: '2026-10-14T01:00:00.123456Z',
  enabled: false, intervals: ['month_1'], message: '' };
const request: GoodsSubscriptionPolicyRequest = { goodId: base.goodId, expectedActorId: actor, expectedRevision: 0,
  expectedGoodUpdatedAt: base.goodUpdatedAt, operationId: 'b1711000-0000-4000-8000-000000000050', enabled: true, intervals: ['month_1', 'week_1'], message: '안내' };

describe('상품 정기배송 정책 계약', () => {
  it('주기는 정규화하고 날짜의 마이크로초를 보존한다', () => {
    expect(parseGoodsSubscriptionPolicyRequest({ ...request, intervals: ['week_1', 'month_1'], message: ' 안내 ' }))
      .toEqual(request);
    expect(sameGoodsSubscriptionPolicy(base, { ...base, goodUpdatedAt: '2026-10-14T10:00:00.123456+09:00' })).toBe(true);
    expect(sameGoodsSubscriptionPolicy(base, { ...base, goodUpdatedAt: '2026-10-14T01:00:00.123457Z' })).toBe(false);
  });
  it.each([{ intervals: ['month_4'] }, { intervals: ['week_1', 'week_1'] }, { message: '가'.repeat(501) },
    { message: '줄\n바꿈' }, { expectedRevision: -1 }, { extra: 'untrusted' }, { expectedGoodUpdatedAt: '2026-02-30T00:00:00Z' }])('유효하지 않은 요청 %j는 저장할 수 없다', change => {
    expect(parseGoodsSubscriptionPolicyRequest({ ...request, ...change })).toBeNull();
  });
  it('주기를 아직 선택하지 않은 편집은 복구하되 서버 정책/저장 요청으로 만들지 않는다', () => {
    const draft = { ...goodsSubscriptionDraft(base), intervals: [] };
    expect(parseGoodsSubscriptionDraft(draft)).toEqual(draft);
    expect(parseGoodsSubscriptionRecovery({ version: 1, sessionId: actor, base, draft, retry: null })?.draft).toEqual(draft);
    expect(parseGoodsSubscriptionPolicy({ ...base, intervals: [] })).toBeNull();
    expect(parseGoodsSubscriptionPolicyRequest({ ...request, intervals: [] })).toBeNull();
  });
  it('불명확 저장의 복구는 원래 actor/revision/내용을 유지해야 한다', () => {
    const draft = { enabled: request.enabled, intervals: request.intervals, message: request.message };
    const recovery = { version: 1, sessionId: actor, base, draft, retry: request };
    expect(parseGoodsSubscriptionRecovery(recovery)?.retry).toEqual(request);
    expect(parseGoodsSubscriptionRecovery({ ...recovery, retry: { ...request, expectedRevision: 2 } })).toBeNull();
    expect(parseGoodsSubscriptionRecovery({ ...recovery, draft: { ...draft, message: '다른 내용' } })).toBeNull();
    expect(parseGoodsSubscriptionRecovery({ ...recovery, secret: 'not-allowed' })).toBeNull();
  });
  it('영수증의 작업·상품·내용·revision이 모두 일치해야 성공이다', () => {
    const receipt = { ...base, enabled: request.enabled, intervals: request.intervals, message: request.message,
      revision: 1, goodUpdatedAt: '2026-10-14T01:00:01Z', operationId: request.operationId, changed: true };
    expect(goodsSubscriptionReceiptMatches(receipt, request)).toBe(true);
    expect(goodsSubscriptionReceiptMatches({ ...receipt, revision: 2 }, request)).toBe(false);
    expect(goodsSubscriptionReceiptMatches({ ...receipt, operationId: actor }, request)).toBe(false);
    expect(goodsSubscriptionReceiptMatches({ ...receipt, message: '다른 내용' }, request)).toBe(false);
  });
  it('한 scope의 중복 요청·늦은 read·예전 finish가 새 요청을 덮지 않는다', () => {
    const lane = createGoodsSubscriptionRequestLane(); const read = lane.read()!; const save = lane.begin()!;
    expect(lane.current(read)).toBe(false); expect(lane.begin()).toBeNull(); expect(lane.read()).toBeNull();
    lane.finish(read); expect(lane.busy()).toBe(true); lane.finish(save); expect(lane.busy()).toBe(false);
    const next = lane.begin()!; lane.finish(save); expect(lane.current(next)).toBe(true); expect(lane.busy()).toBe(true);
  });
});
