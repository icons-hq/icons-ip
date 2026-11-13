import { describe, expect, it } from 'vitest';
import { emptyGoodsKcModel, goodsKcProductNotApplicableModel } from './goods-kc';
import type { GoodsOptionRow } from './goods-option-editor';
import {
  EMPTY_GOOD_WORKSPACE_SECTIONS, goodWorkspaceKcVariants, goodWorkspaceKcWithTemplate, goodWorkspaceSectionFailure, goodWorkspaceVariantId,
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

  it('확인 체크 없는 KC 입력은 미검토로 보내고, 체크했는데 대상 모델의 연결이 빠지면 저장하지 않는다', () => {
    const partial = { ...emptyGoodsKcModel(), family: 'living' as const, scheme: 'safety_confirmation' as const, productCategory: '합성 분류',
      modelName: '합성 모델', businessRole: 'importer' as const, businessName: '합성 수입자', identifier: 'TEST-1', variantIds: [SAVED] };
    const unreviewed = prepareGoodWorkspaceSections({ kc: { models: [partial], attested: false }, preorders: [] }, rows, false);
    expect(unreviewed).toMatchObject({ ok: true, value: { kc: { status: 'unreviewed', attested: false } } });
    const missing = prepareGoodWorkspaceSections({ kc: { models: [partial], attested: true }, preorders: [] }, rows, false);
    expect(missing).toMatchObject({ ok: false, field: 'workspaceKc', error: expect.stringContaining('파랑') });
  });

  /* 리뷰(T16a minor 1): '대상 아님' 칸에는 옵션 연결 칸이 없다. 확인 체크를 풀고 옵션을 바꿔도 제출 때 현재 옵션으로 다시 연결해 저장된다. */
  it('대상 아님에서 확인 체크를 풀고 옵션을 바꿔도 저장할 때 현재 사용 옵션 전체로 다시 연결한다', () => {
    const before: GoodsOptionRow[] = [{ name: '기본', code: '', attributes: {}, extraPrice: 0, stockQty: 1 }];
    const chosen = goodsKcProductNotApplicableModel(goodWorkspaceKcVariants(before));
    /* 체크를 푼 뒤 옵션을 빨강·파랑으로 바꿨다. 화면 id가 바뀌어 처음 연결한 옵션은 더 이상 목록에 없다. */
    const after: GoodsOptionRow[] = [
      { name: '빨강', code: '', attributes: { 색상: '빨강' }, extraPrice: 0, stockQty: 1 },
      { name: '파랑', code: '', attributes: { 색상: '파랑' }, extraPrice: 0, stockQty: 1 },
    ];
    const prepared = prepareGoodWorkspaceSections({ ...EMPTY_GOOD_WORKSPACE_SECTIONS, kc: { models: [chosen], attested: false, productNotApplicable: true } }, after, false);
    if (!prepared.ok) throw new Error(prepared.error);
    expect(prepared.value.kc).toMatchObject({ status: 'unreviewed', attested: false });
    /* 연결 순서는 옵션 id 정렬을 따른다. */
    expect(prepared.value.kc?.models[0].variantRefs).toHaveLength(2);
    expect(prepared.value.kc?.models[0].variantRefs).toEqual(expect.arrayContaining([{ attributes: { 색상: '빨강' } }, { attributes: { 색상: '파랑' } }]));
    /* 체크한 채여도 같다(검토 완료로 저장). */
    const attested = prepareGoodWorkspaceSections({ ...EMPTY_GOOD_WORKSPACE_SECTIONS, kc: { models: [chosen], attested: true, productNotApplicable: true } }, after, false);
    expect(attested).toMatchObject({ ok: true, value: { kc: { status: 'reviewed' } } });
    /* 프리셋의 해당 없음 틀은 제품군·안내를 지킨 채 옵션만 연결된다. */
    const template = goodWorkspaceKcWithTemplate(EMPTY_GOOD_WORKSPACE_SECTIONS.kc, { family: 'living', scheme: 'not_applicable', publicNote: '합성 틀 안내' })!;
    const fromTemplate = prepareGoodWorkspaceSections({ ...EMPTY_GOOD_WORKSPACE_SECTIONS, kc: template }, after, false);
    if (!fromTemplate.ok) throw new Error(fromTemplate.error);
    expect(fromTemplate.value.kc?.models[0]).toMatchObject({ family: 'living', scheme: 'not_applicable', publicNote: '합성 틀 안내' });
    expect(fromTemplate.value.kc?.models[0].variantRefs).toEqual(expect.arrayContaining([{ attributes: { 색상: '빨강' } }, { attributes: { 색상: '파랑' } }]));
  });

  /* 해당 없음은 체크 한 번으로 끝난다. 체크 뒤 옵션을 바꿔도 사람이 다시 체크할 필요 없이 제출 때 현재 옵션에 연결한다. */
  it('상품 전체 KC 해당 없음 체크는 제출 시점의 사용 옵션 전체로 다시 연결한다', () => {
    const notApplicable = { ...emptyGoodsKcModel(), family: 'other' as const, scheme: 'not_applicable' as const, variantIds: [SAVED], publicNote: '고객 안내' };
    const result = prepareGoodWorkspaceSections({ kc: { models: [notApplicable], attested: true, productNotApplicable: true }, preorders: [] }, rows, false);
    expect(result).toMatchObject({ ok: true, value: { kc: { status: 'reviewed', attested: true, models: [{ scheme: 'not_applicable', publicNote: '고객 안내' }] } } });
    if (!result.ok) throw new Error('prepared');
    expect(result.value.kc?.models[0].variantRefs).toHaveLength(rows.filter((row) => row.isActive !== false).length);
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

  /* 리뷰 T3a-1 — 사용 중지 새 옵션도 KC 모델 연결·예약 초안 대상으로 고를 수 있다. 화면은 옵션값 조합으로 보내고 DB가 이번 저장이 만든 옵션으로 해석한다. */
  it('사용 중지 새 옵션은 옵션값 조합 참조로 KC·예약 초안에 싣는다', () => {
    const inactive: GoodsOptionRow[] = [rows[0], { ...rows[1], isActive: false }];
    /* 대상 모델은 옵션을 직접 고른다(상품 전체 해당 없음은 사용 옵션 전체로 다시 맞추므로 대상 모델로 확인한다). */
    const model = { ...emptyGoodsKcModel(), family: 'living' as const, scheme: 'safety_confirmation' as const, variantIds: goodWorkspaceKcVariants(inactive).map((variant) => variant.id) };
    const prepared = prepareGoodWorkspaceSections({ kc: { models: [model], attested: false }, preorders: [preorder] }, inactive, false);
    if (!prepared.ok) throw new Error(prepared.error);
    expect(prepared.value.kc?.models[0].variantRefs).toEqual([{ id: SAVED }, { attributes: { 색상: '파랑' } }]);
    expect(prepared.value.preorders[0].variant).toEqual({ attributes: { 색상: '파랑' } });
  });

  /* 리뷰 T3a-9 — 판매기간을 설정한 상품은 예약을 활성화할 수 없다(DB goods_sale_period_preorder_conflict). 저장 전에 막는다. */
  it('판매기간을 설정했으면 예약 활성화를 저장 전에 막고, 초안은 그대로 둔다', () => {
    const active = { ...preorder, state: 'active' as const };
    const blocked = prepareGoodWorkspaceSections({ ...EMPTY_GOOD_WORKSPACE_SECTIONS, preorders: [active] }, rows, true, { salePeriodEnabled: true });
    expect(blocked).toMatchObject({ ok: false, field: 'workspacePreorders', error: expect.stringContaining('판매기간') });
    expect(blocked.ok ? '' : blocked.error).toContain('초안');
    expect(prepareGoodWorkspaceSections({ ...EMPTY_GOOD_WORKSPACE_SECTIONS, preorders: [preorder] }, rows, true, { salePeriodEnabled: true })).toMatchObject({ ok: true });
    expect(prepareGoodWorkspaceSections({ ...EMPTY_GOOD_WORKSPACE_SECTIONS, preorders: [active] }, rows, true, { salePeriodEnabled: false })).toMatchObject({ ok: true });
  });

  /* 리뷰 T3a-3·T3a-8·T3a-9 — 옵션 해석 실패는 섹션별 코드로, 다른 요청이 끝낸 임시저장·판매기간 충돌은 등록 화면에 맞는 안내로 옮긴다. */
  it('섹션별 옵션 해석 실패·임시저장 완료 충돌·판매기간 충돌을 해당 칸에 안내한다', () => {
    expect(goodWorkspaceSectionFailure('goods_workspace_preorder_variant_unresolved')).toEqual({ workspacePreorders: expect.stringContaining('예약 대상 옵션') });
    expect(goodWorkspaceSectionFailure('invalid_goods_workspace_preorder_variant')).toEqual({ workspacePreorders: expect.stringContaining('예약 대상 옵션') });
    expect(goodWorkspaceSectionFailure('goods_workspace_kc_variant_unresolved')).toEqual({ workspaceKc: expect.stringContaining('KC 모델에 연결한 옵션') });
    expect(goodWorkspaceSectionFailure('invalid_goods_workspace_kc_variant')).toEqual({ workspaceKc: expect.stringContaining('KC 모델에 연결한 옵션') });
    const skipped = goodWorkspaceSectionFailure('goods_workspace_draft_completed_sections_skipped');
    expect(skipped?.form).toContain('이미 상품으로 등록');
    expect(skipped?.form).toContain('KC·예약판매·추가 설정 입력과 공개 요청은 처리되지 않았');
    const conflict = goodWorkspaceSectionFailure('goods_sale_period_preorder_conflict');
    expect(conflict?.workspacePreorders).toContain('초안');
    expect(conflict?.saleStartsAt).toContain('판매기간');
    expect(JSON.stringify(conflict)).not.toContain('일반재고로 전환');
    expect(goodWorkspaceSectionFailure('goods_sale_period_changed')).toBeNull();
    expect(goodWorkspaceSectionFailure('invalid_goods_sale_period')).toBeNull();
  });

  /* TKT-006·TKT-086: 등록 화면은 프리셋 KC 틀을 같은 화면 KC 입력에 미검토 모델로 채우고, 함께 저장해도 틀이 남는다. */
  it('고시 프리셋의 KC 틀은 등록 화면 KC 입력에 미검토 모델로 들어가 함께 저장된다', () => {
    const notApplicableTemplate = { family: 'living' as const, scheme: 'not_applicable' as const, publicNote: '합성 해당 없음 안내' };
    const filled = goodWorkspaceKcWithTemplate(EMPTY_GOOD_WORKSPACE_SECTIONS.kc, notApplicableTemplate);
    expect(filled).toEqual({ models: [{ ...emptyGoodsKcModel(), family: 'living', scheme: 'not_applicable', publicNote: '합성 해당 없음 안내' }],
      attested: false, productNotApplicable: true });
    const prepared = prepareGoodWorkspaceSections({ ...EMPTY_GOOD_WORKSPACE_SECTIONS, kc: filled! }, rows, false);
    if (!prepared.ok) throw new Error(prepared.error);
    /* 확인 체크가 없으므로 미검토 초안이고, 틀은 번호·근거를 채우지 않는다. 상품 전체 해당 없음이라 연결 옵션만 제출 때 사용 옵션 전체로 맞춘다. */
    expect(prepared.value.kc).toMatchObject({ status: 'unreviewed', attested: false,
      models: [{ family: 'living', scheme: 'not_applicable', publicNote: '합성 해당 없음 안내', identifier: '', modelName: '', basis: '' }] });
    expect(prepared.value.kc?.models[0].variantRefs).toEqual(expect.arrayContaining([{ id: SAVED }, { attributes: { 색상: '파랑' } }]));
    expect(prepared.value.kc?.models[0].variantRefs).toHaveLength(2);
    /* 원클릭 해당 없음 위에 KC 대상 틀을 고르면 대상 모델로 바뀌고 확인 체크가 풀린다. */
    const oneClick = { models: [goodsKcProductNotApplicableModel(goodWorkspaceKcVariants(rows))], attested: true, productNotApplicable: true };
    expect(goodWorkspaceKcWithTemplate(oneClick, { family: 'children', scheme: 'safety_confirmation', publicNote: '' }))
      .toEqual({ models: [{ ...emptyGoodsKcModel(), family: 'children', scheme: 'safety_confirmation' }], attested: false, productNotApplicable: false });
    /* 이미 입력한 대상 모델이 있으면 지우지 않고 뒤에 더한다. */
    const subject = { ...emptyGoodsKcModel(), family: 'living' as const, scheme: 'safety_certification' as const, modelName: '입력한 모델' };
    expect(goodWorkspaceKcWithTemplate({ models: [subject], attested: true }, notApplicableTemplate)?.models).toHaveLength(2);
    expect(goodWorkspaceKcWithTemplate({ models: [subject], attested: true }, notApplicableTemplate)?.attested).toBe(false);
    expect(goodWorkspaceKcWithTemplate({ models: [subject], attested: false }, { family: 'other', scheme: 'safety_certification', publicNote: '' })).toBeNull();
    expect(goodWorkspaceKcWithTemplate({ models: Array.from({ length: 50 }, () => subject), attested: false }, notApplicableTemplate)).toBeNull();
  });

  /* SHEET-014: 기타 인증은 KC 카드 안 입력이고, 입력이 있을 때만 섹션을 보낸다(없으면 기존 저장과 같은 결과). */
  it('기타 인증은 입력이 있을 때만 싣고, 종류·번호가 빠지면 KC 카드에 알린다', () => {
    const entries = [{ kind: ' 방송통신기자재 적합성평가 ', agency: '', number: 'R-R-TEST-0001', visible: true }];
    const prepared = prepareGoodWorkspaceSections({ ...EMPTY_GOOD_WORKSPACE_SECTIONS, otherCertifications: entries }, rows, false);
    expect(prepared).toEqual({ ok: true, value: { kc: null, preorders: [],
      otherCertifications: [{ kind: '방송통신기자재 적합성평가', agency: '', number: 'R-R-TEST-0001', visible: true }] } });
    expect(prepareGoodWorkspaceSections({ ...EMPTY_GOOD_WORKSPACE_SECTIONS, otherCertifications: [{ ...entries[0], number: '' }] }, rows, false))
      .toEqual({ ok: false, field: 'workspaceKc', error: '기타 인증 1: 인증 종류와 인증번호를 입력해주세요.' });
    if (!prepared.ok) throw new Error(prepared.error);
    const parsed = parseGoodWorkspaceSections(JSON.stringify(prepared.value), false);
    expect(parsed).toEqual({ ok: true, sections: { otherCertifications: { entries: prepared.value.otherCertifications, expectedRevision: null } } });
    expect(parseGoodWorkspaceSections(JSON.stringify({ otherCertifications: [] }), false)).toEqual({ ok: true, sections: {} });
    expect(parseGoodWorkspaceSections(JSON.stringify({ otherCertifications: [{ ...entries[0], number: ' ' }] }), false)).toMatchObject({ ok: false, field: 'workspaceKc' });
    expect(parseGoodWorkspaceSections(JSON.stringify({ otherCertifications: { entries } }), false)).toMatchObject({ ok: false, field: 'workspaceKc' });
    expect(goodWorkspaceSectionFailure('goods_other_certification_incomplete')?.workspaceKc).toContain('상품은 저장되지 않았고 입력은 유지됩니다.');
    expect(goodWorkspaceSectionFailure('goods_other_certifications_changed')?.workspaceKc).toContain('기타 인증이 바뀌었습니다');
  });

  it('래퍼 오류를 섹션 칸 안내로 옮긴다', () => {
    expect(goodWorkspaceSectionFailure('goods_workspace_operation_conflict')?.form).toContain('이미 처리된 저장 요청');
    expect(goodWorkspaceSectionFailure('goods_kc_attestation_required')?.workspaceKc).toContain('확인');
    expect(goodWorkspaceSectionFailure('goods_kc_review_incomplete')?.workspaceKc).toContain('인증·신고번호');
    expect(goodWorkspaceSectionFailure('goods_kc_review_incomplete')?.workspaceKc).not.toContain('증빙');
    expect(goodWorkspaceSectionFailure('preorder_admin_required')?.workspacePreorders).toContain('관리자');
    expect(goodWorkspaceSectionFailure('goods_kc_review_changed')?.workspaceKc).toContain('KC');
    expect(goodWorkspaceSectionFailure('goods_type_category_changed')?.workspaceKc)
      .toBe('카테고리에 연결된 상품 유형이 바뀌었습니다. 새로고침한 뒤 KC를 다시 확인해주세요.');
    expect(goodWorkspaceSectionFailure('goods_compare_at_price_invalid')).toBeNull();
  });
});
