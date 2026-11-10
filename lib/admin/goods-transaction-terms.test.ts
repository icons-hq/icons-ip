import { describe, expect, it } from 'vitest';
import { goodsTermsDraft, goodsTermsReceiptMatches, parseGoodsTermsRecovery, parseGoodsTermsRequest, prepareGoodsTermsInput, sameGoodsTerms, type GoodsTermsRequest } from './goods-transaction-terms';
import type { GoodsTransactionAdminTerms } from '@/lib/goods-transaction';

const actor = '91000000-0000-4000-8000-000000000001', operation = '91000000-0000-4000-8000-000000000002', policyId = '91000000-0000-4000-8000-000000000003';
const base: GoodsTransactionAdminTerms = { goodId: 'term-good', revision: 0, goodUpdatedAt: '2026-10-14T01:00:00.123456Z', volume: null, delivery: null };
const raw = (): GoodsTermsRequest => ({ goodId: base.goodId, expectedActorId: actor, expectedRevision: 0, expectedGoodUpdatedAt: base.goodUpdatedAt,
  operationId: operation, volume: { status: 'draft', terms: null, draftValues: { threshold: '미정' } }, delivery: null });
describe('할인·배송 편집 계약', () => {
  it('상품 ID는 문자열이며 명시 null은 다른 정책을 보존한다', () => { expect(parseGoodsTermsRequest(raw())).toEqual(raw()); expect(parseGoodsTermsRequest({ ...raw(), volume: null })).toBeNull(); });
  it.each([{ goodId: ' 상품 ' }, { expectedActorId: 'other' }, { operationId: 'bad' }, { expectedRevision: -1 }, { expectedGoodUpdatedAt: '2026-02-30T00:00:00Z' }, { unexpected: true }])('잘못된 요청을 거절한다: %j', patch => { expect(parseGoodsTermsRequest({ ...raw(), ...patch })).toBeNull(); });
  it('초안은 불완전한 숫자·시간을 보존하지만 활성화는 허용하지 않는다', () => {
    const draft = goodsTermsDraft(base); draft.volume.fields = { condition: 'quantity', threshold: '', discountKind: 'fixed', discountValue: '0', startsAt: '2026-02-30T12:00', endsAt: '' };
    expect(prepareGoodsTermsInput('volume', draft)).toMatchObject({ ok: true, value: { terms: null, draftValues: draft.volume.fields } });
    draft.volume.status = 'active'; expect(prepareGoodsTermsInput('volume', draft).ok).toBe(false);
  });
  it('활성화는 실제 달력과 두 시간 경계를 검사하며 한국 시간과 마이크로초를 보존한다', () => {
    const draft = goodsTermsDraft(base); draft.volume.status = 'active'; Object.assign(draft.volume.fields, { threshold: '2', discountValue: '10', discountKind: 'percent', startsAt: '2028-02-29T10:00:00.123456', endsAt: '2028-03-01T10:00' });
    expect(prepareGoodsTermsInput('volume', draft)).toMatchObject({ ok: true, value: { terms: { startsAt: '2028-02-29T10:00:00.123456+09:00', endsAt: '2028-03-01T10:00:00+09:00' } } });
    draft.volume.fields.startsAt = '2027-02-29T10:00'; expect(prepareGoodsTermsInput('volume', draft).ok).toBe(false);
  });
  it.each(['01', '1.5', '1e3', '-1', '9007199254740992'])('활성 수량의 모호한 숫자 %s를 거절한다', threshold => {
    const draft = goodsTermsDraft(base); draft.volume.status = 'active'; Object.assign(draft.volume.fields, { threshold, discountValue: '10' }); expect(prepareGoodsTermsInput('volume', draft).ok).toBe(false);
  });
  it('수량 반복·2/3구간 경계를 검사하고 잘못된 구간은 초안으로만 남긴다', () => {
    const draft = goodsTermsDraft(base); draft.delivery.status = 'active'; Object.assign(draft.delivery.fields, { kind: 'repeat', baseFee: '2500', interval: '3' });
    expect(prepareGoodsTermsInput('delivery', draft)).toMatchObject({ ok: true, value: { quantityTerms: { kind: 'repeat', baseFee: 2500, interval: 3 } } });
    Object.assign(draft.delivery.fields, { kind: 'tier3', firstLimit: '3', secondLimit: '3', extra1: '2000', extra2: '1000' });
    expect(prepareGoodsTermsInput('delivery', draft).ok).toBe(false); draft.delivery.status = 'draft';
    expect(prepareGoodsTermsInput('delivery', draft)).toMatchObject({ ok: true, value: { quantityTerms: null, draftValues: { secondLimit: '3', extra2: '1000' } } });
  });
  it('기본 배송비 사용은 null 수량 정책이며 착불과 독립이다', () => {
    const draft = goodsTermsDraft(base); draft.delivery.status = 'active'; draft.delivery.fields.paymentMode = 'collect';
    expect(prepareGoodsTermsInput('delivery', draft)).toMatchObject({ ok: true, value: { paymentMode: 'collect', quantityTerms: null } });
  });
  it('활성 정책의 화면은 임시 문자열보다 실제 금액·시간을 우선한다', () => {
    const draft = goodsTermsDraft({ ...base, revision: 1, volume: { id: policyId, goodId: base.goodId, revision: 1, status: 'active',
      terms: { condition: 'quantity', threshold: 3, discountKind: 'percent', discountValue: 15, startsAt: '2026-10-14T01:00:00.123456Z', endsAt: '2026-10-15T01:00:00Z' }, draftValues: { threshold: '99', discountValue: '100', startsAt: '' } },
      delivery: { id: operation, goodId: base.goodId, revision: 1, status: 'active', paymentMode: 'prepaid', quantityTerms: null, draftValues: { paymentMode: 'collect', kind: 'tier3' } } });
    expect(draft.volume.fields).toMatchObject({ threshold: '3', discountValue: '15', startsAt: '2026-10-14T10:00:00.123456' });
    expect(draft.delivery.fields).toMatchObject({ paymentMode: 'prepaid', kind: 'existing' });
  });
  it('영수증은 키 순서·같은 시각의 offset에 무관하며 1마이크로초 차이는 거절한다', () => {
    expect(sameGoodsTerms({ a: 1, time: '2026-10-14T10:00:00.123456+09:00' }, { time: '2026-10-14T01:00:00.123456+00:00', a: 1 })).toBe(true);
    expect(sameGoodsTerms(base.goodUpdatedAt, '2026-10-14T01:00:00.123457Z')).toBe(false);
    const request = raw(), receipt = { ...base, revision: 1, changed: true, operationId: operation, volume: { ...request.volume!, id: policyId, goodId: base.goodId, revision: 1 } };
    expect(goodsTermsReceiptMatches(receipt, request)).toBe(true);
    expect(goodsTermsReceiptMatches({ ...receipt, revision: 2 }, request)).toBe(false);
    expect(goodsTermsReceiptMatches({ ...receipt, operationId: actor }, request)).toBe(false);
    expect(goodsTermsReceiptMatches({ ...receipt, volume: { ...receipt.volume, draftValues: { threshold: '9' } } }, request)).toBe(false);
  });
  it('로컬 복원은 동일 상품·기준 revision과 원래 요청을 결속한다', () => {
    const recovery = { version: 1, sessionId: actor, base, draft: goodsTermsDraft(base), retry: raw() };
    expect(parseGoodsTermsRecovery(recovery)).toEqual(recovery);
    expect(parseGoodsTermsRecovery({ ...recovery, retry: { ...raw(), goodId: 'other' } })).toBeNull();
    expect(parseGoodsTermsRecovery({ ...recovery, retry: { ...raw(), expectedRevision: 1 } })).toBeNull();
    expect(parseGoodsTermsRecovery({ ...recovery, sessionId: 'token' })).toBeNull();
  });
});
