import { beforeEach, describe, expect, it, vi } from 'vitest';
import AdminOrderDetailPage from './page';
const mocks = vi.hoisted(() => ({
  auth: { isConfigured: true, user: { id: 'staff' } as { id: string } | null, isStaff: true, role: 'staff' },
  load: vi.fn(),
}));
vi.mock('@/lib/auth/admin', () => ({ getCurrentAdminAuthState: vi.fn(async () => mocks.auth) }));
vi.mock('@/lib/admin/order-detail.server', () => ({ getAdminOrderDetail: mocks.load }));
vi.mock('@/components/admin/screens/OrderDetailScreen', () => ({ OrderDetailScreen: () => null }));
vi.mock('next/navigation', () => ({
  redirect: (path: string) => { throw new Error(`redirect:${path}`); },
  notFound: () => { throw new Error('not_found'); },
}));
const ORDER = '10000000-0000-4000-8000-000000004141';
const visit = (orderId = ORDER) => AdminOrderDetailPage({ params: Promise.resolve({ orderId }) });
beforeEach(() => {
  mocks.auth.user = { id: 'staff' }; mocks.auth.isStaff = true;
  mocks.load.mockReset().mockResolvedValue({ order: { id: ORDER }, items: [], timeline: [] });
});
describe('정확한 주문 상세 라우트', () => {
  it('일반 회원과 비로그인 사용자는 주문 로딩 전에 차단된다', async () => {
    mocks.auth.isStaff = false;
    await expect(visit()).rejects.toThrow('not_found');
    mocks.auth.user = null;
    await expect(visit()).rejects.toThrow(`redirect:/login?next=${encodeURIComponent(`/admin/sales/orders/${ORDER}`)}`);
    expect(mocks.load).not.toHaveBeenCalled();
  });
  it('정확한 주문만 읽고 없는 주문이나 잘못된 ID는 404로 끝난다', async () => {
    await visit();
    expect(mocks.load).toHaveBeenCalledExactlyOnceWith(ORDER);
    mocks.load.mockResolvedValue(null);
    await expect(visit()).rejects.toThrow('not_found');
    mocks.load.mockClear();
    await expect(visit('not-a-uuid')).rejects.toThrow('not_found');
    expect(mocks.load).not.toHaveBeenCalled();
  });
});
