import { beforeEach, describe, expect, it, vi } from 'vitest';
import AdminSalesOrdersPage from './page';

const mocks = vi.hoisted(() => ({
  authState: {
    isConfigured: true,
    user: { id: '11111111-1111-4111-8111-111111111111', email: 'staff@icons.gg' },
    role: 'staff',
    isStaff: true,
  } as {
    isConfigured: boolean;
    user: { id: string; email: string | null } | null;
    role: 'user' | 'staff' | 'admin' | null;
    isStaff: boolean;
  },
  ordersSection: vi.fn(() => null),
  orders: vi.fn(async () => ({ items: [], filters: {}, pageSize: 20, total: 0 })),
  catalogRecords: vi.fn(async () => ({})),
  curations: vi.fn(async () => []),
  insights: vi.fn(async () => ({})),
  moderation: vi.fn(async () => ({ reports: [] })),
}));

vi.mock('@/components/admin/sections/Orders', () => ({ OrdersSection: mocks.ordersSection }));
vi.mock('@/lib/admin/orders.server', () => ({ getAdminOrderRecords: mocks.orders }));
vi.mock('@/lib/admin/catalog.server', () => ({ getAdminCatalogRecords: mocks.catalogRecords }));
vi.mock('@/lib/admin/curations.server', () => ({ getAdminCurations: mocks.curations }));
vi.mock('@/lib/admin/insights.server', () => ({ getAdminInsights: mocks.insights }));
vi.mock('@/lib/admin/moderation.server', () => ({ getAdminModerationRecords: mocks.moderation }));
vi.mock('@/lib/auth/admin', () => ({
  getCurrentAdminAuthState: vi.fn(async () => mocks.authState),
}));
vi.mock('next/navigation', () => ({
  redirect: (path: string) => {
    throw new Error(`NEXT_REDIRECT:${path}`);
  },
  notFound: () => {
    throw new Error('NEXT_NOT_FOUND');
  },
}));

function staffSession() {
  mocks.authState = {
    isConfigured: true,
    user: { id: '11111111-1111-4111-8111-111111111111', email: 'staff@icons.gg' },
    role: 'staff',
    isStaff: true,
  };
}

describe('AdminSalesOrdersPage', () => {
  beforeEach(() => {
    staffSession();
    for (const mock of Object.values(mocks)) {
      if (typeof mock === 'function' && 'mockClear' in mock) mock.mockClear();
    }
  });

  it('로그인 전에는 주문 경로를 next로 실어 로그인으로 보낸다', async () => {
    mocks.authState = { isConfigured: true, user: null, role: null, isStaff: false };

    await expect(
      AdminSalesOrdersPage({ searchParams: Promise.resolve({}) }),
    ).rejects.toThrow('NEXT_REDIRECT:/login?next=%2Fadmin%2Fsales%2Forders');
    expect(mocks.orders).not.toHaveBeenCalled();
  });

  /* 게이트가 로더보다 먼저여야 한다 — layout redirect는 page 로더를 막지 못한다. */
  it('일반 사용자에게는 주문을 읽기 전에 화면을 감춘다', async () => {
    mocks.authState = {
      isConfigured: true,
      user: { id: '33333333-3333-4333-8333-333333333333', email: 'fan@icons.gg' },
      role: 'user',
      isStaff: false,
    };

    await expect(
      AdminSalesOrdersPage({ searchParams: Promise.resolve({}) }),
    ).rejects.toThrow('NEXT_NOT_FOUND');
    expect(mocks.orders).not.toHaveBeenCalled();
  });

  it('searchParams를 정규화해 주문 로더에 넘기고 결과를 그대로 렌더한다', async () => {
    const screen = await AdminSalesOrdersPage({
      searchParams: Promise.resolve({ status: 'paid', page: '2', query: 'maple fan', section: 'orders' }),
    });

    expect(mocks.orders).toHaveBeenCalledWith(
      { from: null, orderId: null, page: 2, query: 'maple fan', status: 'paid', to: null },
      false,
    );
    expect(screen.type).toBe(mocks.ordersSection);
    expect(screen.props).toEqual({ data: { items: [], filters: {}, pageSize: 20, total: 0 } });
  });

  it('Korpay 수동 복구 요약은 admin 세션에서만 주문 로더에 요청한다', async () => {
    await AdminSalesOrdersPage({ searchParams: Promise.resolve({}) });
    expect(mocks.orders).toHaveBeenLastCalledWith(expect.anything(), false);

    mocks.authState.role = 'admin';
    await AdminSalesOrdersPage({ searchParams: Promise.resolve({}) });
    expect(mocks.orders).toHaveBeenLastCalledWith(expect.anything(), true);
  });

  /* 단일 페이지 시절에는 어느 화면을 열든 17개 로더가 전부 돌았다. */
  it('다른 화면의 로더는 부르지 않는다', async () => {
    await AdminSalesOrdersPage({ searchParams: Promise.resolve({}) });

    expect(mocks.catalogRecords).not.toHaveBeenCalled();
    expect(mocks.curations).not.toHaveBeenCalled();
    expect(mocks.insights).not.toHaveBeenCalled();
    expect(mocks.moderation).not.toHaveBeenCalled();
  });
});
