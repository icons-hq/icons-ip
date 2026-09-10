import { beforeEach, describe, expect, it, vi } from 'vitest';
import AdminOrderDetailPage from './page';
const mocks = vi.hoisted(() => ({
  auth: { isConfigured: true, user: { id: 'staff' } as { id: string } | null, isStaff: true, role: 'staff' },
  load: vi.fn(),
}));
vi.mock('@/lib/auth/admin', () => ({ getCurrentAdminAuthState: vi.fn(async () => mocks.auth) }));
vi.mock('@/lib/admin/order-detail.server', () => ({ getAdminOrderDetail: mocks.load }));
vi.mock('@/components/admin/screens/OrderDetailScreen', () => ({
  OrderDetailScreen: () => null,
}));
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

  it('목록 문맥을 검증한 뒤 상세 화면에 안전한 back 링크를 전달한다', async () => {
    const screen = await AdminOrderDetailPage({
      params: Promise.resolve({ orderId: ORDER }),
      searchParams: Promise.resolve({
        back: `/admin/sales/orders?status=shipping&field=tracking&query=ABC&page=3&order=${ORDER}`,
      }),
    });

    expect(screen).toMatchObject({ props: expect.objectContaining({
      backHref: `/admin/sales/orders?status=shipping&query=ABC&field=tracking&page=3&order=${ORDER}`,
      backLabel: '주문 목록',
    }) });
  });

  it('외부 back 주소는 주문 목록 기본 경로로 접는다', async () => {
    const screen = await AdminOrderDetailPage({
      params: Promise.resolve({ orderId: ORDER }),
      searchParams: Promise.resolve({ back: 'https://evil.example/steal' }),
    });

    expect(screen).toMatchObject({ props: expect.objectContaining({
      backHref: '/admin/sales/orders',
      backLabel: '주문 목록',
    }) });
  });

  it('거래확정 목록에서 온 상세는 해당 목록과 라벨로 돌아간다', async () => {
    const screen = await AdminOrderDetailPage({
      params: Promise.resolve({ orderId: ORDER }),
      searchParams: Promise.resolve({
        back: '/admin/sales/settled?to=2026-09-10&query=buyer&page=2',
      }),
    });

    expect(screen).toMatchObject({ props: expect.objectContaining({
      backHref: '/admin/sales/settled?to=2026-09-10&query=buyer&page=2',
      backLabel: '거래확정 목록',
    }) });
  });
});
