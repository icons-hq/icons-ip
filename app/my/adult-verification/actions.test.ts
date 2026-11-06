import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  auth: null as unknown,
  enabled: true,
  begin: vi.fn(),
}));

vi.mock('@/lib/auth/server', () => ({ getCurrentAuthState: async () => mocks.auth }));
vi.mock('@/lib/identity/kcp-cert-config', () => ({ adultVerificationEnabledFor: () => mocks.enabled }));
vi.mock('@/lib/identity/adult-verification.server', async () => {
  class AdultVerificationRateLimitedError extends Error {}
  class AdultVerificationAccountBlockedError extends Error {}
  return {
    AdultVerificationRateLimitedError,
    AdultVerificationAccountBlockedError,
    beginAdultVerification: mocks.begin,
  };
});

import * as identity from '@/lib/identity/adult-verification.server';
import { beginAdultVerificationAction } from './actions';

const USER_ID = '00000000-0000-4000-8000-0000000a1901';
const onboardedProfile = {
  email: 'adult@example.test',
  nickname: 'adult',
  birth_date: '2000-01-01',
  avatar_path: null,
  consents: { terms: true, privacy: true },
  onboarded_at: '2026-10-01T00:00:00Z',
  role: 'user',
  suspended_at: null,
};

describe('beginAdultVerificationAction', () => {
  beforeEach(() => {
    mocks.auth = { isConfigured: true, user: { id: USER_ID, email: 'adult@example.test' }, profile: onboardedProfile, isStaff: false };
    mocks.enabled = true;
    mocks.begin.mockReset();
    mocks.begin.mockResolvedValue({ callUrl: 'https://testcert.kcp.co.kr/certGateway.do', registrationKey: '1234567890123456', pageSubmit: 'N' });
  });

  it('로그인·온보딩을 마친 회원의 인증을 시작하고 인증창 정보만 돌려준다', async () => {
    await expect(beginAdultVerificationAction({ presentation: 'popup', next: '/shop/g1' })).resolves.toEqual({
      ok: true,
      callUrl: 'https://testcert.kcp.co.kr/certGateway.do',
      registrationKey: '1234567890123456',
      pageSubmit: 'N',
    });
    expect(mocks.begin).toHaveBeenCalledWith({ userId: USER_ID, presentation: 'popup', returnPath: '/shop/g1' });
  });

  it('표시 방식이 정해지지 않은 요청은 시작하지 않는다', async () => {
    await expect(beginAdultVerificationAction({ presentation: 'iframe', next: '/my' })).resolves.toEqual({ ok: false, error: 'unavailable' });
    await expect(beginAdultVerificationAction(null)).resolves.toEqual({ ok: false, error: 'unavailable' });
    expect(mocks.begin).not.toHaveBeenCalled();
  });

  it('비로그인·온보딩 미완료·정지·gate 닫힘을 차례로 거절한다', async () => {
    mocks.auth = { isConfigured: true, user: null, profile: null, isStaff: false };
    await expect(beginAdultVerificationAction({ presentation: 'page', next: '/my' })).resolves.toEqual({ ok: false, error: 'login_required' });

    mocks.auth = { isConfigured: true, user: { id: USER_ID, email: 'adult@example.test' }, profile: { ...onboardedProfile, onboarded_at: null }, isStaff: false };
    await expect(beginAdultVerificationAction({ presentation: 'page', next: '/my' })).resolves.toEqual({ ok: false, error: 'onboarding_required' });

    mocks.auth = { isConfigured: true, user: { id: USER_ID, email: 'adult@example.test' }, profile: { ...onboardedProfile, suspended_at: '2026-10-01T00:00:00Z' }, isStaff: false };
    await expect(beginAdultVerificationAction({ presentation: 'page', next: '/my' })).resolves.toEqual({ ok: false, error: 'blocked' });

    mocks.auth = { isConfigured: true, user: { id: USER_ID, email: 'adult@example.test' }, profile: onboardedProfile, isStaff: false };
    mocks.enabled = false;
    await expect(beginAdultVerificationAction({ presentation: 'page', next: '/my' })).resolves.toEqual({ ok: false, error: 'unavailable' });
    expect(mocks.begin).not.toHaveBeenCalled();
  });

  it('한도·정지·장애를 화면 오류 코드로 바꾼다', async () => {
    mocks.begin.mockRejectedValueOnce(new identity.AdultVerificationRateLimitedError());
    await expect(beginAdultVerificationAction({ presentation: 'page', next: '/my' })).resolves.toEqual({ ok: false, error: 'rate_limited' });

    mocks.begin.mockRejectedValueOnce(new identity.AdultVerificationAccountBlockedError());
    await expect(beginAdultVerificationAction({ presentation: 'page', next: '/my' })).resolves.toEqual({ ok: false, error: 'blocked' });

    mocks.begin.mockRejectedValueOnce(new Error('kcp down'));
    await expect(beginAdultVerificationAction({ presentation: 'page', next: '/my' })).resolves.toEqual({ ok: false, error: 'unavailable' });
  });
});
