const { legacyOperatorAccessFixture } = await vi.hoisted(() => import('@/lib/admin/access.test-fixtures'));
import { beforeEach, describe, expect, it, vi } from 'vitest';
import AdminSalesSettledPage from './page';

const mocks = vi.hoisted(() => ({
  authState: {
    isConfigured: true,
    user: { id: '11111111-1111-4111-8111-111111111111', email: 'staff@icons.gg' },
    role: 'staff',
    isStaff: true, operatorAccess: legacyOperatorAccessFixture(),
  } as {
    isConfigured: boolean;
    user: { id: string; email: string | null } | null;
    role: 'user' | 'staff' | 'admin' | null;
    isStaff: boolean; operatorAccess?: ReturnType<typeof legacyOperatorAccessFixture>;
  },
  settledScreen: vi.fn(() => null),
  settled: vi.fn(async () => ({ filters: {}, pageSize: 20, rows: [], total: 0 })),
  orders: vi.fn(async () => ({ items: [], filters: {}, pageSize: 20, total: 0 })),
  preview: vi.fn(async () => ({ kind: 'not_found' })),
}));
vi.mock('@/lib/admin/order-preview.server', () => ({ loadAdminOrderPreview: mocks.preview }));
/* 목록과 주문 상세 팝업(S36-075)은 Fragment의 같은 자리에 둔다 — 첫째가 목록, 둘째가 팝업(없으면 null)이다. */
const listOf = (page: unknown) => ((page as { props: { children: unknown[] } }).props.children[0]) as { type: unknown; props: Record<string, unknown> };
const popupOf = (page: unknown) => ((page as { props: { children: unknown[] } }).props.children[1]) as { type: unknown; key?: unknown; props: Record<string, unknown> } | null;

vi.mock('@/components/admin/screens/SettledScreen', () => ({
  SettledScreen: mocks.settledScreen,
}));
vi.mock('@/lib/admin/settled.server', () => ({ getAdminSettledOrders: mocks.settled }));
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
      isStaff: true, operatorAccess: legacyOperatorAccessFixture(),
    };
    mocks.settledScreen.mockClear();
    mocks.settled.mockClear();
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
    expect(popupOf(screen)).toBeNull();
    expect(listOf(screen).type).toBe(mocks.settledScreen);
    expect(listOf(screen).props).toEqual({
      data: { filters: {}, pageSize: 20, rows: [], total: 0 },
      exportRequestId: expect.any(String),
    });
  });

  it('`?orderId=`가 있으면 거래확정 목록 위에 같은 조건으로 돌아가는 주문 상세 팝업을 둔다 (S36-075)', async () => {
    const orderId = '50000000-0000-4000-8000-000000000001';
    const page = await AdminSalesSettledPage({ searchParams: Promise.resolve({ query: 'maple', orderId }) });
    expect(mocks.preview).toHaveBeenCalledWith(expect.objectContaining({ user: mocks.authState.user }), orderId);
    expect(listOf(page).type).toBe(mocks.settledScreen);
    expect(popupOf(page)).toMatchObject({ key: orderId, props: { orderId } });
    expect(String(popupOf(page)!.props.closeHref)).toMatch(/^\/admin\/sales\/settled\?/);
    expect(String(popupOf(page)!.props.closeHref)).not.toContain('orderId');
  });

  it('다른 화면의 로더는 부르지 않는다', async () => {
    await AdminSalesSettledPage({ searchParams: Promise.resolve({}) });

    expect(mocks.orders).not.toHaveBeenCalled();
  });
});
