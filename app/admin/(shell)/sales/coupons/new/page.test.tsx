import { beforeEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ access: vi.fn(), load: vi.fn() }));
vi.mock('@/lib/admin/guard.server', () => ({ requireAdminScreenAccess: mocks.access }));
vi.mock('@/lib/admin/coupons.server', () => ({ getAdminCouponListData: mocks.load }));
vi.mock('@/components/admin/screens/CouponScreen', () => ({ CouponScreen: () => null }));
import Page from './page';
beforeEach(() => { vi.clearAllMocks(); mocks.access.mockResolvedValue({ role: 'staff' }); mocks.load.mockResolvedValue({}); });
it('유효한 단일 등급만 새 쿠폰의 초기값으로 전달하고 복사 조회는 유지한다', async () => {
  expect((await Page({ searchParams: Promise.resolve({ grade: 'gold', copy: 'COPY-1' }) })).props.initialGrade).toBe('gold');
  expect(mocks.load).toHaveBeenCalledWith(expect.objectContaining({ selectedCode: 'COPY-1' }));
  expect((await Page({ searchParams: Promise.resolve({ grade: 'welcome' }) })).props.initialGrade).toBeUndefined();
  expect((await Page({ searchParams: Promise.resolve({ grade: ['gold', 'silver'] }) })).props.initialGrade).toBeUndefined();
});
