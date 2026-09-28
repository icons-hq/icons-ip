import { beforeEach, describe, expect, it, vi } from 'vitest';
import { requireAdminActionAccess } from './action-access.server';

const mocks = vi.hoisted(() => ({ auth: vi.fn() }));
vi.mock('@/lib/auth/admin', () => ({ getCurrentAdminAuthState: mocks.auth }));
vi.mock('next/navigation', () => ({ redirect: (path: string) => { throw new Error(`NEXT_REDIRECT:${path}`); } }));
const staff = { isConfigured: true, user: { id: 'staff', email: null }, role: 'staff', isStaff: true };
beforeEach(() => { mocks.auth.mockReset(); mocks.auth.mockResolvedValue(staff); });

describe('admin action access', () => {
  it.each([true, false])('미로그인 호출은 복귀 주소를 보존한다 (configured=%s)', async isConfigured => {
    mocks.auth.mockResolvedValue({ isConfigured, user: null, role: null, isStaff: false });
    await expect(requireAdminActionAccess('/admin/catalog/goods?goodId=g1'))
      .rejects.toThrow('NEXT_REDIRECT:/login?next=%2Fadmin%2Fcatalog%2Fgoods%3FgoodId%3Dg1');
  });
  it('일반 회원과 정지된 운영자는 폼 오류를 만들 수 있는 거절 결과를 받는다', async () => {
    for (const role of ['user', 'staff', 'admin']) {
      mocks.auth.mockResolvedValue({ ...staff, role, isStaff: false });
      expect(await requireAdminActionAccess('/admin')).toBeNull();
    }
  });
  it('staff와 admin 권한 경계를 유지하며 승인된 사용자를 반환한다', async () => {
    expect(await requireAdminActionAccess('/admin')).toEqual(staff);
    expect(await requireAdminActionAccess('/admin', { adminOnly: true })).toBeNull();
    mocks.auth.mockResolvedValue({ ...staff, role: 'admin' });
    expect(await requireAdminActionAccess('/admin', { adminOnly: true })).toMatchObject({ role: 'admin' });
  });
});
