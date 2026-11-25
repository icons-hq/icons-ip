import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { emptyGoodsKcModel, goodsKcProductNotApplicableModel } from '@/lib/admin/goods-kc';
import { EMPTY_GOOD_WORKSPACE_SECTIONS, goodWorkspaceKcVariants, goodWorkspaceKcWithTemplate, type GoodWorkspaceSectionsDraft } from '@/lib/admin/good-workspace-sections';
import { goodsOptionRowKey, type GoodsOptionRow } from '@/lib/admin/goods-option-editor';
import { emptyPreorderPlan, type PreorderPlan } from '@/lib/admin/goods-preorders';

/* 등록 화면 KC 카드는 폼 키 밖 provider의 섹션 입력을 그린다. 정적 렌더에서는 provider 상태를 직접 넣는다. */
const workspace = vi.hoisted(() => ({ sections: null as unknown, sectionErrors: {} as Record<string, string>, optionRows: null as unknown }));
vi.mock('./GoodWorkspace', async () => {
  const actual = await vi.importActual<typeof import('./GoodWorkspace')>('./GoodWorkspace');
  return { ...actual, useGoodWorkspaceSections: () => ({
    sections: workspace.sections, setSections: vi.fn(), optionRows: workspace.optionRows ?? rows, publishOptionRows: vi.fn(), sectionErrors: workspace.sectionErrors, setSectionErrors: vi.fn(),
    operationId: () => 'op', readKcPanelStash: () => null, rememberKcPanel: vi.fn(), readPanelStash: () => undefined, rememberPanel: vi.fn(),
  }) };
});
vi.mock('@/app/admin/goods-kc-actions', () => ({ readGoodsKcAction: vi.fn(), saveGoodsKcAction: vi.fn(),
  readGoodsOtherCertificationsAction: vi.fn(), saveGoodsOtherCertificationsAction: vi.fn() }));
const rows: GoodsOptionRow[] = [{ name: '기본', code: '', attributes: {}, extraPrice: 0, stockQty: 1 }];
const { GOOD_WORKSPACE_KC_ATTESTATION, GoodSavedPreorderSection, GoodWorkspaceKcCard, GoodWorkspacePreorderCard, GoodWorkspacePreorderRow } = await import('./GoodWorkspaceSections');
const { goodPreorderSlotKind } = await import('./GoodSaleTimingContext');

function render(sections: GoodWorkspaceSectionsDraft) {
  workspace.sections = sections;
  return renderToStaticMarkup(<GoodWorkspaceKcCard />);
}
function chosen(html: string): string | null {
  return html.match(/<input class="mt-0\.5" type="radio"[^>]*checked=""[^>]*value="([a-z_]+)"/)?.[1] ?? null;
}
const variants = goodWorkspaceKcVariants(rows);

describe('등록 화면 KC 카드 — 자가 신고·기타 인증·KC 틀', () => {
  it('처음에는 KC 대상 여부만 묻고, 기타 인증 칸은 따로 보인다', () => {
    const html = render(EMPTY_GOOD_WORKSPACE_SECTIONS);
    expect(html).toContain('KC 미입력 · KC 인증 대상 여부를 고르세요.');
    expect(chosen(html)).toBeNull();
    expect(html).not.toContain('모델 1 모델명');
    expect(html).toContain('<h3 class="text-sm font-medium">기타 인증</h3>');
    /* 등록 화면은 모든 입력을 함께 저장한다. 섹션마다 '상품과 함께 저장'을 되풀이하지 않는다. */
    expect(html).not.toContain('상품과 함께 저장');
    expect(html).toContain('기타 인증 추가');
  });

  it('대상 아님을 고르면 확인 체크가 켜진 채 검토 완료로 함께 저장한다고 알린다', () => {
    const html = render({ ...EMPTY_GOOD_WORKSPACE_SECTIONS, kc: { models: [goodsKcProductNotApplicableModel(variants)], attested: true, productNotApplicable: true } });
    expect(chosen(html)).toBe('not_applicable');
    expect(html).toContain('KC 해당 없음 · 저장하면 검토 완료로 함께 저장됩니다.');
    expect(html).toMatch(/<input class="mt-0\.5" type="checkbox" checked=""\/><span>이 상품은 KC/);
  });

  it('대상은 근거 없이 게시 항목과 인증번호만 넣으면 확인 체크를 열고, 번호가 없으면 이유를 보인다', () => {
    const complete = { ...emptyGoodsKcModel(), family: 'living' as const, scheme: 'safety_confirmation' as const, productCategory: '합성 분류',
      modelName: '합성 모델', businessRole: 'importer' as const, businessName: '합성 수입자', identifier: 'TEST-ONLY-SD-1', variantIds: variants.map((variant) => variant.id) };
    const ready = render({ ...EMPTY_GOOD_WORKSPACE_SECTIONS, kc: { models: [complete], attested: false } });
    expect(chosen(ready)).toBe('subject');
    expect(ready).not.toContain('검토 완료 전 확인');
    expect(ready).toContain('TEST-ONLY-SD-1');
    expect(ready).toMatch(new RegExp(`<input class="mt-0\\.5" type="checkbox"/><span>${GOOD_WORKSPACE_KC_ATTESTATION.replace(/[().]/g, '\\$&')}`));
    expect(ready).toMatch(/내부 검토 근거 \(선택\)/);
    const missing = render({ ...EMPTY_GOOD_WORKSPACE_SECTIONS, kc: { models: [{ ...complete, identifier: '' }], attested: false } });
    expect(missing).toContain('모델 1: 인증·신고번호를 입력해주세요.');
    expect(missing).toMatch(/<input class="mt-0\.5" type="checkbox" disabled=""\/><span>실제 제품의 KC 표시/);
    expect(missing).toContain('저장하면 KC 미검토로 함께 저장됩니다.');
  });

  /* TKT-006·TKT-086: 프리셋 KC 틀은 등록 화면 KC 입력에 미검토 모델로 들어간다(확인 체크 없음). */
  it('고시 프리셋의 해당 없음 틀은 대상 아님 미확인 상태로 채워 미검토로 함께 저장한다', () => {
    const kc = goodWorkspaceKcWithTemplate(EMPTY_GOOD_WORKSPACE_SECTIONS.kc, { family: 'living', scheme: 'not_applicable', publicNote: '합성 틀 안내' })!;
    const html = render({ ...EMPTY_GOOD_WORKSPACE_SECTIONS, kc });
    expect(chosen(html)).toBe('not_applicable');
    expect(html).toContain('KC 해당 없음 · 확인 체크 전이라 저장하면 미검토로 함께 저장됩니다.');
    expect(html).toMatch(/<input class="mt-0\.5" type="checkbox"\/><span>이 상품은 KC/);
    expect(html).toContain('합성 틀 안내');
  });

  it('기타 인증은 고객 표시를 고른 것만 미리보기에 보인다', () => {
    const html = render({ ...EMPTY_GOOD_WORKSPACE_SECTIONS, otherCertifications: [
      { kind: '방송통신기자재 적합성평가', agency: '', number: 'R-R-TEST-0001', visible: true },
      { kind: '내부 보관 인증', agency: '', number: 'INTERNAL-1', visible: false },
    ] });
    const preview = html.slice(html.indexOf('고객 상세 미리보기'));
    expect(preview).toContain('R-R-TEST-0001');
    expect(preview).not.toContain('INTERNAL-1');
  });
});

/*
 * 2026-11-19 사용자·MD 결정: 등록 화면의 예약 조건도 상품을 저장하면 바로 적용된다. 임시저장·승인 근거·권한 구분이 없고, 저장이 막히면 빈 칸 옆에 이유를 보인다.
 * 2026-11-25 화면 규칙 6: 일정은 한 번 넣고 예약 물량만 옵션별로 정한다. 판매 시기에서 예약판매를 골랐을 때만 열린다(규칙 5).
 */
describe('등록 화면 예약판매 입력 — 한 번에 입력하고 저장하면 적용', () => {
  const key = goodsOptionRowKey(rows[0]);
  const options: GoodsOptionRow[] = [
    { name: '빨강', code: '', attributes: { 색상: '빨강' }, extraPrice: 0, stockQty: 500 },
    { name: '파랑', code: '', attributes: { 색상: '파랑' }, extraPrice: 0, stockQty: 300 },
    { name: '회색', code: '', attributes: { 색상: '회색' }, extraPrice: 0, stockQty: 10, isActive: false },
  ];
  const renderPreorder = (preorderPlan: PreorderPlan | undefined, { sectionErrors = {}, optionRows, extras }: { sectionErrors?: Record<string, string>; optionRows?: GoodsOptionRow[]; extras?: GoodWorkspaceSectionsDraft['extras'] } = {},
    node = <GoodWorkspacePreorderCard />) => {
    workspace.sections = { ...EMPTY_GOOD_WORKSPACE_SECTIONS, ...(preorderPlan ? { preorderPlan } : {}), ...(extras ? { extras } : {}) };
    workspace.sectionErrors = sectionErrors;
    workspace.optionRows = optionRows ?? null;
    try { return renderToStaticMarkup(node); } finally { workspace.sectionErrors = {}; workspace.optionRows = null; }
  };
  const count = (html: string, pattern: RegExp) => html.match(pattern)?.length ?? 0;

  it('판매 시기에서 예약판매를 고르지 않았으면(예약 입력이 없으면) 아무것도 그리지 않는다', () => {
    expect(renderPreorder(undefined)).toBe('');
  });
  it('옵션이 하나뿐이면 예약 대상 옵션을 고르는 칸 없이 물량·일정 네 칸만 보이고, 저장 방식·임시저장·승인 근거 칸이 없다', () => {
    const html = renderPreorder(emptyPreorderPlan());
    for (const gone of ['예약 대상 옵션', '<select', '<table', '예약 조건 추가', '임시저장', '승인', '적용 필수', '초안', 'type="radio"', 'type="checkbox"', '<textarea']) expect(html).not.toContain(gone);
    for (const label of ['>예약 물량</label>', '>접수 시작 (KST)</label>', '>접수 종료 (KST)</label>', '>발송 예정일</label>']) expect(html).toContain(label);
    expect(html).toContain('상품을 저장하면 바로 적용됩니다.');
    expect(html).toContain('저장한 뒤에는 예약 물량과 일정을 고칠 수 없고');
    expect(html).not.toContain('data-preorder-field-problem');
    /* 소속 폼을 떼어 상품 저장의 FormData·검증에 섞이지 않는다. */
    expect(html.match(/<(input|button)\b[^>]*>/g)?.every((control) => control.includes('form="good-detached-controls"'))).toBe(true);
  });
  it('저장이 막히면 빈 칸 옆에 이유를 보인다', () => {
    /* 물량은 직접 비운 경우(재고수량을 따라가지 않음). */
    const html = renderPreorder({ ...emptyPreorderPlan(), options: { [key]: { capacityQty: '' } } }, { sectionErrors: { workspacePreorders: '예약판매: 예약 물량·접수 시작·접수 종료·발송 예정일 칸을 확인해주세요.' } });
    expect(html.match(/data-preorder-field-problem=""/g)).toHaveLength(4);
    expect(html.match(/aria-invalid="true"/g)).toHaveLength(4);
    expect(html).toContain('예약 물량을 입력해주세요.');
    expect(html).toMatch(/role="alert">예약판매: 예약 물량/);
  });
  /* 11/19 예약 물량 = 재고수량 — 예약 물량은 옵션 행 재고수량(시험 행 1개)을 따라간다. */
  it('예약 물량은 옵션 재고수량을 따라가고, 다르게 고치면 경고만 보인다', () => {
    const following = renderPreorder(emptyPreorderPlan());
    expect(following).toMatch(/<input[^>]*type="number"[^>]*value="1"/);
    expect(following).toContain('재고수량 1개를 예약 물량으로 씁니다.');
    expect(following).toMatch(/data-good-readback=""[^>]*>예약 물량 1개\.</);
    const differs = renderPreorder({ ...emptyPreorderPlan(), options: { [key]: { capacityQty: '30' } } });
    expect(differs).toMatch(/<input[^>]*type="number"[^>]*value="30"/);
    expect(differs).toContain('재고수량 1개와 다릅니다');
    expect(differs).toContain('재고수량과 같게</button>');
  });
  it('옵션이 여러 개면 일정은 한 번, 예약 물량은 표에서 옵션별로 넣고 한꺼번에 채우는 버튼을 둔다', () => {
    const html = renderPreorder({ ...emptyPreorderPlan(), startsAt: '2099-12-01T10:00', endsAt: '2099-12-07T23:59', expectedShipDate: '2099-12-20' }, { optionRows: options });
    /* 일정 칸은 한 벌뿐이다. */
    expect(count(html, /type="datetime-local"/g)).toBe(2);
    expect(count(html, /type="date"/g)).toBe(1);
    /* 사용 중인 옵션만 표에 나온다(사용 중지 옵션은 넣지 않는다 — 규칙 2). */
    expect(count(html, /data-preorder-field="capacity:/g)).toBe(2);
    expect(html).toContain('aria-label="빨강 예약"');
    expect(html).toContain('aria-label="파랑 예약"');
    expect(html).not.toContain('회색');
    expect(html).toMatch(/aria-label="빨강 예약 물량"[^>]*value="500"/);
    expect(html).toContain('>전체 같은 수량 넣기</button>');
    expect(html).toContain('>재고수량과 같게</button>');
    expect(html).toContain('옵션마다 일정을 다르게');
    expect(html).toContain('12월 1일 10:00부터 7일 23:59까지 주문받고');
    expect(html).toContain('옵션 2개 · 예약 물량 합계 800개.');
    /* 줄마다 같은 안내를 되풀이하지 않는다. */
    expect(count(html, /재고수량을 예약 물량으로 씁니다|예약 물량으로 씁니다/g)).toBe(0);
    expect(count(html, /고치지 않은 예약 물량은 재고수량을 따라 바뀝니다\./g)).toBe(1);
  });
  it('체크를 끈 옵션은 예약하지 않고, 옵션마다 일정을 다르게 켜면 공통 일정 칸 대신 줄마다 일정 칸이 열린다', () => {
    const red = goodsOptionRowKey(options[0]), blue = goodsOptionRowKey(options[1]);
    const partial = renderPreorder({ ...emptyPreorderPlan(), options: { [blue]: { excluded: true } } }, { optionRows: options });
    expect(partial).toMatch(/aria-label="빨강 예약"[^>]*checked=""/);
    expect(partial).not.toMatch(/aria-label="파랑 예약"[^>]*checked=""/);
    expect(partial).toMatch(/aria-label="파랑 예약 물량"[^>]*disabled=""/);
    expect(partial).toContain('옵션 1개 · 예약 물량 합계 500개.');
    const own = renderPreorder({ ...emptyPreorderPlan(), perOption: true, startsAt: '2099-12-01T10:00', options: { [red]: { expectedShipDate: '2099-12-28' } } }, { optionRows: options });
    expect(count(own, /type="datetime-local"/g)).toBe(4);
    expect(count(own, /type="date"/g)).toBe(2);
    expect(own).toMatch(/aria-label="빨강 발송 예정일"[^>]*value="2099-12-28"/);
    /* 고치지 않은 옵션은 공통 일정을 이어받아 보인다. */
    expect(own).toMatch(/aria-label="파랑 접수 시작 \(KST\)"[^>]*value="2099-12-01T10:00"/);
    expect(own).toContain('옵션마다 다른 일정으로 주문받습니다.');
  });
  /* 등록 화면 예약 입력도 랜덤 판매를 안다: 모든 옵션이 같은 일정이어야 하므로 옵션을 빼거나 일정을 다르게 넣는 칸이 없다(ADR-0027). */
  it('랜덤 판매를 골랐으면 모든 옵션을 같은 일정으로만 예약하게 한다', () => {
    const html = renderPreorder({ ...emptyPreorderPlan(), perOption: true }, { optionRows: options, extras: { optionSaleMode: 'random' } });
    expect(html).not.toContain('type="checkbox"');
    expect(html).not.toContain('옵션마다 일정을 다르게');
    expect(count(html, /type="datetime-local"/g)).toBe(2);
    expect(html).toContain('랜덤 판매는 모든 옵션을 같은 일정으로 예약합니다.');
  });

  /* 판매 시기 안의 예약판매 자리: 고르지 않았을 때도 같은 id의 빈 자리로 남아 오류 포커스·'예약판매로 이동' 링크가 닿는다. */
  it('예약판매 자리는 닫혀 있어도 같은 id로 남고, 예약 입력이 있으면 제목과 함께 열린다', () => {
    const closed = renderPreorder(undefined, {}, <GoodWorkspacePreorderRow title="예약판매" />);
    expect(closed).toMatch(/<section[^>]*id="good-operation-preorders"[^>]*><\/section>/);
    expect(closed).not.toContain('good-operation-preorders-title');
    const failed = renderPreorder(undefined, {}, <GoodWorkspacePreorderRow title="예약판매" serverError="예약 오류" />);
    expect(failed).toMatch(/id="good-operation-preorders"[^>]*><p[^>]*role="alert">예약 오류<\/p>/);
    const open = renderPreorder(emptyPreorderPlan(), {}, <GoodWorkspacePreorderRow title="예약판매" />);
    expect(open).toMatch(/<section aria-labelledby="good-operation-preorders-title"[^>]*id="good-operation-preorders"/);
    expect(open).toContain('id="good-operation-preorders-title">예약판매</h2>');
    expect(open).toContain('data-good-workspace-preorders=""');
    /* 저장된 상품의 자리는 판매 시기 밖(시험)에서는 열려 있고 '별도 저장'을 밝힌다. */
    const saved = renderToStaticMarkup(<GoodSavedPreorderSection title="예약판매"><i>패널</i></GoodSavedPreorderSection>);
    expect(saved).toContain('data-good-operation-mode="">별도 저장</span>');
    expect(saved).toContain('<i>패널</i>');
  });
  it('판매 시기는 자리 부품의 표식으로 등록 화면 입력과 저장된 상품의 패널을 가린다', () => {
    expect(goodPreorderSlotKind(<GoodWorkspacePreorderRow title="예약판매" />)).toBe('draft');
    expect(goodPreorderSlotKind(<GoodSavedPreorderSection title="예약판매"><i /></GoodSavedPreorderSection>)).toBe('saved');
    expect(goodPreorderSlotKind(<div />)).toBeNull();
    expect(goodPreorderSlotKind(null)).toBeNull();
  });
});
