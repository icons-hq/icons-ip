import { describe, expect, it } from 'vitest';
import {
  authCallbackUrl,
  authErrorMessage,
  authNextCookieValue,
  authNextPathFromCookie,
  authSignUpErrorMessage,
  isOnboarded,
  nextPathWithSearch,
  safeNextPath,
  type ProfileForOnboarding,
} from './onboarding';

const completeProfile = (overrides: Partial<ProfileForOnboarding> = {}): ProfileForOnboarding => ({
  email: 'fan@icons.gg',
  nickname: 'neonfan',
  birth_date: '2000-01-01',
  consents: {
    terms: true,
    privacy: true,
    marketing: false,
  },
  onboarded_at: '2026-06-22T00:00:00.000Z',
  ...overrides,
});

describe('isOnboarded', () => {
  it('returns false when profile is missing', () => {
    expect(isOnboarded(null)).toBe(false);
  });

  it.each([
    ['email', { email: null }],
    ['nickname', { nickname: '   ' }],
    ['birth date', { birth_date: null }],
    ['onboarded timestamp', { onboarded_at: null }],
    ['terms consent', { consents: { terms: false, privacy: true, marketing: false } }],
    ['privacy consent', { consents: { terms: true, privacy: false, marketing: false } }],
  ])('returns false when %s is missing', (_label, overrides) => {
    expect(isOnboarded(completeProfile(overrides))).toBe(false);
  });

  it('returns false when birth date is in the future', () => {
    expect(isOnboarded(completeProfile({ birth_date: '2999-01-01' }))).toBe(false);
  });

  it('accepts the authenticated user email when the profile email is missing', () => {
    expect(isOnboarded(completeProfile({ email: null }), 'fan@icons.gg')).toBe(true);
  });

  it('returns true when required fields are complete and marketing consent is false', () => {
    expect(isOnboarded(completeProfile())).toBe(true);
  });
});

describe('safeNextPath', () => {
  it('keeps safe relative paths', () => {
    expect(safeNextPath('/community')).toBe('/community');
  });

  it('keeps safe relative paths with query and hash', () => {
    expect(safeNextPath('/community?sort=hot#feed')).toBe('/community?sort=hot#feed');
  });

  it.each([
    'https://evil.example',
    '//evil.example',
    '/\\\\evil.example',
    '/%5C%5Cevil.example',
    '/%2f%2fevil.example',
    '',
    null,
    undefined,
  ])('falls back for unsafe path %s', (value) => {
    expect(safeNextPath(value)).toBe('/');
  });
});

describe('nextPathWithSearch', () => {
  it('returns the pathname when search params are empty', () => {
    expect(nextPathWithSearch('/community', new URLSearchParams())).toBe('/community');
  });

  it('keeps the current query string for auth redirects', () => {
    expect(nextPathWithSearch('/community', new URLSearchParams({ channel: '전체', sort: '인기순' }))).toBe(
      '/community?channel=%EC%A0%84%EC%B2%B4&sort=%EC%9D%B8%EA%B8%B0%EC%88%9C',
    );
  });
});

describe('authCallbackUrl', () => {
  it('builds the exact production auth callback URL allowed by Supabase', () => {
    expect(authCallbackUrl('https://iconsip.com')).toBe('https://iconsip.com/auth/callback');
  });
});

describe('auth next cookie helpers', () => {
  it('round-trips a safe next path for the auth callback cookie', () => {
    const value = authNextCookieValue('/community?sort=hot#feed');

    expect(authNextPathFromCookie(value)).toBe('/community?sort=hot#feed');
  });

  it('falls back to root when the cookie value is unsafe', () => {
    expect(authNextPathFromCookie(authNextCookieValue('https://evil.example'))).toBe('/');
    expect(authNextPathFromCookie('%')).toBe('/');
  });
});

describe('authErrorMessage', () => {
  it.each([
    ['otp_expired', '만료되었거나 이미 사용'],
    ['missing_code', '다시 열어주세요'],
    ['email_address_invalid', '이메일 주소'],
    ['weak_password', '비밀번호'],
    ['over_email_send_rate_limit', '잠시 후'],
    ['over_request_rate_limit', '요청이 너무 많습니다'],
    ['unknown_provider_error', '인증을 완료하지 못했습니다'],
  ])('maps %s to an actionable Korean message', (code, expected) => {
    expect(authErrorMessage(code)).toContain(expected);
  });

  it.each(['flow_state_expired', 'flow_state_not_found', 'bad_code_verifier', 'bad_oauth_callback', 'exchange_failed'])(
    'tells %s (code exchange failure) users their email may already be confirmed and to sign in',
    (code) => {
      const message = authErrorMessage(code);

      expect(message).toContain('이메일 인증은 완료되었을 수 있습니다');
      expect(message).toContain('로그인');
      expect(message).not.toBe(authErrorMessage('otp_expired'));
    },
  );

  it('does not push confirmed users back into repeat sign-up on exchange failure', () => {
    expect(authErrorMessage('exchange_failed')).not.toContain('회원가입');
  });
});

describe('authSignUpErrorMessage', () => {
  it('does not reveal whether an email is already registered', () => {
    const message = authSignUpErrorMessage({ code: 'user_already_exists', message: 'User already registered' });

    expect(message).toContain('가입 요청을 처리하지 못했습니다');
    expect(message).not.toContain('이미 가입');
  });

  it('explains email send rate limits without exposing account existence', () => {
    expect(authSignUpErrorMessage({ code: 'over_email_send_rate_limit' })).toContain('확인 메일 요청이 너무 많습니다');
  });
});
