import { beforeEach, describe, expect, it, vi } from 'vitest';
import AdminSalesSettledPage from './page';

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
  settledScreen: vi.fn(() => null),
  settled: vi.fn(async () => ({ filters: {}, pageSize: 20, rows: [], total: 0 })),
  dispatchOrders: vi.fn(async () => ({ counts: {}, filters: {}, pageSize: 20, rows: [], total: 0 })),
  orders: vi.fn(async () => ({ items: [], filters: {}, pageSize: 20, total: 0 })),
}));

vi.mock('@/components/admin/screens/SettledScreen', () => ({
  SettledScreen: mocks.settledScreen,
}));
vi.mock('@/lib/admin/settled.server', () => ({ getAdminSettledOrders: mocks.settled }));
vi.mock('@/lib/admin/dispatch.server', () => ({ getAdminDispatchOrders: mocks.dispatchOrders }));
vi.mock('@/lib/admin/orders.server', () => ({ getAdminOrderRecords: mocks.orders }));
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

describe('AdminSalesSettledPage', () => {
  beforeEach(() => {
    mocks.authState = {
      isConfigured: true,
      user: { id: '11111111-1111-4111-8111-111111111111', email: 'staff@icons.gg' },
      role: 'staff',
      isStaff: true,
    };
    mocks.settledScreen.mockClear();
    mocks.settled.mockClear();
    mocks.dispatchOrders.mockClear();
    mocks.orders.mockClear();
  });

  it('로그인 전에는 거래확정 경로를 next로 실어 로그인으로 보낸다', async () => {
    mocks.authState = { isConfigured: true, user: null, role: null, isStaff: false };

    await expect(
      AdminSalesSettledPage({ searchParams: Promise.resolve({}) }),
    ).rejects.toThrow('NEXT_REDIRECT:/login?next=%2Fadmin%2Fsales%2Fsettled');
    expect(mocks.settled).not.toHaveBeenCalled();
  });

  it('일반 사용자에게는 주문을 읽기 전에 화면을 감춘다', async () => {
    mocks.authState = {
      isConfigured: true,
      user: { id: '33333333-3333-4333-8333-333333333333', email: 'fan@icons.gg' },
      role: 'user',
      isStaff: false,
    };

    await expect(
      AdminSalesSettledPage({ searchParams: Promise.resolve({}) }),
    ).rejects.toThrow('NEXT_NOT_FOUND');
    expect(mocks.settled).not.toHaveBeenCalled();
  });

  it('searchParams를 정규화해 로더에 넘기고 결과를 그대로 렌더한다', async () => {
    const screen = await AdminSalesSettledPage({
      searchParams: Promise.resolve({ page: '3', to: '2026-08-18', query: 'maple' }),
    });

    expect(mocks.settled).toHaveBeenCalledWith({
      from: null,
      to: '2026-08-18',
      query: 'maple',
      page: 3,
    });
    expect(screen.type).toBe(mocks.settledScreen);
    expect(screen.props).toEqual({
      data: { filters: {}, pageSize: 20, rows: [], total: 0 },
    });
  });

  it('다른 화면의 로더는 부르지 않는다', async () => {
    await AdminSalesSettledPage({ searchParams: Promise.resolve({}) });

    expect(mocks.dispatchOrders).not.toHaveBeenCalled();
    expect(mocks.orders).not.toHaveBeenCalled();
  });
});
