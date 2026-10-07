import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import Page from './page';

const mocks = vi.hoisted(() => ({
  auth: { isConfigured: true, user: { id: 'staff' }, isStaff: true, role: 'staff' } as Record<string, unknown>,
  load: vi.fn(),
}));
vi.mock('@/lib/auth/admin', () => ({ getCurrentAdminAuthState: vi.fn(async () => mocks.auth) }));
vi.mock('next/navigation', () => ({
  redirect: (path: string) => { throw new Error(`NEXT_REDIRECT:${path}`); },
  notFound: () => { throw new Error('NEXT_NOT_FOUND'); },
  useRouter: () => ({ refresh: vi.fn() }),
}));
vi.mock('@/lib/admin/erp-items.server', () => ({ loadErpItemsWorkspace: mocks.load }));
vi.mock('@/app/admin/erp-item-actions', () => ({ importErpItemsAction: vi.fn(), readErpItemFileAction: vi.fn(), setErpCategoryMappingAction: vi.fn(), deleteErpItemsAction: vi.fn() }));

beforeEach(() => {
  mocks.auth = { isConfigured: true, user: { id: 'staff' }, isStaff: true, role: 'staff' };
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
});
