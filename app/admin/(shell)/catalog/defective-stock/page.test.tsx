import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { configuredOperatorAccessFixture } from '@/lib/admin/access.test-fixtures';
import Page from './page';

const mocks = vi.hoisted(() => ({ auth: {} as Record<string, unknown>, list: vi.fn() }));
vi.mock('@/lib/auth/admin', () => ({ getCurrentAdminAuthState: vi.fn(async () => mocks.auth) }));
vi.mock('next/navigation', () => ({
  redirect: (path: string) => { throw new Error(`NEXT_REDIRECT:${path}`); },
  notFound: () => { throw new Error('NEXT_NOT_FOUND'); },
}));
vi.mock('@/lib/admin/defective-stock.server', () => ({ loadDefectiveStockList: mocks.list }));

const staff = (role: Parameters<typeof configuredOperatorAccessFixture>[0]) => ({
  isConfigured: true, user: { id: 'staff' }, isStaff: true, role: 'staff', operatorAccess: configuredOperatorAccessFixture(role),
});

beforeEach(() => {
  mocks.auth = staff('primary');
  mocks.list.mockReset().mockResolvedValue({ variants: [], entries: [], pending: [] });
});

describe('불량 재고 라우트', () => {
  it('미로그인·재고 권한 없는 매니저에게는 목록을 읽지 않는다(재고 대조와 같은 기준)', async () => {
    mocks.auth = { isConfigured: true, user: null, isStaff: false, role: null };
    await expect(Page()).rejects.toThrow('NEXT_REDIRECT:/login?next=%2Fadmin%2Fcatalog%2Fdefective-stock');
    mocks.auth = staff('logistics');
    await expect(Page()).rejects.toThrow('NEXT_NOT_FOUND');
    expect(mocks.list).not.toHaveBeenCalled();
  });

  it('재고 권한이 있는 매니저는 화면을 본다', async () => {
    const html = renderToStaticMarkup(await Page());
    expect(mocks.list).toHaveBeenCalledOnce();
    expect(html).toContain('data-admin-screen="defective-stock"');
  });
});
