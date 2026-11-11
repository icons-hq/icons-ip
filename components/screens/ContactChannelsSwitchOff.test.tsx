import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { Login } from './Login';
import { Onboarding } from './Onboarding';
import { Settings } from './Settings';

/*
 * 연락 수단 확장(1014-005·006 휴대폰 번호 인증, 1014-010 수단별 수신 동의, 1014-014 카카오톡 채널)은 스위치 OFF로
 * 배포한다. 스위치가 꺼져 있으면 화면이 한 글자도 바뀌지 않아야 한다(구현 계약 15).
 *
 * test/fixtures/contact-channels-off/*.html은 이 기능을 넣기 전 코드(origin/main 4fee9fd7)에서 같은 props로 뽑은
 * 렌더 결과다. React useId가 만드는 내부 id(_R_…_)는 훅 수에 따라 바뀌는 값이라 비교 전에 지운다.
 * 이 기준을 갱신해야 한다면 스위치와 무관한 의도된 화면 변경일 때뿐이다.
 */

vi.mock('@/app/login/actions', () => ({
  linkKakaoAccountAction: vi.fn(),
  requestPasswordResetAction: vi.fn(),
  resendSignupCodeAction: vi.fn(),
  signInWithEmailAction: vi.fn(),
  signInWithSocialAction: vi.fn(),
  signUpWithEmailAction: vi.fn(),
  verifySignupCodeAction: vi.fn(),
}));
vi.mock('@/app/settings/actions', () => ({
  checkKakaoChannelRewardAction: vi.fn(),
  requestAccountDeletionAction: vi.fn(),
  updateMarketingConsentAction: vi.fn(),
  updateProfileAction: vi.fn(),
}));
vi.mock('@/app/onboarding/actions', () => ({ completeOnboardingAction: vi.fn(), finishOnboardingAction: vi.fn() }));
vi.mock('@/app/onboarding/phone-actions', () => ({ requestPhoneCodeAction: vi.fn(), verifyPhoneCodeAction: vi.fn() }));
vi.mock('@/lib/profile-upload.client', () => ({ uploadProfileAvatar: vi.fn() }));
vi.mock('react', async () => {
  const actual = await vi.importActual<typeof import('react')>('react');
  return { ...actual, useActionState: () => [{}, vi.fn(), false], useSyncExternalStore: () => null };
});

function golden(name: string) {
  return readFileSync(new URL(`../../test/fixtures/contact-channels-off/${name}.html`, import.meta.url), 'utf8');
}

function withoutReactIds(html: string) {
  return html.replace(/_R_[a-z0-9]+_/g, '_R_id_');
}

function slice(html: string, start: string, end: string) {
  const from = html.indexOf(start);
  const to = html.indexOf(end, from);
  expect(from).toBeGreaterThanOrEqual(0);
  expect(to).toBeGreaterThan(from);
  return html.slice(from, to + end.length);
}

function renderSettings(marketingConsent: React.ComponentProps<typeof Settings>['marketingConsent']) {
  return renderToStaticMarkup(
    <Settings
      accountDeletion={{
        preview: { available: false, eligible: false, blockers: [{ code: 'not_available', count: 1, path: '/settings' }] },
        status: { status: 'not_requested', phase: 'none', nextAction: '/settings', blockers: [] },
      }}
      accountDeletionRequestKey="123e4567-e89b-42d3-a456-426614174000"
      avatarInitial="아"
      avatarUrl={null}
      email="fan@icons.gg"
      isConfigured
      marketingConsent={marketingConsent}
      marketingConsentUnavailable={false}
      nickname="아이콘즈 팬"
    />,
  );
}

describe('연락 수단 스위치 OFF — 화면 불변', () => {
  /* 마이페이지 셸(왼쪽 메뉴)은 이 기능과 무관하게 바뀔 수 있어 비교에서 뺀다 — 설정 본문 전체를 본다. */
  it('설정 화면 본문 전체가 기능 도입 전과 같다', () => {
    const body = (html: string) => html.slice(html.indexOf('<div class="wc-mypage__headbar">'));
    expect(body(golden('settings-full-null')).length).toBeGreaterThan(1000);
    expect(withoutReactIds(body(renderSettings(null)))).toBe(body(golden('settings-full-null')));
  });

  it('설정의 수신 동의 폼이 동의 기록이 있을 때도 도입 전과 같다(이메일·SMS 두 줄)', () => {
    const html = renderSettings({
      marketing: true,
      email: { agreed: true, agreedAt: '2026-10-28T01:00:00.000Z', withdrawnAt: null, noticeVersion: 'marketing-channels-v1', source: 'settings' },
      sms: { agreed: false, agreedAt: null, withdrawnAt: null, noticeVersion: 'marketing-channels-v1', source: 'settings' },
    });

    expect(withoutReactIds(slice(html, '<form aria-labelledby="settings-consent-heading"', '</form>'))).toBe(golden('settings-consent-agreed'));
  });

  it('온보딩의 동의 목록과 안내가 도입 전과 같고 휴대폰 번호 인증 단계가 없다', () => {
    const html = renderToStaticMarkup(
      <Onboarding
        birthDate=""
        email="fan@icons.gg"
        followedIpIds={[]}
        genderEligible
        initialMarketing={{ email: true, sms: false }}
        isConfigured
        next="/"
        recommendedIps={[]}
      />,
    );
    const consents = slice(html, '<ul class="wc-auth__agree">', '</ul>') + slice(html, '<p class="onboarding-consent-note">', '</p>');

    expect(withoutReactIds(consents)).toBe(golden('onboarding-consents'));
    expect(html).not.toContain('data-phone-verification');
    expect(html).not.toContain('휴대폰 번호 인증');
    expect(html).not.toContain('카카오톡');
  });

  it('로그인 화면과 SNS 로그인 버튼이 도입 전과 같다', () => {
    const signin = renderToStaticMarkup(<Login initialMode="signin" isConfigured next="/community?sort=hot" />);
    const signup = renderToStaticMarkup(<Login initialMode="signup" isConfigured next="/community?sort=hot" />);

    expect(withoutReactIds(signin)).toBe(golden('login-signin-full'));
    expect(withoutReactIds(slice(signup, '<div class="wc-auth__social">', '</form></div>'))).toBe(golden('login-signup-social'));
  });
});
