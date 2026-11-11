const { legacyOperatorAccessFixture } = await vi.hoisted(() => import('@/lib/admin/access.test-fixtures'));
import { beforeEach, describe, expect, it, vi } from 'vitest';
import AdminSalesDispatchPage from './page';

const mocks = vi.hoisted(() => ({
  authState: { isConfigured: true, user: { id: '11111111-1111-4111-8111-111111111111', email: 'staff@icons.gg' }, role: 'staff', isStaff: true, operatorAccess: legacyOperatorAccessFixture() } as {
    isConfigured: boolean; user: { id: string; email: string | null } | null; role: 'user' | 'staff' | 'admin' | null; isStaff: boolean; operatorAccess?: ReturnType<typeof legacyOperatorAccessFixture>;
  },
  screen: vi.fn(() => null),
  autoPanel: vi.fn(() => null),
  forcedPanel: vi.fn(() => null),
  load: vi.fn(),
  loadAuto: vi.fn(),
  preview: vi.fn(),
}));
vi.mock('@/lib/admin/order-preview.server', () => ({ loadAdminOrderPreview: mocks.preview }));
vi.mock('@/components/admin/screens/ShipmentConsoleScreen', () => ({ ShipmentConsoleScreen: mocks.screen }));
vi.mock('@/components/admin/screens/AutoOrderConfirmPanel', () => ({ AutoOrderConfirmPanel: mocks.autoPanel }));
vi.mock('@/components/admin/screens/ForcedDeliveryPanel', () => ({ ForcedDeliveryPanel: mocks.forcedPanel }));
vi.mock('@/lib/admin/shipment-dispatch.server', () => ({ getShipmentConsoleData: mocks.load }));
vi.mock('@/lib/admin/auto-order-confirmation.server', () => ({ getAutoOrderConfirmation: mocks.loadAuto }));
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
  mocks.authState = { isConfigured: true, user: { id: '11111111-1111-4111-8111-111111111111', email: 'staff@icons.gg' }, role: 'staff', isStaff: true, operatorAccess: legacyOperatorAccessFixture() };
});
describe('AdminSalesDispatchPage shipment contract', () => {
  it('로그인 전에는 이 화면을 next로 전달하며 배송 정보를 읽지 않는다', async () => {
    mocks.authState = { isConfigured: true, user: null, role: null, isStaff: false };
    await expect(AdminSalesDispatchPage({ searchParams: Promise.resolve({}) })).rejects.toThrow('NEXT_REDIRECT:/login?next=%2Fadmin%2Fsales%2Fdispatch');
    expect(mocks.load).not.toHaveBeenCalled();
    expect(mocks.loadAuto).not.toHaveBeenCalled();
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
    const [list, panel] = children(screen as Element);
    expect(panel.type).toBe(mocks.autoPanel);
    expect(panel.props.initial).toEqual(autoState);
    expect(list.type).toBe(mocks.screen);
    expect(list.props.data).toEqual(await mocks.load.mock.results[0].value);
  });
  /* 처리할 주문 표가 첫 화면에 오도록 설정 카드는 표 아래에 둔다. 켜짐·꺼짐은 표 위 단계 이름 줄에서 읽는다(사람 눈 판정 — 표가 첫 화면에 1건만 보였다). */
  /* 1014-083: 환경과 관계없이 배송 처리 권한자에게 강제 배송완료(사유·확인창·감사)를 목록 아래에 둔다. 스테이징 확인을 거치지 않는다. */
  it('자동 발주확인 패널을 목록 아래에 두고, 배송 처리 권한자에게 강제 배송완료를 놓는다', async () => {
    const shown = children(await AdminSalesDispatchPage({ searchParams: Promise.resolve({}) }) as Element);
    expect(shown.map(child => child.type)).toEqual([mocks.screen, mocks.autoPanel, mocks.forcedPanel]);
    expect(shown[0].props.summaryAside).toBeTruthy();
  });
  /* 저장 뒤 revalidatePath로 다시 그릴 때 key가 바뀌면 패널이 새로 마운트돼 저장 결과 문구와 포커스가 사라진다. */
  it('자동 발주확인 패널은 설정 revision·실행 기록이 바뀌어도 같은 자리에 남는다', async () => {
    const [, before] = children(await AdminSalesDispatchPage({ searchParams: Promise.resolve({}) }) as Element) as (Element & { key: unknown })[];
    mocks.loadAuto.mockResolvedValue({ ...autoState, revision: 2, lastRun: { runDate: '2026-10-27', cutoffAt: '2026-10-27T07:30:00Z', startedAt: '2026-10-27T07:30:30Z',
      finishedAt: '2026-10-27T07:30:31Z', confirmedCount: 1, excludedCount: 0 } });
    const [, after] = children(await AdminSalesDispatchPage({ searchParams: Promise.resolve({}) }) as Element) as (Element & { key: unknown })[];
    expect(before.type).toBe(mocks.autoPanel);
    expect(before.key).toBeNull();
    expect(after.key).toBe(before.key);
    expect((after.props.initial as { revision: number }).revision).toBe(2);
  });
  /* S36-075: 주문번호를 누르면 같은 목록 위 팝업. 목록·자동 발주확인·강제 배송완료의 자리는 그대로라 팝업을 열고 닫아도 다시 마운트되지 않는다. */
  it('`?orderId=`가 있으면 목록 아래 같은 자리 뒤에 주문 상세 팝업을 두고, 닫으면 같은 조건의 목록으로 돌아간다', async () => {
    const orderId = '50000000-0000-4000-8000-000000000001';
    mocks.preview.mockResolvedValue({ kind: 'not_found' });
    const shown = children(await AdminSalesDispatchPage({ searchParams: Promise.resolve({ tab: 'ready', orderId }) }) as Element);
    expect(mocks.preview).toHaveBeenCalledWith(mocks.authState, orderId);
    expect(shown.slice(0, 3).map(child => child.type)).toEqual([mocks.screen, mocks.autoPanel, mocks.forcedPanel]);
    expect(shown[3].props).toMatchObject({ orderId, closeHref: '/admin/sales/dispatch?tab=ready&page=1' });
  });
  it('자동 발주확인 설정을 읽지 못해도 발주 목록은 그대로 연다', async () => {
    mocks.loadAuto.mockResolvedValue(null);
    const [list, panel] = children(await AdminSalesDispatchPage({ searchParams: Promise.resolve({}) }) as Element);
    expect(panel.props.initial).toBeNull();
    expect(list.type).toBe(mocks.screen);
  });
  it('출고지 필터를 보존하면서 잘못된 페이지는 첫 100건 범위로 되돌린다', async () => {
    await AdminSalesDispatchPage({ searchParams: Promise.resolve({ originId: 'ABCDEF00-0000-4000-8000-000000000001', page: '21474838' }) });
    expect(mocks.load).toHaveBeenCalledWith({ tab: 'new', originId: 'abcdef00-0000-4000-8000-000000000001', from: null, to: null, query: '', page: 1 }, 'dispatch');
  });
});
