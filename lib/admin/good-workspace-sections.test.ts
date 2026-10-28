import { describe, expect, it } from 'vitest';
import { emptyGoodsKcModel, goodsKcProductNotApplicableModel } from './goods-kc';
import type { GoodsOptionRow } from './goods-option-editor';
import {
  EMPTY_GOOD_WORKSPACE_SECTIONS, goodWorkspaceKcVariants, goodWorkspaceSectionFailure, goodWorkspaceVariantId,
  parseGoodWorkspaceSections, prepareGoodWorkspaceSections, type GoodWorkspaceSectionsDraft,
} from './good-workspace-sections';

const SAVED = '11111111-1111-4111-8111-111111111111';
const rows: GoodsOptionRow[] = [
  { id: SAVED, name: '빨강', code: 'GOOD-01', attributes: { 색상: '빨강' }, extraPrice: 0, stockQty: 3, expectedStockQty: 3 },
  { name: '파랑', code: '', attributes: { 색상: '파랑' }, extraPrice: 0, stockQty: 0 },
];
const preorder = { key: 'p1', optionKey: 'new:[["색상","파랑"]]', state: 'draft' as const, capacityQty: '5', startsAt: '2026-11-01T10:00',
  endsAt: '2026-11-10T18:00', expectedShipDate: '2026-11-20', approvalReference: '승인 문서 A-1' };

describe('등록 화면 원자 저장 섹션', () => {
  it('입력이 없으면 KC는 빼고 예약 조건도 비워 기존 저장과 같은 결과를 낸다', () => {
    expect(prepareGoodWorkspaceSections(EMPTY_GOOD_WORKSPACE_SECTIONS, rows, false)).toEqual({ ok: true, value: { kc: null, preorders: [] } });
    expect(parseGoodWorkspaceSections('', false)).toEqual({ ok: true, sections: {} });
  });

  it('새 옵션은 고정된 화면 id를 받고, 저장된 옵션은 id 그대로 쓴다', () => {
    expect(goodWorkspaceVariantId(rows[0])).toBe(SAVED);
    const fresh = goodWorkspaceVariantId(rows[1]);
    expect(fresh).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-8[0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(goodWorkspaceVariantId({ attributes: { 색상: '파랑' } })).toBe(fresh);
    expect(goodWorkspaceVariantId({ attributes: { 색상: '초록' } })).not.toBe(fresh);
    expect(goodWorkspaceKcVariants(rows).map((variant) => variant.code)).toEqual(['GOOD-01', '저장 시 생성']);
  });

  it('KC 해당 없음 검토 완료는 확인 체크로 reviewed가 되고, 옵션은 저장된 id·새 옵션값 조합 참조로 바뀐다', () => {
    const model = goodsKcProductNotApplicableModel(goodWorkspaceKcVariants(rows), '고객 안내');
    const draft: GoodWorkspaceSectionsDraft = { kc: { models: [model], attested: true }, preorders: [preorder] };
    const prepared = prepareGoodWorkspaceSections(draft, rows, false);
    if (!prepared.ok) throw new Error(prepared.error);
    expect(prepared.value.kc).toMatchObject({ status: 'reviewed', attested: true });
    expect(prepared.value.kc?.models[0]).not.toHaveProperty('variantIds');
    expect(prepared.value.kc?.models[0].variantRefs).toEqual(expect.arrayContaining([{ id: SAVED }, { attributes: { 색상: '파랑' } }]));
    expect(prepared.value.preorders).toEqual([{ variant: { attributes: { 색상: '파랑' } }, values: expect.objectContaining({ state: 'draft', capacityQty: '5' }) }]);

    const parsed = parseGoodWorkspaceSections(JSON.stringify(prepared.value), false);
    if (!parsed.ok) throw new Error(parsed.error);
    expect(parsed.sections.kc).toMatchObject({ status: 'reviewed', attested: true, expectedRevision: null, expectedContextFingerprint: null });
    expect(parsed.sections.preorders?.[0]).toEqual({ variant: { attributes: { 색상: '파랑' } }, policyId: null, expectedRevision: null,
      values: { state: 'draft', capacityQty: 5, startsAt: '2026-11-01T01:00:00.000Z', endsAt: '2026-11-10T09:00:00.000Z', expectedShipDate: '2026-11-20', approvalReference: '승인 문서 A-1' } });
  });

  it('확인 체크 없는 KC 입력은 미검토로 보내고, 체크했는데 연결이 빠지면 저장하지 않는다', () => {
    const partial = { ...emptyGoodsKcModel(), family: 'other' as const, scheme: 'not_applicable' as const, variantIds: [SAVED] };
    const unreviewed = prepareGoodWorkspaceSections({ kc: { models: [partial], attested: false }, preorders: [] }, rows, false);
    expect(unreviewed).toMatchObject({ ok: true, value: { kc: { status: 'unreviewed', attested: false } } });
    const missing = prepareGoodWorkspaceSections({ kc: { models: [partial], attested: true }, preorders: [] }, rows, false);
    expect(missing).toMatchObject({ ok: false, field: 'workspaceKc', error: expect.stringContaining('파랑') });
  });

  it('예약 활성화는 관리자만, 한 옵션에 하나, 활성화 조건을 모두 갖춰야 한다', () => {
    const active = { ...preorder, state: 'active' as const };
    expect(prepareGoodWorkspaceSections({ ...EMPTY_GOOD_WORKSPACE_SECTIONS, preorders: [active] }, rows, false))
      .toMatchObject({ ok: false, field: 'workspacePreorders', error: expect.stringContaining('관리자') });
    expect(prepareGoodWorkspaceSections({ ...EMPTY_GOOD_WORKSPACE_SECTIONS, preorders: [preorder, { ...preorder, key: 'p2' }] }, rows, true))
      .toMatchObject({ ok: false, field: 'workspacePreorders', error: expect.stringContaining('하나만') });
    expect(prepareGoodWorkspaceSections({ ...EMPTY_GOOD_WORKSPACE_SECTIONS, preorders: [{ ...active, approvalReference: '' }] }, rows, true))
      .toMatchObject({ ok: false, field: 'workspacePreorders', error: expect.stringContaining('승인 근거') });
    expect(prepareGoodWorkspaceSections({ ...EMPTY_GOOD_WORKSPACE_SECTIONS, preorders: [{ ...preorder, optionKey: 'gone' }] }, rows, true))
      .toMatchObject({ ok: false, field: 'workspacePreorders' });
    const { key, optionKey, ...activeValues } = active; void key; void optionKey;
    const json = JSON.stringify({ preorders: [{ variant: { id: SAVED }, values: activeValues }] });
    expect(parseGoodWorkspaceSections(json, false)).toMatchObject({ ok: false, field: 'workspacePreorders' });
    expect(parseGoodWorkspaceSections(json, true)).toMatchObject({ ok: true, sections: { preorders: [{ values: { state: 'active' } }] } });
  });

  it('서버는 조작된 제출(검토 완료인데 확인 없음·옵션 참조 형식·모르는 키)을 거절한다', () => {
    const model = { ...emptyGoodsKcModel(), variantIds: undefined, variantRefs: [{ id: SAVED }] };
    delete (model as { variantIds?: unknown }).variantIds;
    expect(parseGoodWorkspaceSections(JSON.stringify({ kc: { status: 'reviewed', attested: false, models: [model] } }), true)).toMatchObject({ ok: false, field: 'workspaceKc' });
    expect(parseGoodWorkspaceSections(JSON.stringify({ kc: { status: 'unreviewed', attested: false, models: [{ ...model, variantRefs: [{ id: 'x' }] }] } }), true)).toMatchObject({ ok: false });
    expect(parseGoodWorkspaceSections(JSON.stringify({ kc: { status: 'unreviewed', attested: false, models: [{ ...model, variantIds: [] }] } }), true)).toMatchObject({ ok: false });
    expect(parseGoodWorkspaceSections(JSON.stringify({ publish: true }), true)).toMatchObject({ ok: false });
    expect(parseGoodWorkspaceSections('{', true)).toMatchObject({ ok: false });
    expect(parseGoodWorkspaceSections(JSON.stringify({ kc: { status: 'unreviewed', attested: false, models: [model] } }), true))
      .toMatchObject({ ok: true, sections: { kc: { models: [{ variantRefs: [{ id: SAVED }] }] } } });
  });

  it('래퍼 오류를 섹션 칸 안내로 옮긴다', () => {
    expect(goodWorkspaceSectionFailure('goods_workspace_operation_conflict')?.form).toContain('이미 처리된 저장 요청');
    expect(goodWorkspaceSectionFailure('goods_kc_attestation_required')?.workspaceKc).toContain('확인');
    expect(goodWorkspaceSectionFailure('preorder_admin_required')?.workspacePreorders).toContain('관리자');
    expect(goodWorkspaceSectionFailure('goods_workspace_variant_unresolved')?.workspaceKc).toContain('옵션');
    expect(goodWorkspaceSectionFailure('goods_kc_review_changed')?.workspaceKc).toContain('KC');
    expect(goodWorkspaceSectionFailure('goods_compare_at_price_invalid')).toBeNull();
  });
});
