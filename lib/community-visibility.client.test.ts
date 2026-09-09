import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ rpc: vi.fn() }));

vi.mock('@/lib/supabase/client', () => ({ createClient: () => ({ rpc: mocks.rpc }) }));

import { fetchCommunityStaffPreviewVisible } from './community-visibility.client';

beforeEach(() => {
  mocks.rpc.mockReset();
});

/* 푸터 진입점 readback 은 세컨더리 마켓 시연·카드 리워드 게이트와 같은 계약이다 — 실패는 전부 OFF. */
describe('fetchCommunityStaffPreviewVisible', () => {
  it('is_staff 가 true 일 때만 진입점을 연다', async () => {
    mocks.rpc.mockResolvedValue({ data: true, error: null });
    await expect(fetchCommunityStaffPreviewVisible()).resolves.toBe(true);
    expect(mocks.rpc).toHaveBeenCalledWith('is_staff');
  });

  it('false·오류·예외는 모두 닫힌 상태로 떨어진다', async () => {
    mocks.rpc.mockResolvedValue({ data: false, error: null });
    await expect(fetchCommunityStaffPreviewVisible()).resolves.toBe(false);

    mocks.rpc.mockResolvedValue({ data: true, error: { message: 'denied' } });
    await expect(fetchCommunityStaffPreviewVisible()).resolves.toBe(false);

    mocks.rpc.mockRejectedValue(new Error('network'));
    await expect(fetchCommunityStaffPreviewVisible()).resolves.toBe(false);
  });
});
