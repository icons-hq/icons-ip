import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

/* 1014-014 — 카카오 로그인 콜백 뒤 채널 친구 추가 쿠폰 확인. 스위치가 꺼져 있으면 아무것도 예약하지 않는다. */

const mocks = vi.hoisted(() => ({
  after: vi.fn(),
  config: null as unknown,
  exchangeCodeForSession: vi.fn(),
  getUser: vi.fn(),
  sync: vi.fn(),
}));

vi.mock('next/server', async () => {
  const actual = await vi.importActual<typeof import('next/server')>('next/server');
  return { ...actual, after: mocks.after };
});
vi.mock('@/lib/kakao/channel-config.server', () => ({ kakaoChannelConfig: () => mocks.config }));
vi.mock('@/lib/kakao/channel-reward.server', async () => {
  const actual = await vi.importActual<typeof import('@/lib/kakao/channel-reward.server')>('@/lib/kakao/channel-reward.server');
  return { ...actual, syncKakaoChannelFriendReward: mocks.sync };
});
vi.mock('@/lib/auth/server', () => ({
  getProfileForUser: async () => ({
    email: 'fan@icons.gg', nickname: 'fan', birth_date: '2000-01-01',
    consents: { terms: true, privacy: true }, onboarded_at: '2026-06-23T00:00:00.000Z',
  }),
}));
vi.mock('@/lib/supabase/config', () => ({
  getSupabaseConfig: () => ({ isConfigured: true, url: 'http://127.0.0.1:54321', key: 'publishable-key' }),
}));
vi.mock('@supabase/ssr', () => ({
  createServerClient: () => ({
    auth: { exchangeCodeForSession: mocks.exchangeCodeForSession, getUser: mocks.getUser, signOut: vi.fn() },
  }),
}));

const { GET } = await import('./route');

function callback() {
  return GET(new NextRequest(new URL('/auth/callback?code=abc', 'https://iconsip.com')));
}

beforeEach(() => {
  mocks.after.mockReset();
  mocks.sync.mockReset();
  mocks.config = null;
  mocks.exchangeCodeForSession.mockResolvedValue({ data: {}, error: null });
  mocks.getUser.mockResolvedValue({
    data: { user: { id: 'user-1', email: 'fan@icons.gg', identities: [{ provider: 'kakao' }] } },
    error: null,
  });
});

describe('GET /auth/callback kakao channel reward', () => {
  it('schedules nothing while the switch is off', async () => {
    const response = await callback();

    expect(response.status).toBe(307);
    expect(mocks.after).not.toHaveBeenCalled();
  });

  it('checks the friendship after the redirect for a member with a Kakao identity', async () => {
    mocks.config = { channelPublicId: '_IconsTest', adminKey: 'x'.repeat(32), couponCode: 'KAKAO-FRIEND' };

    const response = await callback();
    expect(response.status).toBe(307);
    expect(mocks.after).toHaveBeenCalledOnce();
    expect(mocks.sync).not.toHaveBeenCalled();
    await (mocks.after.mock.calls[0][0] as () => Promise<void>)();
    expect(mocks.sync).toHaveBeenCalledWith({ userId: 'user-1', via: 'login' });
  });

  it('does not call Kakao for members without a Kakao identity', async () => {
    mocks.config = { channelPublicId: '_IconsTest', adminKey: 'x'.repeat(32), couponCode: 'KAKAO-FRIEND' };
    mocks.getUser.mockResolvedValue({ data: { user: { id: 'user-1', email: 'fan@icons.gg', identities: [{ provider: 'google' }] } }, error: null });

    await callback();
    expect(mocks.after).not.toHaveBeenCalled();
  });
});
