import { configuredOperatorAccessFixture, legacyOperatorAccessFixture } from '@/lib/admin/access.test-fixtures';
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
  orderItemsScreen: vi.fn(() => null),
  orderItems: vi.fn(async () => ({ rows: [], total: 0 })),
  orders: vi.fn(async () => ({ items: [], filters: {}, pageSize: 20, total: 0 })),
  catalogRecords: vi.fn(async () => ({})),
  curations: vi.fn(async () => []),
  insights: vi.fn(async () => ({})),
  moderation: vi.fn(async () => ({ reports: [] })),
  preview: vi.fn(async () => ({ kind: 'not_found' })),
}));

vi.mock('@/components/admin/sections/Orders', () => ({ OrdersSection: mocks.ordersSection }));
vi.mock('@/lib/admin/order-preview.server', () => ({ loadAdminOrderPreview: mocks.preview }));
/* 목록과 주문 상세 팝업(S36-075)은 Fragment의 같은 자리에 둔다 — 첫째가 목록, 둘째가 팝업(없으면 null)이다. */
const listOf = (page: unknown) => ((page as { props: { children: unknown[] } }).props.children[0]) as { type: unknown; props: Record<string, unknown> };
const popupOf = (page: unknown) => ((page as { props: { children: unknown[] } }).props.children[1]) as { type: unknown; key?: unknown; props: Record<string, unknown> } | null;
vi.mock('@/components/admin/screens/OrderItemsScreen', () => ({ OrderItemsScreen: mocks.orderItemsScreen }));
vi.mock('@/lib/admin/order-items.server', () => ({ getAdminOrderItemData: mocks.orderItems }));
vi.mock('@/lib/admin/orders.server', () => ({ getAdminOrderRecords: mocks.orders }));
vi.mock('@/lib/admin/catalog.server', () => ({ getAdminCatalogRecords: mocks.catalogRecords }));
vi.mock('@/lib/admin/curations.server', () => ({ getAdminCurations: mocks.curations }));
vi.mock('@/lib/admin/insights.server', () => ({ getAdminInsights: mocks.insights }));
vi.mock('@/lib/admin/moderation.server', () => ({ getAdminModerationRecords: mocks.moderation }));
vi.mock('@/lib/auth/admin', () => ({
  getCurrentAdminAuthState: vi.fn(async () => ({ ...mocks.authState, operatorAccess: 'operatorAccess' in mocks.authState && mocks.authState.operatorAccess || legacyOperatorAccessFixture() })),
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
      { field: 'all', from: null, orderId: null, page: 2, query: 'maple fan', status: 'paid', to: null },
      false,
      { canManage: true },
    );
    expect(listOf(screen).type).toBe(mocks.ordersSection);
    expect(listOf(screen).props).toEqual({ canManage: true, data: { items: [], filters: {}, pageSize: 20, total: 0 } });
    expect(popupOf(screen)).toBeNull();
  });

  it('Korpay 수동 복구 요약은 admin 세션에서만 주문 로더에 요청한다', async () => {
    await AdminSalesOrdersPage({ searchParams: Promise.resolve({}) });
    expect(mocks.orders).toHaveBeenLastCalledWith(expect.anything(), false, { canManage: true });

    mocks.authState.role = 'admin';
    await AdminSalesOrdersPage({ searchParams: Promise.resolve({}) });
    expect(mocks.orders).toHaveBeenLastCalledWith(expect.anything(), true, { canManage: true });
  });

  /* 단일 페이지 시절에는 어느 화면을 열든 17개 로더가 전부 돌았다. */
  it('다른 화면의 로더는 부르지 않는다', async () => {
    await AdminSalesOrdersPage({ searchParams: Promise.resolve({}) });

    expect(mocks.catalogRecords).not.toHaveBeenCalled();
    expect(mocks.curations).not.toHaveBeenCalled();
    expect(mocks.insights).not.toHaveBeenCalled();
    expect(mocks.moderation).not.toHaveBeenCalled();
  });
  it('configured influencer enters query-only mode and deputy is refused before loading orders', async () => {
    Object.assign(mocks.authState, { operatorAccess: configuredOperatorAccessFixture('influencer') });
    const screen = await AdminSalesOrdersPage({ searchParams: Promise.resolve({}) });
    expect(mocks.orders).toHaveBeenLastCalledWith(expect.anything(), false, { canManage: false });
    expect(listOf(screen).props.canManage).toBe(false);
    mocks.orders.mockClear();
    Object.assign(mocks.authState, { operatorAccess: configuredOperatorAccessFixture('deputy') });
    await expect(AdminSalesOrdersPage({ searchParams: Promise.resolve({}) })).rejects.toThrow('NEXT_NOT_FOUND');
    expect(mocks.orders).not.toHaveBeenCalled();
  });
});


it('상품주문 보기는 전용 파서·로더만 사용하고 조회 전용 역할에는 쓰기 버튼을 주지 않는다', async () => {
  staffSession(); Object.assign(mocks.authState, { operatorAccess: configuredOperatorAccessFixture('influencer') });
  vi.clearAllMocks();
  const screen = await AdminSalesOrdersPage({ searchParams: Promise.resolve({ view: 'items', field: 'item', query: 'id', page: '2' }) });
  expect(listOf(screen).type).toBe(mocks.orderItemsScreen); expect(listOf(screen).props.canManage).toBe(false);
  expect(mocks.orderItems).toHaveBeenCalledWith(expect.objectContaining({ field: 'item', query: 'id', page: 2 }));
  expect(mocks.orders).not.toHaveBeenCalled();
  Object.assign(mocks.authState, { operatorAccess: configuredOperatorAccessFixture('deputy') });
  vi.clearAllMocks();
  await expect(AdminSalesOrdersPage({ searchParams: Promise.resolve({ view: 'items' }) })).rejects.toThrow('NEXT_NOT_FOUND');
  expect(mocks.orderItems).not.toHaveBeenCalled();
});

it('`?orderId=`가 있으면 주문 목록·상품주문 목록 위에 같은 조건으로 돌아가는 주문 상세 팝업을 둔다 (S36-075)', async () => {
  staffSession();
  const orderId = '50000000-0000-4000-8000-000000000001';
  const orders = await AdminSalesOrdersPage({ searchParams: Promise.resolve({ status: 'paid', page: '2', orderId }) });
  expect(mocks.preview).toHaveBeenCalledWith(expect.objectContaining({ user: mocks.authState.user }), orderId);
  expect(listOf(orders).type).toBe(mocks.ordersSection);
  expect(popupOf(orders)).toMatchObject({ key: orderId, props: { orderId, backLabel: '주문 목록', closeHref: '/admin/sales/orders?status=paid&page=2' } });
  const items = await AdminSalesOrdersPage({ searchParams: Promise.resolve({ view: 'items', orderId }) });
  expect(listOf(items).type).toBe(mocks.orderItemsScreen);
  expect(popupOf(items)?.props).toMatchObject({ backLabel: '상품주문 목록', closeHref: '/admin/sales/orders?page=1&view=items' });
  expect(popupOf(await AdminSalesOrdersPage({ searchParams: Promise.resolve({ orderId: 'x' }) }))).toBeNull();
});
