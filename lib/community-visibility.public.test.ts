import { describe, expect, it, vi } from 'vitest';

/* 공개 스위치를 켠 배포 — 서버 게이트는 staff 판정 없이 모두에게 열리고, 푸터의 "스태프 전용"
 * 블록은 반대로 닫힌다. 그때는 푸터 발견 열에 공개 커뮤니티 링크가 돌아오므로(lib/routes.ts
 * visibleItems) 스태프 전용 표기가 남으면 거짓말이 된다. */
vi.mock('./community-visibility', () => ({
  COMMUNITY_ENABLED: true,
  COMMUNITY_STAFF_PREVIEW_ENABLED: true,
}));
vi.mock('@/lib/auth/admin', () => ({
  getCurrentAdminAuthState: async () => {
    throw new Error('공개 스위치가 켜지면 staff 판정을 읽지 않는다');
  },
}));
vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({ rpc: async () => ({ data: true, error: null }) }),
}));

import { canViewCommunity } from './community-visibility.server';
import { fetchCommunityStaffPreviewVisible } from './community-visibility.client';

describe('COMMUNITY_ENABLED = true', () => {
  it('서버 게이트는 staff 판정 없이 열리고 스태프 전용 진입점은 닫힌다', async () => {
    await expect(canViewCommunity()).resolves.toBe(true);
    await expect(fetchCommunityStaffPreviewVisible()).resolves.toBe(false);
  });
});
