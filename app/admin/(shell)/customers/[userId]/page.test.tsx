import { beforeEach, describe, expect, it, vi } from 'vitest';
import AdminCustomerDetailPage from './page';
const mocks = vi.hoisted(() => ({ auth: { isConfigured: true, user: { id: 'staff' }, isStaff: true, role: 'staff' }, load: vi.fn() }));
vi.mock('@/lib/auth/admin', () => ({ getCurrentAdminAuthState: async () => mocks.auth }));
vi.mock('@/lib/admin/customer-detail.server', () => ({ getAdminCustomerDetail: mocks.load }));
vi.mock('@/components/admin/screens/CustomerDetailScreen', () => ({ CustomerDetailScreen: () => null }));
vi.mock('next/navigation', () => ({ notFound: () => { throw new Error('not_found'); }, redirect: (path: string) => { throw new Error(`redirect:${path}`); } }));
const ID = '00000000-0000-4000-8000-000000004301';
const visit = (userId = ID) => AdminCustomerDetailPage({ params: Promise.resolve({ userId }), searchParams: Promise.resolve({ tab: 'claims', page: '2' }) });
beforeEach(() => { mocks.auth.isStaff = true; mocks.load.mockReset().mockResolvedValue({ customer: { id: ID } }); });
describe('고객 상세 라우트', () => {
  it('일반 회원을 로딩 전에 차단하고 없는 고객은 404로 끝난다', async () => {
    mocks.auth.isStaff = false;
    await expect(visit()).rejects.toThrow('not_found'); expect(mocks.load).not.toHaveBeenCalled();
    mocks.auth.isStaff = true; mocks.load.mockResolvedValue(null);
    await expect(visit()).rejects.toThrow('not_found');
  });
  it('ID와 목록 페이지를 정확히 전달하고 잘못된 ID는 조회하지 않는다', async () => {
    await visit(); expect(mocks.load).toHaveBeenCalledExactlyOnceWith(ID, { tab: 'claims', page: 2 });
    mocks.load.mockClear(); await expect(visit('invalid')).rejects.toThrow('not_found'); expect(mocks.load).not.toHaveBeenCalled();
  });
});
