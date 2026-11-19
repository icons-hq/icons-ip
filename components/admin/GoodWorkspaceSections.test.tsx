import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { emptyGoodsKcModel, goodsKcProductNotApplicableModel } from '@/lib/admin/goods-kc';
import { EMPTY_GOOD_WORKSPACE_SECTIONS, goodWorkspaceKcVariants, goodWorkspaceKcWithTemplate, type GoodWorkspaceSectionsDraft } from '@/lib/admin/good-workspace-sections';
import type { GoodsOptionRow } from '@/lib/admin/goods-option-editor';

/* 등록 화면 KC 카드는 폼 키 밖 provider의 섹션 입력을 그린다. 정적 렌더에서는 provider 상태를 직접 넣는다. */
const workspace = vi.hoisted(() => ({ sections: null as unknown, sectionErrors: {} as Record<string, string> }));
vi.mock('./GoodWorkspace', async () => {
  const actual = await vi.importActual<typeof import('./GoodWorkspace')>('./GoodWorkspace');
  return { ...actual, useGoodWorkspaceSections: () => ({
    sections: workspace.sections, setSections: vi.fn(), optionRows: rows, publishOptionRows: vi.fn(), sectionErrors: workspace.sectionErrors, setSectionErrors: vi.fn(),
    operationId: () => 'op', readKcPanelStash: () => null, rememberKcPanel: vi.fn(), readPanelStash: () => undefined, rememberPanel: vi.fn(),
  }) };
});
vi.mock('@/app/admin/goods-kc-actions', () => ({ readGoodsKcAction: vi.fn(), saveGoodsKcAction: vi.fn(),
  readGoodsOtherCertificationsAction: vi.fn(), saveGoodsOtherCertificationsAction: vi.fn() }));
const rows: GoodsOptionRow[] = [{ name: '기본', code: '', attributes: {}, extraPrice: 0, stockQty: 1 }];
const { GOOD_WORKSPACE_KC_ATTESTATION, GoodWorkspaceKcCard, GoodWorkspacePreorderCard, emptyGoodWorkspacePreorder, goodWorkspacePreorderSummary } = await import('./GoodWorkspaceSections');

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
    expect(html).toContain('기타 인증 <span class="font-normal text-muted-foreground">· 상품과 함께 저장</span>');
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

/* 2026-11-19 사용자·MD 결정: 등록 화면의 예약 조건도 상품을 저장하면 바로 적용된다. 임시저장·승인 근거·권한 구분이 없고, 저장이 막히면 빈 칸 옆에 이유를 보인다. */
describe('등록 화면 예약 조건 카드 — 저장하면 적용', () => {
  const key = goodWorkspaceKcVariants(rows).length ? 'new:[]' : '';
  const renderPreorder = (preorders: GoodWorkspaceSectionsDraft['preorders'], sectionErrors: Record<string, string> = {}) => {
    workspace.sections = { ...EMPTY_GOOD_WORKSPACE_SECTIONS, preorders };
    workspace.sectionErrors = sectionErrors;
    try { return renderToStaticMarkup(<GoodWorkspacePreorderCard />); } finally { workspace.sectionErrors = {}; }
  };
  it('요약은 조건 수와 저장하면 적용된다는 것만 보인다', () => {
    expect(goodWorkspacePreorderSummary([])).toBe('설정안함');
    expect(goodWorkspacePreorderSummary([emptyGoodWorkspacePreorder(key), emptyGoodWorkspacePreorder(key)])).toBe('예약 조건 2개 · 저장하면 적용');
  });
  it('저장 방식 선택·임시저장·승인 근거 칸이 없다', () => {
    const html = renderPreorder([emptyGoodWorkspacePreorder(key)]);
    for (const gone of ['상품을 저장할 때', '임시저장', '승인', '적용 필수', '초안', 'type="radio"', '<textarea']) expect(html).not.toContain(gone);
    expect(html).toContain('상품을 저장하면 바로 예약판매로 적용되고');
    expect(html).not.toContain('data-preorder-field-problem');
  });
  it('저장이 막히면 빈 칸 옆에 이유를 보인다', () => {
    /* 물량은 직접 비운 경우(재고수량을 따라가지 않음). */
    const html = renderPreorder([{ ...emptyGoodWorkspacePreorder(key), capacityFromStock: false }], { workspacePreorders: '예약 조건 1: 예약 물량·접수 시작·접수 종료·발송 예정일 칸을 확인해주세요.' });
    expect(html.match(/data-preorder-field-problem=""/g)).toHaveLength(4);
    expect(html.match(/aria-invalid="true"/g)).toHaveLength(4);
    expect(html).toContain('예약 물량을 입력해주세요.');
  });
  /* 11/19 예약 물량 = 재고수량 — 새 예약 조건의 물량은 옵션 행 재고수량(시험 행 1개)을 따라간다. */
  it('새 예약 조건의 예약 물량은 옵션 재고수량을 따라가고, 다르게 고치면 경고만 보인다', () => {
    const following = renderPreorder([emptyGoodWorkspacePreorder(key)]);
    expect(following).toMatch(/<input[^>]*type="number"[^>]*value="1"/);
    expect(following).toContain('재고수량 1개를 예약 물량으로 씁니다.');
    const differs = renderPreorder([{ ...emptyGoodWorkspacePreorder(key), capacityFromStock: false, capacityQty: '30' }]);
    expect(differs).toMatch(/<input[^>]*type="number"[^>]*value="30"/);
    expect(differs).toContain('재고수량 1개와 다릅니다');
    expect(differs).toContain('재고수량과 같게</button>');
  });
});
