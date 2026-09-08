import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ isStaff: false }));

vi.mock('@/lib/auth/admin', () => ({
  getCurrentAdminAuthState: async () => ({ isConfigured: true, user: null, role: null, isStaff: mocks.isStaff }),
}));

import { canViewSecondaryMarketDemo } from './secondary-market-demo.server';

beforeEach(() => {
  mocks.isStaff = false;
});

/* 라우트 서버 게이트 — 어드민 콘솔과 같은 경계(정지되지 않은 staff/admin)만 시연을 본다. */
describe('canViewSecondaryMarketDemo', () => {
  it('일반 회원·비로그인은 시연을 보지 못한다', async () => {
    await expect(canViewSecondaryMarketDemo()).resolves.toBe(false);
  });

  it('staff/admin 은 시연을 본다', async () => {
    mocks.isStaff = true;
    await expect(canViewSecondaryMarketDemo()).resolves.toBe(true);
  });
});
