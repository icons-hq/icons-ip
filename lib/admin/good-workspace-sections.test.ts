import { describe, expect, it } from 'vitest';
import { emptyGoodsKcModel, goodsKcProductNotApplicableModel } from './goods-kc';
import { goodsOptionRowKey, type GoodsOptionRow } from './goods-option-editor';
import { emptyGoodWorkspaceProduction } from './good-workspace-extra-sections';
import type { PreorderPlan } from './goods-preorders';
import {
  EMPTY_GOOD_WORKSPACE_SECTIONS, goodWorkspaceKcVariants, goodWorkspaceKcWithTemplate, goodWorkspacePreorderCapacity, goodWorkspacePreorderTargets, goodWorkspaceSectionFailure,
  goodWorkspaceVariantId, parseGoodWorkspaceSections, prepareGoodWorkspaceSections, withGoodWorkspacePreorderPlan, type GoodWorkspaceSectionsDraft,
} from './good-workspace-sections';

const SAVED = '11111111-1111-4111-8111-111111111111';
const rows: GoodsOptionRow[] = [
  { id: SAVED, name: '빨강', code: 'GOOD-01', attributes: { 색상: '빨강' }, extraPrice: 0, stockQty: 3, expectedStockQty: 3 },
  { name: '파랑', code: '', attributes: { 색상: '파랑' }, extraPrice: 0, stockQty: 0 },
];
const BLUE = 'new:[["색상","파랑"]]';
const preorder = { key: 'p1', optionKey: BLUE, capacityQty: '5', startsAt: '2099-11-01T10:00',
  endsAt: '2099-11-10T18:00', expectedShipDate: '2099-11-20' };
const schedule = { startsAt: preorder.startsAt, endsAt: preorder.endsAt, expectedShipDate: preorder.expectedShipDate };
/** 판매 시기에서 예약판매를 고른 입력: 일정은 한 번, 물량은 옵션별. 여기서는 빨강의 체크를 끄고 파랑만 5개 예약한다. */
const plan: PreorderPlan = { perOption: false, ...schedule, options: { [SAVED]: { excluded: true }, [BLUE]: { capacityQty: '5' } } };
const withPlan = (preorderPlan: PreorderPlan, extra: Partial<GoodWorkspaceSectionsDraft> = {}): GoodWorkspaceSectionsDraft => ({ ...EMPTY_GOOD_WORKSPACE_SECTIONS, preorderPlan, ...extra });

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
    const draft: GoodWorkspaceSectionsDraft = { kc: { models: [model], attested: true }, preorders: [], preorderPlan: plan };
    const prepared = prepareGoodWorkspaceSections(draft, rows, false);
    if (!prepared.ok) throw new Error(prepared.error);
    expect(prepared.value.kc).toMatchObject({ status: 'reviewed', attested: true });
    expect(prepared.value.kc?.models[0]).not.toHaveProperty('variantIds');
    expect(prepared.value.kc?.models[0].variantRefs).toEqual(expect.arrayContaining([{ id: SAVED }, { attributes: { 색상: '파랑' } }]));
    expect(prepared.value.preorders).toEqual([{ variant: { attributes: { 색상: '파랑' } }, values: expect.objectContaining({ state: 'active', capacityQty: '5' }) }]);

    const parsed = parseGoodWorkspaceSections(JSON.stringify(prepared.value), false);
    if (!parsed.ok) throw new Error(parsed.error);
    expect(parsed.sections.kc).toMatchObject({ status: 'reviewed', attested: true, expectedRevision: null, expectedContextFingerprint: null });
    expect(parsed.sections.preorders?.[0]).toEqual({ variant: { attributes: { 색상: '파랑' } }, policyId: null, expectedRevision: null,
      values: { state: 'active', capacityQty: 5, startsAt: '2099-11-01T01:00:00.000Z', endsAt: '2099-11-10T09:00:00.000Z', expectedShipDate: '2099-11-20', approvalReference: null } });
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

  /* 2026-11-19: 예약 조건은 권한 구분 없이 저장하면 적용된다. 승인 근거는 없고 초안(state 'draft')은 서버가 받지 않는다. */
  /* 규칙 6: 일정은 한 번 넣고 물량만 옵션별로 정한다. 저장 계약(옵션별 preorders 배열)은 그대로라, 제출할 때 사용 중인 옵션으로 펼친다. */
  it('예약 입력은 제출 시점의 사용 중 옵션으로 펼쳐 옵션마다 조건 하나씩 적용으로 싣는다', () => {
    expect(prepareGoodWorkspaceSections(withPlan(plan), rows, false)).toMatchObject({ ok: true, value: { preorders: [{ values: { state: 'active' } }] } });
    /* 체크를 끄지 않은 옵션은 모두 같은 일정으로 싣는다. 물량은 고치지 않았으면 그 옵션의 재고수량(빨강 3), 고쳤으면 그 값(파랑 5)이다. */
    const all = prepareGoodWorkspaceSections(withPlan({ ...plan, options: { [BLUE]: { capacityQty: '5' } } }), rows, false);
    expect(all).toEqual({ ok: true, value: { kc: null, preorders: [
      { variant: { id: SAVED }, values: { state: 'active', capacityQty: '3', ...schedule } },
      { variant: { attributes: { 색상: '파랑' } }, values: { state: 'active', capacityQty: '5', ...schedule } },
    ] } });
    /* '옵션마다 일정을 다르게'를 켠 옵션만 자기 일정을 쓰고, 나머지는 공통 일정을 쓴다. */
    const own = prepareGoodWorkspaceSections(withPlan({ ...plan, perOption: true, options: { [BLUE]: { capacityQty: '5', expectedShipDate: '2099-12-01' } } }), rows, false);
    expect(own).toMatchObject({ ok: true, value: { preorders: [{ values: { expectedShipDate: '2099-11-20' } }, { values: { expectedShipDate: '2099-12-01' } }] } });
    /* 예약판매를 골랐는데 예약할 옵션이 없으면 일반 재고로 조용히 저장하지 않고 알린다. */
    expect(prepareGoodWorkspaceSections(withPlan({ ...plan, options: { [SAVED]: { excluded: true }, [BLUE]: { excluded: true } } }), rows, true))
      .toMatchObject({ ok: false, field: 'workspacePreorders', error: expect.stringContaining('예약할 옵션을 하나 이상 체크') });
    /* 예약 입력이 없으면(판매 시기가 예약판매가 아니면) 옛 펼친 결과가 남아 있어도 싣지 않는다. */
    expect(prepareGoodWorkspaceSections({ ...EMPTY_GOOD_WORKSPACE_SECTIONS, preorders: [preorder] }, rows, true)).toEqual({ ok: true, value: { kc: null, preorders: [] } });
    const { key, optionKey, ...values } = preorder; void key; void optionKey;
    const json = (state: string) => JSON.stringify({ preorders: [{ variant: { id: SAVED }, values: { ...values, state } }] });
    expect(parseGoodWorkspaceSections(json('active'), false)).toMatchObject({ ok: true, sections: { preorders: [{ values: { state: 'active', approvalReference: null } }] } });
    expect(parseGoodWorkspaceSections(json('draft'), true)).toMatchObject({ ok: false, field: 'workspacePreorders' });
  });

  /* 편집기는 '예약 입력이 있는가'를 preorders 길이로 본다(저장 전 경고·재고 준비 판정). 예약 입력을 고칠 때 펼친 결과를 함께 맞춘다. */
  it('예약 입력을 바꾸면 옵션별로 펼친 결과도 함께 맞추고, 그만두면 둘 다 비운다', () => {
    const chosen = withGoodWorkspacePreorderPlan(EMPTY_GOOD_WORKSPACE_SECTIONS, { ...plan, options: {} }, rows);
    expect(chosen.preorderPlan).toEqual({ ...plan, options: {} });
    expect(chosen.preorders.map((entry) => [entry.optionKey, entry.capacityFromStock, entry.startsAt])).toEqual([[SAVED, true, schedule.startsAt], [BLUE, true, schedule.startsAt]]);
    expect(withGoodWorkspacePreorderPlan(chosen, plan, rows).preorders.map((entry) => [entry.optionKey, entry.capacityQty])).toEqual([[BLUE, '5']]);
    const cleared = withGoodWorkspacePreorderPlan(chosen, null, rows);
    expect(cleared.preorders).toEqual([]);
    expect(cleared).not.toHaveProperty('preorderPlan');
    /* 옵션 30개도 일정 한 번이면 된다: 모든 사용 중 옵션이 대상이고 사용 중지 옵션은 대상이 아니다. */
    const many: GoodsOptionRow[] = Array.from({ length: 30 }, (_, index) => ({ name: `옵션 ${index + 1}`, code: '', attributes: { 종류: String(index + 1) }, extraPrice: 0, stockQty: 40, isActive: index !== 29 }));
    expect(goodWorkspacePreorderTargets(many)).toHaveLength(29);
    const prepared = prepareGoodWorkspaceSections(withPlan({ ...plan, options: {} }), many, false);
    expect(prepared.ok && prepared.value.preorders).toHaveLength(29);
    expect(prepared.ok && new Set(prepared.value.preorders.map((entry) => JSON.stringify(entry.values))).size).toBe(1);
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

  /* 리뷰 T3a-1 — 사용 중지 새 옵션도 KC 모델 연결 대상으로 고를 수 있다. 화면은 옵션값 조합으로 보내고 DB가 이번 저장이 만든 옵션으로 해석한다.
     예약판매는 사용 중인 옵션만 대상이다(DB goods_variant_inactive) — 사용 중지 옵션은 예약 입력에 있어도 싣지 않는다. */
  it('사용 중지 새 옵션은 옵션값 조합 참조로 KC에 싣고, 예약판매에는 싣지 않는다', () => {
    const inactive: GoodsOptionRow[] = [rows[0], { ...rows[1], isActive: false }];
    /* 대상 모델은 옵션을 직접 고른다(상품 전체 해당 없음은 사용 옵션 전체로 다시 맞추므로 대상 모델로 확인한다). */
    const model = { ...emptyGoodsKcModel(), family: 'living' as const, scheme: 'safety_confirmation' as const, variantIds: goodWorkspaceKcVariants(inactive).map((variant) => variant.id) };
    const prepared = prepareGoodWorkspaceSections({ kc: { models: [model], attested: false }, preorders: [] }, inactive, false);
    if (!prepared.ok) throw new Error(prepared.error);
    expect(prepared.value.kc?.models[0].variantRefs).toEqual([{ id: SAVED }, { attributes: { 색상: '파랑' } }]);
    const preordered = prepareGoodWorkspaceSections({ kc: { models: [model], attested: false }, preorders: [], preorderPlan: { ...plan, options: { [BLUE]: { capacityQty: '5' } } } }, inactive, false);
    expect(preordered.ok && preordered.value.preorders).toEqual([{ variant: { id: SAVED }, values: { state: 'active', capacityQty: '3', ...schedule } }]);
  });

  /* 2026-11-19 — 예약 입력은 빈 칸 이름을 모두 알리고 상품을 저장하지 않는다(임시저장으로 빠져나가는 길은 없다 — 예약을 안 하려면 판매 시기를 바꾼다). */
  it('예약 입력은 비거나 지난 칸 이름을 모두 알리고 막는다', () => {
    const now = Date.parse('2099-11-05T00:00:00.000Z');
    const missing = prepareGoodWorkspaceSections(withPlan({ ...plan, endsAt: '', options: { [SAVED]: { excluded: true }, [BLUE]: { capacityQty: '' } } }), rows, true, { now });
    expect(missing).toMatchObject({ ok: false, field: 'workspacePreorders' });
    expect(missing.ok ? '' : missing.error).toBe('예약판매: 접수 종료·옵션별 예약 물량 칸을 확인해주세요. 예약판매를 하지 않으려면 판매 시기를 바꿔주세요.');
    /* 옵션이 하나뿐인 상품은 옵션 표가 없으므로 칸 이름에 '옵션별'을 붙이지 않는다. */
    const single = prepareGoodWorkspaceSections(withPlan({ ...plan, endsAt: '', options: {} }), [{ ...rows[1], stockQty: 0 }], true, { now });
    expect(single.ok ? '' : single.error).toBe('예약판매: 예약 물량·접수 종료 칸을 확인해주세요. 예약판매를 하지 않으려면 판매 시기를 바꿔주세요.');
    expect(prepareGoodWorkspaceSections(withPlan(plan), rows, true, { now: Date.parse('2099-11-11T00:00:00.000Z') }))
      .toMatchObject({ ok: false, error: expect.stringContaining('접수 종료') });
    expect(prepareGoodWorkspaceSections(withPlan(plan), rows, true, { now })).toMatchObject({ ok: true });
  });

  /* 11/19 예약 물량 = 재고수량 — 물량을 고치지 않은 옵션은 제출 시점의 옵션 행 재고수량을 물량으로 싣는다. */
  it('물량을 고치지 않은 옵션은 제출 시점의 재고수량을 예약 물량으로 싣고, 직접 고친 값은 그대로 싣는다', () => {
    const now = Date.parse('2099-11-05T00:00:00.000Z');
    const target = rows.find((row) => goodsOptionRowKey(row) === BLUE)!;
    const stocked = rows.map((row) => row === target ? { ...row, stockQty: 600 } : row);
    const following: PreorderPlan = { ...plan, options: { [SAVED]: { excluded: true } } };
    expect(goodWorkspacePreorderCapacity({ ...preorder, capacityQty: '', capacityFromStock: true }, stocked)).toBe('600');
    const prepared = prepareGoodWorkspaceSections(withPlan(following), stocked, true, { now });
    expect(prepared).toMatchObject({ ok: true, value: { preorders: [{ values: { state: 'active', capacityQty: '600' } }] } });
    /* 재고수량이 0이면 물량이 비어 적용 필수 칸으로 막힌다(기존 흐름: 물량을 직접 입력). */
    const empty = rows.map((row) => row === target ? { ...row, stockQty: 0 } : row);
    expect(prepareGoodWorkspaceSections(withPlan(following), empty, true, { now })).toMatchObject({ ok: false, error: expect.stringContaining('예약 물량') });
    expect(goodWorkspacePreorderCapacity({ ...preorder, capacityFromStock: false, capacityQty: '300' }, stocked)).toBe('300');
  });

  /* 규칙 5 — 판매기간·주문 후 제작과 예약판매는 함께 쓸 수 없다(DB가 양방향으로 거절). 판매 시기 선택이 먼저 막고, 제출 직전에도 한 번 더 막는다. */
  it('판매기간이나 주문 후 제작을 켰으면 예약 입력을 저장 전에 막는다', () => {
    const blocked = prepareGoodWorkspaceSections(withPlan(plan), rows, true, { salePeriodEnabled: true });
    expect(blocked).toMatchObject({ ok: false, field: 'workspacePreorders', error: expect.stringContaining('판매기간') });
    expect(blocked.ok ? '' : blocked.error).toContain('판매 시기에서 하나만 골라주세요');
    expect(prepareGoodWorkspaceSections(withPlan(plan), rows, true, { salePeriodEnabled: false })).toMatchObject({ ok: true });
    const production = prepareGoodWorkspaceSections(withPlan(plan, { extras: { production: { ...emptyGoodWorkspaceProduction(), enabled: true } } }), rows, true);
    expect(production).toMatchObject({ ok: false, field: 'workspacePreorders', error: expect.stringContaining('주문 후 제작') });
  });

  /* 랜덤 판매는 모든 옵션이 같은 일정으로 예약해야 한다(ADR-0027). 등록 화면도 빼둔 옵션·옵션별 일정을 무시하고 모든 사용 중 옵션을 같은 일정으로 싣는다. */
  it('랜덤 판매를 골랐으면 모든 옵션을 같은 일정으로 싣는다', () => {
    const stocked = rows.map((row) => ({ ...row, stockQty: 10 }));
    const random = prepareGoodWorkspaceSections(withPlan({ ...plan, perOption: true, options: { [SAVED]: { excluded: true, expectedShipDate: '2099-12-25' } } },
      { extras: { optionSaleMode: 'random' } }), stocked, true);
    if (!random.ok) throw new Error(random.error);
    expect(random.value.preorders.map((entry) => entry.values.expectedShipDate)).toEqual(['2099-11-20', '2099-11-20']);
    expect(random.value.preorders.map((entry) => entry.variant)).toEqual([{ id: SAVED }, { attributes: { 색상: '파랑' } }]);
  });

  /* 리뷰 T3a-3·T3a-8·T3a-9 — 옵션 해석 실패는 섹션별 코드로, 다른 요청이 끝낸 임시저장·판매기간 충돌은 등록 화면에 맞는 안내로 옮긴다. */
  it('섹션별 옵션 해석 실패·임시저장 완료 충돌·판매기간 충돌을 해당 칸에 안내한다', () => {
    expect(goodWorkspaceSectionFailure('goods_workspace_preorder_variant_unresolved')).toEqual({ workspacePreorders: expect.stringContaining('예약할 옵션') });
    expect(goodWorkspaceSectionFailure('invalid_goods_workspace_preorder_variant')).toEqual({ workspacePreorders: expect.stringContaining('예약할 옵션') });
    expect(goodWorkspaceSectionFailure('goods_workspace_kc_variant_unresolved')).toEqual({ workspaceKc: expect.stringContaining('KC 모델에 연결한 옵션') });
    expect(goodWorkspaceSectionFailure('invalid_goods_workspace_kc_variant')).toEqual({ workspaceKc: expect.stringContaining('KC 모델에 연결한 옵션') });
    const skipped = goodWorkspaceSectionFailure('goods_workspace_draft_completed_sections_skipped');
    expect(skipped?.form).toContain('이미 상품으로 등록');
    expect(skipped?.form).toContain('KC·예약판매·추가 설정 입력과 공개 요청은 처리되지 않았');
    const conflict = goodWorkspaceSectionFailure('goods_sale_period_preorder_conflict');
    expect(conflict?.workspacePreorders).toContain('판매 시기에서 하나만 골라주세요');
    expect(goodWorkspaceSectionFailure('production_preorder_conflict')?.workspacePreorders).toContain('주문 후 제작');
    expect(JSON.stringify(conflict)).not.toContain('임시저장');
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
    expect(goodWorkspaceSectionFailure('preorder_policy_not_configured')?.workspacePreorders).toContain('예약 물량·접수 기간·발송 예정일');
    expect(goodWorkspaceSectionFailure('goods_kc_review_changed')?.workspaceKc).toContain('KC');
    expect(goodWorkspaceSectionFailure('goods_type_category_changed')).toBeNull();
    expect(goodWorkspaceSectionFailure('goods_compare_at_price_invalid')).toBeNull();
  });
});
