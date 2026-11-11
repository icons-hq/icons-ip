import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Onboarding } from './Onboarding';
import { PhoneVerificationPanel, type PhoneVerificationPanelView } from './OnboardingPhoneVerification';

const mocks = vi.hoisted(() => ({
  requestState: {} as Record<string, unknown>,
  verifyState: {} as Record<string, unknown>,
  request: vi.fn(),
  verify: vi.fn(),
}));

vi.mock('@/app/onboarding/phone-actions', () => ({
  requestPhoneCodeAction: mocks.request,
  verifyPhoneCodeAction: mocks.verify,
}));
vi.mock('@/app/onboarding/actions', () => ({ completeOnboardingAction: vi.fn() }));
vi.mock('react', async () => {
  const actual = await vi.importActual<typeof import('react')>('react');
  return {
    ...actual,
    useActionState: (action: unknown) => {
      if (action === mocks.request) return [mocks.requestState, vi.fn(), false];
      if (action === mocks.verify) return [mocks.verifyState, vi.fn(), false];
      return [{}, vi.fn(), false];
    },
  };
});

const CHALLENGE_ID = '33333333-3333-4333-8333-333333333333';
const VIEW: PhoneVerificationPanelView = {
  countries: [{ iso: 'KR', label: '대한민국 (+82)' }, { iso: 'JP', label: '일본 (+81)' }],
  defaultCountry: 'KR',
  verified: null,
};

function render(view: PhoneVerificationPanelView = VIEW, context: 'onboarding' | 'settings' = 'onboarding') {
  return renderToStaticMarkup(<PhoneVerificationPanel context={context} isConfigured view={view} />);
}

beforeEach(() => {
  mocks.requestState = {};
  mocks.verifyState = {};
});

describe('PhoneVerificationPanel (1014-005·006, 스위치 ON)', () => {
  it('starts with country and phone entry, marked required in onboarding', () => {
    const html = render();

    expect(html).toContain('data-phone-verification="phone"');
    expect(html).toContain('휴대폰 번호 인증 <em class="wc-auth__req">필수</em>');
    expect(html).toContain('해외 번호도 인증할 수 있어요');
    expect(html).toMatch(/<select[^>]*name="phoneCountry"/);
    expect(html).toContain('<option value="JP">일본 (+81)</option>');
    const phoneInput = html.match(/<input[^>]*name="phone"[^>]*>/)?.[0] ?? '';
    expect(phoneInput).toContain('autoComplete="tel-national"');
    expect(phoneInput).toContain('type="tel"');
    expect(phoneInput).toContain('inputMode="tel"');
    expect(html).toContain('인증번호 받기');
  });

  it('hides the country picker when only one country is open', () => {
    const html = render({ ...VIEW, countries: [{ iso: 'KR', label: '대한민국 (+82)' }] });
    expect(html).not.toContain('<select');
    expect(html).toContain('<input type="hidden" name="phoneCountry" value="KR"/>');
  });

  it('moves to the code stage after a code is sent', () => {
    mocks.requestState = { stage: 'code_sent', challengeId: CHALLENGE_ID, maskedPhone: '010-****-5678', message: '010-****-5678로 인증번호를 보냈어요. 5분 안에 입력해주세요.' };
    const html = render();

    expect(html).toContain('data-phone-verification="code"');
    expect(html).toContain(`<input type="hidden" name="challengeId" value="${CHALLENGE_ID}"/>`);
    const codeInput = html.match(/<input[^>]*name="code"[^>]*>/)?.[0] ?? '';
    expect(codeInput).toContain('autoComplete="one-time-code"');
    expect(codeInput).toContain('inputMode="numeric"');
    expect(codeInput).toContain('maxLength="6"');
    expect(html).toContain('010-****-5678로 인증번호를 보냈어요.');
    expect(html).toContain('인증번호 확인');
    expect(html).not.toContain('name="phone"');
  });

  it('shows a wrong-code error in the code stage but ignores results of an older challenge', () => {
    mocks.requestState = { stage: 'code_sent', challengeId: CHALLENGE_ID, maskedPhone: '010-****-5678' };
    mocks.verifyState = { stage: 'code_sent', challengeId: CHALLENGE_ID, errors: { code: '인증번호가 맞지 않아요. 4번 더 입력할 수 있어요.' } };
    expect(render()).toContain('인증번호가 맞지 않아요. 4번 더 입력할 수 있어요.');

    mocks.verifyState = { stage: 'verified', challengeId: '44444444-4444-4444-8444-444444444444', maskedPhone: '010-****-0000' };
    const html = render();
    expect(html).toContain('data-phone-verification="code"');
    expect(html).not.toContain('010-****-0000');
  });

  it('returns to phone entry with the reason when the challenge is over', () => {
    mocks.requestState = { stage: 'code_sent', challengeId: CHALLENGE_ID, maskedPhone: '010-****-5678' };
    mocks.verifyState = { challengeId: CHALLENGE_ID, restart: true, errors: { form: '인증번호를 여러 번 틀렸어요. 인증번호를 다시 받아주세요.' } };
    const html = render();

    expect(html).toContain('data-phone-verification="phone"');
    expect(html).toContain('role="alert"');
    expect(html).toContain('인증번호를 여러 번 틀렸어요.');
  });

  it('shows the verified number right after verification and for a member who already verified', () => {
    mocks.requestState = { stage: 'code_sent', challengeId: CHALLENGE_ID, maskedPhone: '010-****-5678' };
    mocks.verifyState = { stage: 'verified', challengeId: CHALLENGE_ID, maskedPhone: '010-****-5678', message: '휴대폰 번호를 인증했어요.' };
    expect(render()).toContain('휴대폰 번호를 인증했어요. 인증된 번호 010-****-5678');

    mocks.requestState = {};
    mocks.verifyState = {};
    const html = render({ ...VIEW, verified: { maskedPhone: '010-****-1111' } }, 'settings');
    expect(html).toContain('data-phone-verification="verified"');
    expect(html).toContain('<h2 class="wc-mypage__subtitle" id="settings-phone-verification-title">휴대폰 번호</h2>');
    expect(html).toContain('인증된 번호 010-****-1111');
    expect(html).toContain('다른 번호로 바꾸기');
  });

  it('is placed before the onboarding form when the switch is on', () => {
    const html = renderToStaticMarkup(
      <Onboarding
        birthDate=""
        email="fan@icons.gg"
        followedIpIds={[]}
        genderEligible
        initialMarketing={{ email: false, sms: false }}
        isConfigured
        next="/"
        phoneVerification={VIEW}
        recommendedIps={[]}
      />,
    );

    expect(html.indexOf('data-phone-verification')).toBeGreaterThan(-1);
    expect(html.indexOf('data-phone-verification')).toBeLessThan(html.indexOf('data-onboarding-form'));
  });
});
