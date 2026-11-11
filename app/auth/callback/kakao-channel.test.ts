import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { signedAuthNextCookieValue } from '@/lib/auth/recovery.server';

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

/* 리뷰 F10 — 설정의 [카카오 계정 연결]에서 시작한 흐름은 결과를 설정 화면으로 돌려보내고, 가입 수단과 무관하게 같은 확인을 탄다. */
describe('GET /auth/callback kakao account link', () => {
  const SECRET = 'test-signup-resend-secret-with-enough-entropy';
  const original = process.env.AUTH_SIGNUP_RESEND_SECRET;

  beforeEach(() => {
    process.env.AUTH_SIGNUP_RESEND_SECRET = SECRET;
    mocks.config = { channelPublicId: '_IconsTest', adminKey: 'x'.repeat(32), couponCode: 'KAKAO-FRIEND' };
    mocks.exchangeCodeForSession.mockClear();
  });
  afterEach(() => {
    if (original === undefined) delete process.env.AUTH_SIGNUP_RESEND_SECRET;
    else process.env.AUTH_SIGNUP_RESEND_SECRET = original;
  });

  function linkCallback(query: string) {
    const cookie = signedAuthNextCookieValue('/settings', 'link', Date.now(), SECRET);
    return GET(new NextRequest(new URL(`/auth/callback?${query}`, 'https://iconsip.com'), {
      headers: { cookie: `icons_auth_next=${cookie}` },
    }));
  }

  function location(response: Response) {
    const url = new URL(response.headers.get('location') ?? 'https://iconsip.com');
    return `${url.pathname}${url.search}`;
  }

  it('returns a linked member to settings and checks the friendship as a settings grant', async () => {
    mocks.getUser.mockResolvedValue({
      data: { user: { id: 'user-1', email: 'fan@icons.gg', identities: [{ provider: 'email' }, { provider: 'kakao' }] } },
      error: null,
    });

    const response = await linkCallback('code=abc');
    expect(location(response)).toBe('/settings?kakao_link=linked');
    await (mocks.after.mock.calls[0][0] as () => Promise<void>)();
    expect(mocks.sync).toHaveBeenCalledWith({ userId: 'user-1', via: 'settings' });
  });

  it.each([
    ['error_code=identity_already_exists&error=server_error', '/settings?kakao_link=identity_taken'],
    ['error=access_denied', '/settings?kakao_link=cancelled'],
    ['error_code=manual_linking_disabled', '/settings?kakao_link=failed'],
    ['', '/settings?kakao_link=failed'],
  ])('returns link failures (%s) to settings instead of the sign-in screen', async (query, expected) => {
    const response = await linkCallback(query);

    expect(location(response)).toBe(expected);
    expect(mocks.exchangeCodeForSession).not.toHaveBeenCalled();
    expect(mocks.after).not.toHaveBeenCalled();
  });

  it('reports a failed exchange or a session without a Kakao identity as a failed link', async () => {
    mocks.exchangeCodeForSession.mockResolvedValueOnce({ data: {}, error: { code: 'flow_state_expired' } });
    expect(location(await linkCallback('code=abc'))).toBe('/settings?kakao_link=failed');

    mocks.getUser.mockResolvedValue({ data: { user: { id: 'user-1', email: 'fan@icons.gg', identities: [{ provider: 'email' }] } }, error: null });
    expect(location(await linkCallback('code=abc'))).toBe('/settings?kakao_link=failed');
    expect(mocks.after).not.toHaveBeenCalled();
  });
});
