import { beforeEach, describe, expect, it, vi } from 'vitest';
import { requireAdminScreenAccess } from './guard.server';

type AuthState = {
  isConfigured: boolean;
  user: { id: string; email: string | null } | null;
  role: 'user' | 'staff' | 'admin' | null;
  isStaff: boolean;
};

const staff: AuthState = {
  isConfigured: true,
  user: { id: '11111111-1111-4111-8111-111111111111', email: 'staff@icons.gg' },
  role: 'staff',
  isStaff: true,
};

const mocks = vi.hoisted(() => ({ getAuth: vi.fn() }));

vi.mock('@/lib/auth/admin', () => ({ getCurrentAdminAuthState: mocks.getAuth }));
vi.mock('next/navigation', () => ({
  redirect: (path: string) => {
    throw new Error(`NEXT_REDIRECT:${path}`);
  },
  notFound: () => {
    throw new Error('NEXT_NOT_FOUND');
  },
}));

function setAuth(state: AuthState) {
  mocks.getAuth.mockImplementation(async () => state);
}

describe('requireAdminScreenAccess', () => {
  beforeEach(() => {
    mocks.getAuth.mockReset();
    setAuth(staff);
  });

  /* 로그인 후 원래 보려던 화면으로 돌아가야 한다. next 를 /admin 으로 고정하면
   * 깊은 링크를 타고 온 운영자가 매번 개요에서 다시 찾아 들어가야 한다. */
  it('미인증은 원래 경로를 next로 담아 로그인으로 보낸다', async () => {
    setAuth({ isConfigured: true, user: null, role: null, isStaff: false });

    await expect(requireAdminScreenAccess('/admin/sales/orders')).rejects.toThrow(
      'NEXT_REDIRECT:/login?next=%2Fadmin%2Fsales%2Forders',
    );
  });

  it('Supabase 미설정도 로그인으로 보낸다', async () => {
    setAuth({ isConfigured: false, user: null, role: null, isStaff: false });

    await expect(requireAdminScreenAccess('/admin')).rejects.toThrow('NEXT_REDIRECT:/login?next=%2Fadmin');
  });

  /* 비스태프에게는 화면의 존재 자체를 숨긴다 — 403 이 아니라 404 다. */
  it('비스태프는 404로 막는다', async () => {
    setAuth({
      isConfigured: true,
      user: { id: '33333333-3333-4333-8333-333333333333', email: 'fan@icons.gg' },
      role: 'user',
      isStaff: false,
    });

    await expect(requireAdminScreenAccess('/admin')).rejects.toThrow('NEXT_NOT_FOUND');
  });

  it('adminOnly 화면은 staff에게도 404다', async () => {
    await expect(
      requireAdminScreenAccess('/admin/community/roles', { adminOnly: true }),
    ).rejects.toThrow('NEXT_NOT_FOUND');
  });

  it('admin은 adminOnly 화면을 통과한다', async () => {
    setAuth({ ...staff, role: 'admin' });

    const auth = await requireAdminScreenAccess('/admin/community/roles', { adminOnly: true });

    expect(auth.role).toBe('admin');
    expect(auth.user.id).toBe('11111111-1111-4111-8111-111111111111');
  });

  it('staff는 일반 화면을 통과한다', async () => {
    const auth = await requireAdminScreenAccess('/admin/catalog/goods');

    expect(auth.isStaff).toBe(true);
  });
});
