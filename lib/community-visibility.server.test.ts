import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ isStaff: false }));

vi.mock('@/lib/auth/admin', () => ({
  getCurrentAdminAuthState: async () => ({ isConfigured: true, user: null, role: null, isStaff: mocks.isStaff }),
}));

import { canViewCommunity } from './community-visibility.server';

beforeEach(() => {
  mocks.isStaff = false;
});

/* 라우트·서버 액션이 공유하는 열람 게이트 — 어드민 콘솔과 같은 경계(정지되지 않은 staff/admin)만
   임시 비공개 커뮤니티를 본다. 공개 스위치를 켠 배포의 동작은 switch 테스트가 따로 잠근다. */
describe('canViewCommunity', () => {
  it('일반 회원·비로그인은 커뮤니티를 보지 못한다', async () => {
    await expect(canViewCommunity()).resolves.toBe(false);
  });

  it('staff/admin 은 커뮤니티를 본다', async () => {
    mocks.isStaff = true;
    await expect(canViewCommunity()).resolves.toBe(true);
  });
});
