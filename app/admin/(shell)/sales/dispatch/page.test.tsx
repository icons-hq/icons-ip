const { legacyOperatorAccessFixture } = await vi.hoisted(() => import('@/lib/admin/access.test-fixtures'));
import { beforeEach, describe, expect, it, vi } from 'vitest';
import AdminSalesDispatchPage from './page';

const mocks = vi.hoisted(() => ({
  authState: { isConfigured: true, user: { id: '11111111-1111-4111-8111-111111111111', email: 'staff@icons.gg' }, role: 'staff', isStaff: true, operatorAccess: legacyOperatorAccessFixture() } as {
    isConfigured: boolean; user: { id: string; email: string | null } | null; role: 'user' | 'staff' | 'admin' | null; isStaff: boolean; operatorAccess?: ReturnType<typeof legacyOperatorAccessFixture>;
  },
  screen: vi.fn(() => null),
  autoPanel: vi.fn(() => null),
  stagingPanel: vi.fn(() => null),
  load: vi.fn(),
  loadAuto: vi.fn(),
  stagingAvailable: vi.fn(),
}));
vi.mock('@/components/admin/screens/ShipmentConsoleScreen', () => ({ ShipmentConsoleScreen: mocks.screen }));
vi.mock('@/components/admin/screens/AutoOrderConfirmPanel', () => ({ AutoOrderConfirmPanel: mocks.autoPanel }));
vi.mock('@/components/admin/screens/StagingTestDeliveryPanel', () => ({ StagingTestDeliveryPanel: mocks.stagingPanel }));
vi.mock('@/lib/admin/shipment-dispatch.server', () => ({ getShipmentConsoleData: mocks.load }));
vi.mock('@/lib/admin/auto-order-confirmation.server', () => ({ getAutoOrderConfirmation: mocks.loadAuto }));
vi.mock('@/lib/admin/staging-test-tools.server', () => ({ stagingTestDeliveryAvailable: mocks.stagingAvailable }));
vi.mock('@/lib/auth/admin', () => ({ getCurrentAdminAuthState: vi.fn(async () => mocks.authState) }));
vi.mock('next/navigation', () => ({
  redirect: (path: string) => { throw new Error(`NEXT_REDIRECT:${path}`); },
  notFound: () => { throw new Error('NEXT_NOT_FOUND'); },
}));

const autoState = { revision: 1, enabled: true, runTime: '16:30', enabledAt: '2026-10-27T00:00:00Z', updatedAt: '2026-10-27T00:00:00Z',
  nextRunAt: '2026-10-27T07:30:00Z', lastRun: null, lastExclusions: [] };
type Element = { type: unknown; props: Record<string, unknown> };
const children = (element: Element) => (element.props.children as unknown[]).filter(Boolean) as Element[];

beforeEach(() => {
  vi.clearAllMocks();
  mocks.load.mockResolvedValue({ counts: { new: 0, ready: 0, delayed: 0, transit: 0, delivered: 0 }, filters: {}, pageSize: 100, rows: [], total: 0, origins: [], carriers: [] });
  mocks.loadAuto.mockResolvedValue(autoState);
  mocks.stagingAvailable.mockResolvedValue(false);
  mocks.authState = { isConfigured: true, user: { id: '11111111-1111-4111-8111-111111111111', email: 'staff@icons.gg' }, role: 'staff', isStaff: true, operatorAccess: legacyOperatorAccessFixture() };
});
describe('AdminSalesDispatchPage shipment contract', () => {
  it('로그인 전에는 이 화면을 next로 전달하며 배송 정보를 읽지 않는다', async () => {
    mocks.authState = { isConfigured: true, user: null, role: null, isStaff: false };
    await expect(AdminSalesDispatchPage({ searchParams: Promise.resolve({}) })).rejects.toThrow('NEXT_REDIRECT:/login?next=%2Fadmin%2Fsales%2Fdispatch');
    expect(mocks.load).not.toHaveBeenCalled();
    expect(mocks.loadAuto).not.toHaveBeenCalled();
    expect(mocks.stagingAvailable).not.toHaveBeenCalled();
  });
  it('일반 사용자는 loader 실행 전에 차단한다', async () => {
    mocks.authState.role = 'user'; mocks.authState.isStaff = false;
    await expect(AdminSalesDispatchPage({ searchParams: Promise.resolve({}) })).rejects.toThrow('NEXT_NOT_FOUND');
    expect(mocks.load).not.toHaveBeenCalled();
    expect(mocks.loadAuto).not.toHaveBeenCalled();
  });
  it('화면별 탭과 날짜·검색·페이지를 정규화하여 배송 건 loader에 전달한다', async () => {
    const screen = await AdminSalesDispatchPage({ searchParams: Promise.resolve({ tab: 'nope', page: '2', query: 'maple', from: '2026-08-01' }) });
    expect(mocks.load).toHaveBeenCalledExactlyOnceWith({ tab: 'new', originId: null, from: '2026-08-01', to: null, query: 'maple', page: 2 }, 'dispatch');
    const [panel, list] = children(screen as Element);
    expect(panel.type).toBe(mocks.autoPanel);
    expect(panel.props.initial).toEqual(autoState);
    expect(list.type).toBe(mocks.screen);
    expect(list.props.data).toEqual(await mocks.load.mock.results[0].value);
  });
  it('자동 발주확인 패널을 목록 위에 두고, 스테이징 확인이 통과할 때만 테스트 배송완료를 놓는다', async () => {
    const hidden = children(await AdminSalesDispatchPage({ searchParams: Promise.resolve({}) }) as Element);
    expect(hidden.map(child => child.type)).toEqual([mocks.autoPanel, mocks.screen]);
    mocks.stagingAvailable.mockResolvedValue(true);
    const shown = children(await AdminSalesDispatchPage({ searchParams: Promise.resolve({}) }) as Element);
    expect(shown.map(child => child.type)).toEqual([mocks.autoPanel, mocks.stagingPanel, mocks.screen]);
  });
  it('자동 발주확인 설정을 읽지 못해도 발주 목록은 그대로 연다', async () => {
    mocks.loadAuto.mockResolvedValue(null);
    const [panel, list] = children(await AdminSalesDispatchPage({ searchParams: Promise.resolve({}) }) as Element);
    expect(panel.props.initial).toBeNull();
    expect(list.type).toBe(mocks.screen);
  });
  it('출고지 필터를 보존하면서 잘못된 페이지는 첫 100건 범위로 되돌린다', async () => {
    await AdminSalesDispatchPage({ searchParams: Promise.resolve({ originId: 'ABCDEF00-0000-4000-8000-000000000001', page: '21474838' }) });
    expect(mocks.load).toHaveBeenCalledWith({ tab: 'new', originId: 'abcdef00-0000-4000-8000-000000000001', from: null, to: null, query: '', page: 1 }, 'dispatch');
  });
});
