import { beforeEach, describe, expect, it, vi } from 'vitest';
import AdminSalesDispatchPage from './page';

const mocks = vi.hoisted(() => ({
  authState: { isConfigured: true, user: { id: '11111111-1111-4111-8111-111111111111', email: 'staff@icons.gg' }, role: 'staff', isStaff: true } as {
    isConfigured: boolean; user: { id: string; email: string | null } | null; role: 'user' | 'staff' | 'admin' | null; isStaff: boolean;
  },
  screen: vi.fn(() => null),
  load: vi.fn(),
}));
vi.mock('@/components/admin/screens/ShipmentConsoleScreen', () => ({ ShipmentConsoleScreen: mocks.screen }));
vi.mock('@/lib/admin/shipment-dispatch.server', () => ({ getShipmentConsoleData: mocks.load }));
vi.mock('@/lib/auth/admin', () => ({ getCurrentAdminAuthState: vi.fn(async () => mocks.authState) }));
vi.mock('next/navigation', () => ({
  redirect: (path: string) => { throw new Error(`NEXT_REDIRECT:${path}`); },
  notFound: () => { throw new Error('NEXT_NOT_FOUND'); },
}));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.load.mockResolvedValue({ counts: { new: 0, ready: 0, delayed: 0, transit: 0, delivered: 0 }, filters: {}, pageSize: 100, rows: [], total: 0, origins: [], carriers: [] });
  mocks.authState = { isConfigured: true, user: { id: '11111111-1111-4111-8111-111111111111', email: 'staff@icons.gg' }, role: 'staff', isStaff: true };
});
describe('AdminSalesDispatchPage shipment contract', () => {
  it('로그인 전에는 이 화면을 next로 전달하며 배송 정보를 읽지 않는다', async () => {
    mocks.authState = { isConfigured: true, user: null, role: null, isStaff: false };
    await expect(AdminSalesDispatchPage({ searchParams: Promise.resolve({}) })).rejects.toThrow('NEXT_REDIRECT:/login?next=%2Fadmin%2Fsales%2Fdispatch');
    expect(mocks.load).not.toHaveBeenCalled();
  });
  it('일반 사용자는 loader 실행 전에 차단한다', async () => {
    mocks.authState.role = 'user'; mocks.authState.isStaff = false;
    await expect(AdminSalesDispatchPage({ searchParams: Promise.resolve({}) })).rejects.toThrow('NEXT_NOT_FOUND');
    expect(mocks.load).not.toHaveBeenCalled();
  });
  it('화면별 탭과 날짜·검색·페이지를 정규화하여 배송 건 loader에 전달한다', async () => {
    const screen = await AdminSalesDispatchPage({ searchParams: Promise.resolve({ tab: 'nope', page: '2', query: 'maple', from: '2026-08-01' }) });
    expect(mocks.load).toHaveBeenCalledExactlyOnceWith({ tab: 'new', originId: null, from: '2026-08-01', to: null, query: 'maple', page: 2 }, 'dispatch');
    expect(screen.type).toBe(mocks.screen);
    expect(screen.props.data).toEqual(await mocks.load.mock.results[0].value);
  });
  it('출고지 필터를 보존하면서 잘못된 페이지는 첫 100건 범위로 되돌린다', async () => {
    await AdminSalesDispatchPage({ searchParams: Promise.resolve({ originId: 'ABCDEF00-0000-4000-8000-000000000001', page: '21474838' }) });
    expect(mocks.load).toHaveBeenCalledWith({ tab: 'new', originId: 'abcdef00-0000-4000-8000-000000000001', from: null, to: null, query: '', page: 1 }, 'dispatch');
  });
});
