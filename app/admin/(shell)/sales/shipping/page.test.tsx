import { beforeEach, describe, expect, it, vi } from 'vitest';
import AdminSalesShippingPage from './page';

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
  shippingScreen: vi.fn(() => null),
  shippingOrders: vi.fn(async () => ({
    counts: { transit: 0, delivered: 0 },
    filters: {},
    pageSize: 20,
    rows: [],
    total: 0,
  })),
  dispatchOrders: vi.fn(async () => ({ counts: {}, filters: {}, pageSize: 20, rows: [], total: 0 })),
}));

vi.mock('@/components/admin/screens/ShippingScreen', () => ({
  ShippingScreen: mocks.shippingScreen,
}));
vi.mock('@/lib/admin/shipping.server', () => ({ getAdminShippingOrders: mocks.shippingOrders }));
vi.mock('@/lib/admin/dispatch.server', () => ({ getAdminDispatchOrders: mocks.dispatchOrders }));
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

describe('AdminSalesShippingPage', () => {
  beforeEach(() => {
    mocks.authState = {
      isConfigured: true,
      user: { id: '11111111-1111-4111-8111-111111111111', email: 'staff@icons.gg' },
      role: 'staff',
      isStaff: true,
    };
    mocks.shippingScreen.mockClear();
    mocks.shippingOrders.mockClear();
    mocks.dispatchOrders.mockClear();
  });

  it('로그인 전에는 배송현황 경로를 next로 실어 로그인으로 보낸다', async () => {
    mocks.authState = { isConfigured: true, user: null, role: null, isStaff: false };

    await expect(
      AdminSalesShippingPage({ searchParams: Promise.resolve({}) }),
    ).rejects.toThrow('NEXT_REDIRECT:/login?next=%2Fadmin%2Fsales%2Fshipping');
    expect(mocks.shippingOrders).not.toHaveBeenCalled();
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
      AdminSalesShippingPage({ searchParams: Promise.resolve({}) }),
    ).rejects.toThrow('NEXT_NOT_FOUND');
    expect(mocks.shippingOrders).not.toHaveBeenCalled();
  });

  it('searchParams를 정규화해 로더에 넘기고 결과를 그대로 렌더한다', async () => {
    const screen = await AdminSalesShippingPage({
      searchParams: Promise.resolve({ tab: 'nope', page: '2', query: 'maple', from: '2026-08-01' }),
    });

    expect(mocks.shippingOrders).toHaveBeenCalledWith({
      tab: 'transit',
      from: '2026-08-01',
      to: null,
      query: 'maple',
      page: 2,
    });
    expect(screen.type).toBe(mocks.shippingScreen);
  });

  it('다른 화면의 로더는 부르지 않는다', async () => {
    await AdminSalesShippingPage({ searchParams: Promise.resolve({}) });

    expect(mocks.dispatchOrders).not.toHaveBeenCalled();
  });
});
