import { describe, expect, it, vi } from 'vitest';

/* 킬스위치 계약 — 상수 하나가 서버 게이트와 푸터 readback 을 함께 닫아야 한다.
 * staff 판정과 RPC 가 모두 참이어도 스위치가 꺼지면 어느 쪽도 열리지 않는다. */
vi.mock('./secondary-market-demo', () => ({ SECONDARY_MARKET_DEMO_ENABLED: false }));
vi.mock('@/lib/auth/admin', () => ({
  getCurrentAdminAuthState: async () => ({ isConfigured: true, user: null, role: 'admin', isStaff: true }),
}));
vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({ rpc: async () => ({ data: true, error: null }) }),
}));

import { canViewSecondaryMarketDemo } from './secondary-market-demo.server';
import { fetchSecondaryMarketDemoVisible } from './secondary-market-demo.client';

describe('SECONDARY_MARKET_DEMO_ENABLED = false', () => {
  it('서버 게이트와 푸터 readback 이 함께 닫힌다', async () => {
    await expect(canViewSecondaryMarketDemo()).resolves.toBe(false);
    await expect(fetchSecondaryMarketDemoVisible()).resolves.toBe(false);
  });
});
