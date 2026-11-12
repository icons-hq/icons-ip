const { configuredOperatorAccessFixture, legacyOperatorAccessFixture } = await vi.hoisted(() => import('@/lib/admin/access.test-fixtures'));
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import Page from './page';

const mocks = vi.hoisted(() => ({
  auth: { isConfigured: true, user: { id: 'staff' }, isStaff: true, operatorAccess: legacyOperatorAccessFixture(), role: 'staff' } as Record<string, unknown>,
  load: vi.fn(),
}));
vi.mock('@/lib/auth/admin', () => ({ getCurrentAdminAuthState: vi.fn(async () => mocks.auth) }));
vi.mock('next/navigation', () => ({
  redirect: (path: string) => { throw new Error(`NEXT_REDIRECT:${path}`); },
  notFound: () => { throw new Error('NEXT_NOT_FOUND'); },
  useRouter: () => ({ refresh: vi.fn() }),
}));
vi.mock('@/lib/admin/erp-items.server', () => ({ loadErpItemsWorkspace: mocks.load }));
vi.mock('@/app/admin/erp-item-actions', () => ({ importErpItemsAction: vi.fn(), readErpItemFileAction: vi.fn(), setErpCategoryMappingAction: vi.fn(), deleteErpItemsAction: vi.fn(),
  previewErpLinkedGoodsAction: vi.fn(), commitErpLinkedGoodsAction: vi.fn() }));

beforeEach(() => {
  mocks.auth = { isConfigured: true, user: { id: 'staff' }, isStaff: true, operatorAccess: legacyOperatorAccessFixture(), role: 'staff' };
  mocks.load.mockReset().mockResolvedValue({
    filters: { query: '키링', page: 1 }, page: { total: 0, items: [] }, erpCategories: [], categories: [], categoryErpMappings: [],
  });
});

describe('ERP 품목 라우트', () => {
  it('미로그인은 ERP 품목 화면으로 돌아오게 하고, 일반 회원에게는 로더를 실행하지 않는다', async () => {
    mocks.auth = { isConfigured: true, user: null, isStaff: false, role: null };
    await expect(Page({ searchParams: Promise.resolve({}) })).rejects.toThrow('NEXT_REDIRECT:/login?next=%2Fadmin%2Fcatalog%2Ferp-items');
    mocks.auth = { isConfigured: true, user: { id: 'member' }, isStaff: false, role: 'user' };
    await expect(Page({ searchParams: Promise.resolve({}) })).rejects.toThrow('NEXT_NOT_FOUND');
    expect(mocks.load).not.toHaveBeenCalled();
  });

  it('운영자는 정리한 검색어·페이지로 화면을 연다', async () => {
    const html = renderToStaticMarkup(await Page({ searchParams: Promise.resolve({ q: ' 키링 ', page: '2' }) }));
    expect(mocks.load).toHaveBeenCalledWith({ query: '키링', page: 2 });
    expect(html).toContain('ERP 품목');
    expect(html).toContain('value="키링"');
  });

  /* 1027T-016(사용자 결정 2026-11-11 "MD 권한"): 부매니저도 상품 관리 권한으로 화면을 열고 반입한다. 삭제는 플랫폼 관리 권한에만 보인다. */
  it('부매니저(MD)는 화면을 열지만 품목 삭제 안내는 보지 않고, 물류출고관리는 열지 못한다', async () => {
    const withItems = { filters: { query: '', page: 1 }, page: { total: 1, items: [
      { code: '000123', name: '아크릴 키링', category: null, salePrice: null, barcode: null, mappedCategoryId: null, importedAt: '2026-10-07T03:00:00Z', updatedAt: '2026-10-07T03:00:00Z' },
    ] }, erpCategories: [], categories: [], categoryErpMappings: [] };
    mocks.load.mockResolvedValue(withItems);
    mocks.auth = { isConfigured: true, user: { id: 'md' }, isStaff: true, operatorAccess: configuredOperatorAccessFixture('deputy'), role: 'staff' };
    const deputy = renderToStaticMarkup(await Page({ searchParams: Promise.resolve({}) }));
    expect(deputy).toContain('id="erp-item-paste"');
    expect(deputy).not.toContain('체크하면 삭제 버튼이 나타납니다');
    mocks.auth = { isConfigured: true, user: { id: 'staff' }, isStaff: true, operatorAccess: legacyOperatorAccessFixture(), role: 'staff' };
    expect(renderToStaticMarkup(await Page({ searchParams: Promise.resolve({}) }))).toContain('체크하면 삭제 버튼이 나타납니다');
    mocks.auth = { isConfigured: true, user: { id: 'logistics' }, isStaff: true, operatorAccess: configuredOperatorAccessFixture('logistics'), role: 'staff' };
    mocks.load.mockClear();
    await expect(Page({ searchParams: Promise.resolve({}) })).rejects.toThrow();
    expect(mocks.load).not.toHaveBeenCalled();
  });
});
