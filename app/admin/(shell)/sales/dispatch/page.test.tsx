import { beforeEach, describe, expect, it, vi } from 'vitest';
import AdminSalesDispatchPage from './page';

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
  dispatchScreen: vi.fn(() => null),
  dispatchOrders: vi.fn(async () => ({
    counts: { new: 0 },
    filters: {},
    pageSize: 20,
    rows: [],
    total: 0,
  })),
  orders: vi.fn(async () => ({ items: [], filters: {}, pageSize: 20, total: 0 })),
  settled: vi.fn(async () => ({ filters: {}, pageSize: 20, rows: [], total: 0 })),
}));

vi.mock('@/components/admin/screens/DispatchScreen', () => ({
  DispatchScreen: mocks.dispatchScreen,
}));
vi.mock('@/lib/admin/dispatch.server', () => ({ getAdminDispatchOrders: mocks.dispatchOrders }));
vi.mock('@/lib/admin/orders.server', () => ({ getAdminOrderRecords: mocks.orders }));
vi.mock('@/lib/admin/settled.server', () => ({ getAdminSettledOrders: mocks.settled }));
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

describe('AdminSalesDispatchPage', () => {
  beforeEach(() => {
    mocks.authState = {
      isConfigured: true,
      user: { id: '11111111-1111-4111-8111-111111111111', email: 'staff@icons.gg' },
      role: 'staff',
      isStaff: true,
    };
    mocks.dispatchScreen.mockClear();
    mocks.dispatchOrders.mockClear();
    mocks.orders.mockClear();
    mocks.settled.mockClear();
  });

  it('로그인 전에는 발주 경로를 next로 실어 로그인으로 보낸다', async () => {
    mocks.authState = { isConfigured: true, user: null, role: null, isStaff: false };

    await expect(
      AdminSalesDispatchPage({ searchParams: Promise.resolve({}) }),
    ).rejects.toThrow('NEXT_REDIRECT:/login?next=%2Fadmin%2Fsales%2Fdispatch');
    expect(mocks.dispatchOrders).not.toHaveBeenCalled();
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
      AdminSalesDispatchPage({ searchParams: Promise.resolve({}) }),
    ).rejects.toThrow('NEXT_NOT_FOUND');
    expect(mocks.dispatchOrders).not.toHaveBeenCalled();
  });

  it('searchParams를 정규화해 로더에 넘기고 결과를 그대로 렌더한다', async () => {
    const screen = await AdminSalesDispatchPage({
      searchParams: Promise.resolve({ tab: 'nope', page: '2', query: 'maple', from: '2026-08-01' }),
    });

    expect(mocks.dispatchOrders).toHaveBeenCalledWith({
      tab: 'new',
      from: '2026-08-01',
      to: null,
      query: 'maple',
      page: 2,
    });
    expect(screen.type).toBe(mocks.dispatchScreen);
    expect(screen.props).toEqual({
      data: { counts: { new: 0 }, filters: {}, pageSize: 20, rows: [], total: 0 },
    });
  });

  it('다른 화면의 로더는 부르지 않는다', async () => {
    await AdminSalesDispatchPage({ searchParams: Promise.resolve({}) });

    expect(mocks.orders).not.toHaveBeenCalled();
    expect(mocks.settled).not.toHaveBeenCalled();
  });
});
