import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { emptyGoodsKcModel, goodsKcProductNotApplicableModel } from '@/lib/admin/goods-kc';
import { EMPTY_GOOD_WORKSPACE_SECTIONS, goodWorkspaceKcVariants, goodWorkspaceKcWithTemplate, type GoodWorkspaceSectionsDraft } from '@/lib/admin/good-workspace-sections';
import type { GoodsOptionRow } from '@/lib/admin/goods-option-editor';

/* 등록 화면 KC 카드는 폼 키 밖 provider의 섹션 입력을 그린다. 정적 렌더에서는 provider 상태를 직접 넣는다. */
const workspace = vi.hoisted(() => ({ sections: null as unknown }));
vi.mock('./GoodWorkspace', async () => {
  const actual = await vi.importActual<typeof import('./GoodWorkspace')>('./GoodWorkspace');
  return { ...actual, useGoodWorkspaceSections: () => ({
    sections: workspace.sections, setSections: vi.fn(), optionRows: rows, publishOptionRows: vi.fn(), sectionErrors: {}, setSectionErrors: vi.fn(),
    operationId: () => 'op', readKcPanelStash: () => null, rememberKcPanel: vi.fn(), readPanelStash: () => undefined, rememberPanel: vi.fn(),
  }) };
});
vi.mock('@/app/admin/goods-kc-actions', () => ({ readGoodsKcAction: vi.fn(), saveGoodsKcAction: vi.fn(),
  readGoodsOtherCertificationsAction: vi.fn(), saveGoodsOtherCertificationsAction: vi.fn() }));
const rows: GoodsOptionRow[] = [{ name: '기본', code: '', attributes: {}, extraPrice: 0, stockQty: 1 }];
const { GOOD_WORKSPACE_KC_ATTESTATION, GoodWorkspaceKcCard } = await import('./GoodWorkspaceSections');

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
