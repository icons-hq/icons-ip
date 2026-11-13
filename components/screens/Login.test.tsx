import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  Login,
  PENDING_SIGNUP_KEY,
  readPendingSignupEmail,
  readSavedLoginEmail,
  saveLoginEmailChoice,
  savePendingSignupEmail,
  SAVED_LOGIN_EMAIL_KEY,
  SignupCodeStep,
  socialKeepSignedInValue,
} from './Login';

const mocks = vi.hoisted(() => ({
  signInState: {} as Record<string, unknown>,
  signUpState: {} as Record<string, unknown>,
  resetState: {} as Record<string, unknown>,
  socialState: {} as Record<string, unknown>,
  verifyCodeState: {} as Record<string, unknown>,
  resendCodeState: {} as Record<string, unknown>,
  signIn: vi.fn(),
  signUp: vi.fn(),
  reset: vi.fn(),
  social: vi.fn(),
  verifyCode: vi.fn(),
  resendCode: vi.fn(),
  savedEmail: null as string | null,
  pendingEmail: null as string | null,
}));

vi.mock('@/app/login/actions', () => ({
  signInWithEmailAction: mocks.signIn,
  signUpWithEmailAction: mocks.signUp,
  requestPasswordResetAction: mocks.reset,
  signInWithSocialAction: mocks.social,
  verifySignupCodeAction: mocks.verifyCode,
  resendSignupCodeAction: mocks.resendCode,
}));
vi.mock('react', async () => {
  const actual = await vi.importActual<typeof import('react')>('react');
  return {
    ...actual,
    useActionState: (action: unknown) => {
      if (action === mocks.signIn) return [mocks.signInState, vi.fn(), false];
      if (action === mocks.signUp) return [mocks.signUpState, vi.fn(), false];
      if (action === mocks.social) return [mocks.socialState, vi.fn(), false];
      if (action === mocks.verifyCode) return [mocks.verifyCodeState, vi.fn(), false];
      if (action === mocks.resendCode) return [mocks.resendCodeState, vi.fn(), false];
      if (action === mocks.reset) return [mocks.resetState, vi.fn(), false];
      throw new Error('Unexpected login action');
    },
    /* 정적 렌더는 서버 스냅샷(null)만 본다 — 이 기기(탭)에 저장된 값을 읽은 클라이언트 렌더를 흉내 낸다. */
    useSyncExternalStore: (_subscribe: unknown, getSnapshot: () => unknown) =>
      getSnapshot.name === 'readPendingSignupEmail' ? mocks.pendingEmail : mocks.savedEmail,
  };
});

function render(overrides: Partial<React.ComponentProps<typeof Login>> = {}) {
  return renderToStaticMarkup(<Login
    initialMode="signin"
    isConfigured
    next="/community?sort=hot"
    {...overrides}
  />);
}

describe('Login', () => {
  beforeEach(() => {
    mocks.signInState = {};
    mocks.signUpState = {};
    mocks.resetState = {};
    mocks.socialState = {};
    mocks.verifyCodeState = {};
    mocks.resendCodeState = {};
    mocks.savedEmail = null;
    mocks.pendingEmail = null;
  });

  it('renders one social form with provider submit values and the preserved next path', () => {
    const html = render();

    expect(html).toContain('name="next" value="/community?sort=hot"');
    expect(html).toMatch(/<button[^>]*(?:name="provider"[^>]*value="google"|value="google"[^>]*name="provider")/);
    expect(html).toMatch(/<button[^>]*(?:name="provider"[^>]*value="apple"|value="apple"[^>]*name="provider")/);
    expect(html).toMatch(/<button[^>]*(?:name="provider"[^>]*value="kakao"|value="kakao"[^>]*name="provider")/);
    expect(html.match(/type="submit"/g)).toHaveLength(4);
  });

  it('disables all auth submits when Supabase is not configured', () => {
    const html = render({ isConfigured: false });

    expect(html.match(/disabled=""/g)).toHaveLength(4);
  });

  it('shows a safe social error and omits social login in reset mode', () => {
    mocks.socialState = {
      errors: { form: '현재 해당 소셜 로그인을 사용할 수 없습니다. 잠시 후 다시 시도해주세요.' },
    };

    expect(render()).toContain('현재 해당 소셜 로그인을 사용할 수 없습니다. 잠시 후 다시 시도해주세요.');
    const resetHtml = render({ initialMode: 'reset' });
    expect(resetHtml).not.toContain('name="provider"');
    expect(resetHtml).not.toContain('Google로 계속하기');
  });

  it('renders password recovery as an actual link that preserves next', () => {
    const html = render();

    expect(html).toContain('비밀번호를 잊으셨나요?');
    expect(html).toContain('href="/login?mode=reset&amp;next=%2Fcommunity%3Fsort%3Dhot"');
    expect(html).not.toContain('<button type="button" class="mono"');
  });

  it('keeps passwords hidden by default and exposes a keyboard-accessible visibility toggle', () => {
    const html = render();

    expect(html).toContain('type="password"');
    expect(html).toContain('aria-label="비밀번호 보기"');
    expect(html).toContain('aria-pressed="false"');
    expect(html).toContain('type="button"');
    expect(html).not.toContain('Caps Lock이 켜져 있어요');
  });

  it('renders reset mode as an email-only form with the exact generic success', () => {
    mocks.resetState = {
      message: '해당 이메일로 가입한 계정이 있다면 재설정 메일을 보냈습니다. 요청한 브라우저에서 최신 링크를 열어주세요.',
    };

    const html = render({ initialMode: 'reset' });

    expect(html).toContain('비밀번호 재설정');
    expect(html).toContain('재설정 메일 받기');
    expect(html).toContain('name="email"');
    expect(html).toContain('autoComplete="email"');
    expect(html).not.toContain('name="password"');
    expect(html).toContain('해당 이메일로 가입한 계정이 있다면 재설정 메일을 보냈습니다. 요청한 브라우저에서 최신 링크를 열어주세요.');
    expect(html).toContain('role="status"');
    expect(html).toContain('로그인으로 돌아가기');
  });

  it('shows reset-specific errors as alerts without signup copy', () => {
    const html = render({
      initialMode: 'reset',
      initialError: '이 브라우저에서 비밀번호 재설정을 완료할 수 없습니다.',
    });

    expect(html).toContain('role="alert"');
    expect(html).toContain('이 브라우저에서 비밀번호 재설정을 완료할 수 없습니다.');
    expect(html).not.toContain('3초면 충분해요');
  });

  it('shows the completed password reset notice on signin', () => {
    const html = render({
      initialMessage: '비밀번호를 변경했습니다. 새 비밀번호로 로그인해주세요.',
    });

    expect(html).toContain('role="status"');
    expect(html).toContain('비밀번호를 변경했습니다. 새 비밀번호로 로그인해주세요.');
  });

  /* AU-02: 재설정 모드에만 소셜 가입 계정 안내 한 줄을 둔다 — 제공자는 로그인 화면의 소셜 버튼과 같은 셋이다. */
  it('tells social-signup members in reset mode that they can sign in with their SNS account', () => {
    const notice = 'Google·카카오·Apple로 가입했다면 재설정 없이 로그인 화면에서 같은 SNS 계정으로 로그인할 수 있어요.';

    expect(render({ initialMode: 'reset' })).toContain(notice);
    expect(render()).not.toContain(notice);
    expect(render({ initialMode: 'signup' })).not.toContain(notice);
    for (const provider of ['Google', '카카오', 'Apple']) {
      expect(render(), provider).toContain(`aria-label="${provider}로 계속하기"`);
    }
  });

  /* CH-13: /login은 전역 헤더 안에서 열린다 — 홈 진입은 헤더 로고가 맡아 패널 위 'ICONS' 홈 링크를 다시 두지 않는다. */
  it('does not repeat a standalone home link above the auth panel', () => {
    const html = render();

    expect(html).not.toContain('wc-auth__step-note');
    expect(html).toMatch(/<div class="wc-auth__panel"><h1 class="wc-auth__title">로그인<\/h1>/);
  });

  it('describes payment confirmation without naming a legacy provider', () => {
    const html = render();

    expect(html).toContain('결제사 승인 확인 후 주문 확정');
    expect(html).not.toContain('토스페이먼츠 안전 결제');
  });
});

/* 체크박스 라벨 하나(<label>…<span>이름</span></label>)를 잘라 낸다 — 로그인 행에는 체크가 둘이다. */
function checkboxLabel(html: string, name: string): string {
  return html.match(new RegExp(`<label>(?:(?!</label>).)*<span>${name}</span></label>`))?.[0] ?? '';
}

/* R29(MD-0004): 로그인 화면(어드민도 같은 /login)에 '이메일 저장'. 이 기기 localStorage 에만 두고,
   세션 유지는 옆의 '로그인 상태 유지'(SHEET-005)가 정한다. */
describe('Login 이메일 저장', () => {
  const checkbox = (html: string) => checkboxLabel(html, '이메일 저장').match(/<input[^>]*>/)?.[0] ?? '';
  const emailInput = (html: string) => html.match(/<input[^>]*name="email"[^>]*>/)?.[0] ?? '';

  it('로그인 모드에만 체크박스를 두고, 저장된 이메일이 없으면 비워 둔다', () => {
    const html = render();
    expect(html).toContain('이메일 저장');
    expect(checkbox(html)).not.toContain('checked');
    expect(checkbox(html)).not.toContain('name=');
    expect(emailInput(html)).not.toContain('value=');
    expect(render({ initialMode: 'signup' })).not.toContain('이메일 저장');
    expect(render({ initialMode: 'reset' })).not.toContain('이메일 저장');
  });

  it('이 기기에 저장한 이메일이 있으면 미리 채우고 체크해 둔다', () => {
    mocks.savedEmail = 'fan@example.test';
    const html = render();
    expect(emailInput(html)).toContain('value="fan@example.test"');
    expect(checkbox(html)).toContain('checked=""');
  });

  /* SHEET-005 — '로그인 상태 유지'는 기본 체크(지금처럼 유지)이고 폼에 keepSignedIn=1 로 실린다. 끄면 세션 쿠키 로그인이다. */
  it("로그인 모드에만 '로그인 상태 유지'를 기본 체크로 두고 폼 값(keepSignedIn=1)으로 보낸다", () => {
    const keep = checkboxLabel(render(), '로그인 상태 유지');
    expect(keep).toContain('type="checkbox"');
    expect(keep).toContain('name="keepSignedIn"');
    expect(keep).toContain('value="1"');
    expect(keep).toContain('checked=""');
    /* 이메일 저장과 같은 행, 그 앞에 둔다. */
    const html = render();
    expect(html.indexOf('로그인 상태 유지')).toBeLessThan(html.indexOf('이메일 저장'));
    expect(html.slice(html.indexOf('wc-auth__agree-row'), html.indexOf('이메일 저장'))).toContain('로그인 상태 유지');
    expect(render({ initialMode: 'signup' })).not.toContain('로그인 상태 유지');
    expect(render({ initialMode: 'reset' })).not.toContain('로그인 상태 유지');
  });

  /* 같은 화면의 소셜 로그인도 이 선택을 따른다(오케스트레이터 결정 11/12) — 소셜 폼이 체크 상태를 숨은 칸으로 함께 보낸다.
     가입 화면에는 체크 칸이 없어 기본값(유지)을 보낸다. */
  it('소셜 로그인 폼이 로그인 상태 유지 선택을 숨은 칸(keepSignedIn)으로 함께 보낸다', () => {
    for (const mode of ['signin', 'signup'] as const) {
      const html = render({ initialMode: mode });
      const start = html.indexOf('wc-auth__social-row');
      expect(start, mode).toBeGreaterThan(-1);
      const social = html.slice(start, html.indexOf('</form>', start));
      expect(social, mode).toMatch(/<input type="hidden" name="keepSignedIn" value="1"\/>/);
    }
  });

  /* 로그인 모드에서 체크를 끈 뒤 [이메일 회원가입]으로 넘어가도 컴포넌트 상태(keepSignedIn=false)가 남는다 — 가입 화면엔 체크 칸이 없으니
     소셜 가입 숨은 칸은 늘 '1'이어야 한다. */
  it('소셜 숨은 칸은 가입 모드에서 체크 상태와 무관하게 늘 1이고, 로그인 모드에서만 체크를 따른다', () => {
    expect(socialKeepSignedInValue(false, true)).toBe('1');
    expect(socialKeepSignedInValue(false, false)).toBe('0');
    expect(socialKeepSignedInValue(true, false)).toBe('1');
    expect(socialKeepSignedInValue(true, true)).toBe('1');
  });

  describe('저장소', () => {
    let store: Map<string, string>;
    beforeEach(() => {
      store = new Map();
      vi.stubGlobal('window', { localStorage: {
        getItem: (key: string) => store.get(key) ?? null,
        setItem: (key: string, value: string) => { store.set(key, value); },
        removeItem: (key: string) => { store.delete(key); },
      }, addEventListener: vi.fn(), removeEventListener: vi.fn() });
    });
    afterEach(() => { vi.unstubAllGlobals(); });

    it('체크하면 다듬은 이메일을 저장하고, 해제하면 지운다', () => {
      saveLoginEmailChoice('  fan@example.test ', true);
      expect(store.get(SAVED_LOGIN_EMAIL_KEY)).toBe('fan@example.test');
      expect(readSavedLoginEmail()).toBe('fan@example.test');
      saveLoginEmailChoice('fan@example.test', false);
      expect(store.has(SAVED_LOGIN_EMAIL_KEY)).toBe(false);
      expect(readSavedLoginEmail()).toBeNull();
    });

    it('이메일 형태가 아니거나 너무 긴 값은 저장하지도 읽지도 않는다', () => {
      saveLoginEmailChoice('not-an-email', true);
      expect(store.has(SAVED_LOGIN_EMAIL_KEY)).toBe(false);
      store.set(SAVED_LOGIN_EMAIL_KEY, `${'a'.repeat(250)}@example.test`);
      expect(readSavedLoginEmail()).toBeNull();
    });

    it('저장소를 쓸 수 없는 브라우저(사생활 보호 모드 등)에서도 던지지 않는다', () => {
      vi.stubGlobal('window', { localStorage: {
        getItem: () => { throw new Error('denied'); },
        setItem: () => { throw new Error('denied'); },
        removeItem: () => { throw new Error('denied'); },
      } });
      expect(() => saveLoginEmailChoice('fan@example.test', true)).not.toThrow();
      expect(() => saveLoginEmailChoice('fan@example.test', false)).not.toThrow();
      expect(readSavedLoginEmail()).toBeNull();
    });
  });
});

/* 1014-004 — 확인 메일 링크를 새 창에서 여는 대신 같은 화면에서 6자리 코드를 입력한다. 링크도 그대로 동작한다. */
describe('Login 가입 확인 코드 단계', () => {
  beforeEach(() => {
    mocks.signInState = {};
    mocks.signUpState = {};
    mocks.resetState = {};
    mocks.socialState = {};
    mocks.verifyCodeState = {};
    mocks.resendCodeState = {};
    mocks.savedEmail = null;
    mocks.pendingEmail = null;
  });

  const sentState = {
    message: '가입 확인 메일을 보냈습니다. 메일에 적힌 6자리 확인 코드를 아래에 입력해주세요.',
    pendingSignupEmail: 'fan@icons.gg',
  };

  it('가입 전에는 코드가 메일로 간다는 사실만 알리고 기존 가입 폼을 그대로 둔다', () => {
    const html = render({ initialMode: 'signup' });

    expect(html).toContain('가입하면 입력한 이메일로 6자리 확인 코드를 보내 드려요.');
    expect(html).toContain('name="password"');
    expect(html).not.toContain('name="code"');
    expect(html).not.toContain('data-signup-code-step');
  });

  it('확인 메일을 보내면 같은 화면에서 코드 입력 단계를 연다', () => {
    mocks.signUpState = sentState;
    const html = render({ initialMode: 'signup' });
    const codeInput = html.match(/<input[^>]*name="code"[^>]*>/)?.[0] ?? '';

    expect(html).toContain('data-signup-code-step');
    expect(html).toContain('<strong>fan@icons.gg</strong>로 확인 메일을 보냈어요.');
    expect(codeInput).toContain('autoComplete="one-time-code"');
    expect(codeInput).toContain('inputMode="numeric"');
    expect(codeInput).toContain('maxLength="6"');
    expect(html.match(/<input type="hidden" name="email" value="fan@icons.gg"\/>/g)).toHaveLength(2);
    expect(html.match(/<input type="hidden" name="next" value="\/community\?sort=hot"\/>/g)).toHaveLength(2);
    expect(html).toContain('role="status"');
    expect(html).toContain(sentState.message);
    expect(html).toContain('확인하고 계속하기');
    expect(html).toContain('코드 다시 받기');
    expect(html).toContain('다른 이메일로 가입하기');
    expect(html).toContain('메일의 확인 버튼을 눌러도 가입을 마칠 수 있어요.');
    /* 단계에서는 비밀번호 폼과 SNS 가입을 접어 코드 입력에 집중한다. */
    expect(html).not.toContain('name="password"');
    expect(html).not.toContain('name="provider"');
    expect(html).not.toContain('가입하면 입력한 이메일로 6자리 확인 코드를 보내 드려요.');
  });

  it('틀린 코드와 다시 받기 결과를 단계 안에서 보여 준다', () => {
    mocks.signUpState = sentState;
    mocks.verifyCodeState = { errors: { code: '확인 코드가 맞지 않거나 만료됐어요.' }, pendingSignupEmail: 'fan@icons.gg' };
    mocks.resendCodeState = { message: '새 확인 메일을 보냈습니다.', pendingSignupEmail: 'fan@icons.gg' };
    const html = render({ initialMode: 'signup' });

    expect(html).toContain('확인 코드가 맞지 않거나 만료됐어요.');
    expect(html).toMatch(/<input[^>]*aria-invalid="true"[^>]*name="code"/);
    expect(html).toContain('새 확인 메일을 보냈습니다.');
    expect(html).not.toContain(sentState.message);
  });

  /* QA1 S-T02-01: 틀린 코드 오류와 초록 '메일을 보냈습니다' 상자가 함께 보였다. */
  it('코드 확인이 실패하면 처음 보낸 안내를 거둔다', () => {
    mocks.signUpState = sentState;
    mocks.verifyCodeState = { errors: { code: '확인 코드가 맞지 않거나 만료됐어요.' }, pendingSignupEmail: 'fan@icons.gg' };
    const html = render({ initialMode: 'signup' });

    expect(html).toContain('확인 코드가 맞지 않거나 만료됐어요.');
    expect(html).not.toContain(sentState.message);
    expect(html).not.toContain('role="status"');
  });

  it('다시 받기 한도에 걸린 가입 제출도 이미 받은 코드를 입력할 수 있게 단계를 연다', () => {
    mocks.signUpState = { errors: { form: '확인 메일 재요청이 너무 많습니다. 10분 후 다시 시도해주세요.' }, pendingSignupEmail: 'fan@icons.gg' };
    const html = render({ initialMode: 'signup' });

    expect(html).toContain('data-signup-code-step');
    expect(html).toContain('role="alert"');
    expect(html).toContain('확인 메일 재요청이 너무 많습니다.');
  });

  it('로그인·재설정 모드는 가입 결과가 남아 있어도 코드 단계를 열지 않는다', () => {
    mocks.signUpState = sentState;

    expect(render()).not.toContain('data-signup-code-step');
    expect(render({ initialMode: 'reset' })).not.toContain('data-signup-code-step');
  });

  /* 리뷰 F5 — 새로고침·메일 앱 왕복 뒤에도 이 탭에 기억한 이메일로 재발송 없이 코드 단계를 다시 연다. */
  it('새로 연 가입 화면은 이 탭에 기억한 이메일로 [받은 코드 입력하기]를 보여 준다', () => {
    mocks.pendingEmail = 'fan@icons.gg';
    const html = render({ initialMode: 'signup' });

    expect(html).toContain('data-signup-code-resume');
    /* QA1 S-T02-02: 작은 한 줄이 아니라 가입 폼 위의 상자와 버튼이다. */
    expect(html).toContain('가입을 이어서 하시겠어요?');
    expect(html).toContain('<strong>fan@icons.gg</strong>로 확인 코드를 보냈어요. 메일의 6자리 코드를 입력하면 가입이 이어져요.');
    expect(html).toMatch(/<button class="wc-btn" type="button">받은 코드 입력하기<\/button>/);
    expect(html.indexOf('data-signup-code-resume')).toBeLessThan(html.indexOf('name="password"'));
    /* 누르기 전에는 가입 폼 그대로다 — 이미 가입을 마친 이메일이어도 새 가입을 막지 않는다. */
    expect(html).toContain('name="password"');
    expect(html).not.toContain('data-signup-code-step');
    expect(mocks.resendCode).not.toHaveBeenCalled();
    expect(mocks.signUp).not.toHaveBeenCalled();
  });

  it('로그인·재설정 모드와 방금 보낸 가입 결과에는 [받은 코드 입력하기]를 두지 않는다', () => {
    mocks.pendingEmail = 'fan@icons.gg';

    expect(render()).not.toContain('data-signup-code-resume');
    expect(render({ initialMode: 'reset' })).not.toContain('data-signup-code-resume');
    mocks.signUpState = sentState;
    const html = render({ initialMode: 'signup' });
    expect(html).toContain('data-signup-code-step="sent"');
    expect(html).not.toContain('data-signup-code-resume');
  });
});

/* 리뷰 F1·F5 — 코드 단계는 비밀번호를 화면에 그리지 않는다. 복원한 단계는 재발송 없이 받은 코드를 받는다. */
describe('SignupCodeStep', () => {
  beforeEach(() => {
    mocks.verifyCodeState = {};
    mocks.resendCodeState = {};
  });

  function renderStep(overrides: Partial<React.ComponentProps<typeof SignupCodeStep>> = {}) {
    return renderToStaticMarkup(<SignupCodeStep
      email="fan@icons.gg"
      isConfigured
      next="/community?sort=hot"
      onChangeEmail={() => undefined}
      password={null}
      restored={false}
      signInHref="/login?mode=signin"
      {...overrides}
    />);
  }

  it('방금 보낸 단계는 화면 메모리의 비밀번호를 마크업에 남기지 않는다', () => {
    const html = renderStep({ password: 'secret-pass-1234' });

    expect(html).toContain('data-signup-code-step="sent"');
    expect(html).not.toContain('secret-pass-1234');
    expect(html).not.toContain('name="password"');
    expect(html).not.toContain('확인을 마치면 로그인 화면으로 이동해요.');
  });

  it('복원한 단계는 재발송 없이 받은 코드를 받고, 확인 뒤 로그인 화면으로 간다고 알린다', () => {
    const html = renderStep({ restored: true });

    expect(html).toContain('data-signup-code-step="restored"');
    expect(html).toContain('<strong>fan@icons.gg</strong>로 보낸 확인 코드를 입력해주세요.');
    expect(html).toContain('코드는 다시 보내지 않았어요. 가장 최근 메일의 6자리를 입력해주세요.');
    expect(html).toContain('확인을 마치면 로그인 화면으로 이동해요. 가입한 이메일과 비밀번호로 로그인해주세요.');
    expect(html).not.toContain('로 확인 메일을 보냈어요.');
    expect(html).toContain('코드 다시 받기');
  });
});

describe('가입 확인 코드 단계 기억(sessionStorage)', () => {
  let store: Map<string, string>;
  beforeEach(() => {
    store = new Map();
    vi.stubGlobal('window', { sessionStorage: {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => { store.set(key, value); },
      removeItem: (key: string) => { store.delete(key); },
    } });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('보낸 이메일만 기억하고(비밀번호 없음) null로 지운다', () => {
    savePendingSignupEmail('  fan@icons.gg ');
    const saved = JSON.parse(store.get(PENDING_SIGNUP_KEY) ?? '{}') as Record<string, unknown>;
    expect(Object.keys(saved).sort()).toEqual(['at', 'email']);
    expect(saved.email).toBe('fan@icons.gg');
    expect(readPendingSignupEmail()).toBe('fan@icons.gg');
    savePendingSignupEmail(null);
    expect(store.has(PENDING_SIGNUP_KEY)).toBe(false);
    expect(readPendingSignupEmail()).toBeNull();
  });

  it('1시간이 지났거나 미래 시각이거나 모양이 틀린 기억은 읽지 않는다', () => {
    const now = 1_800_000_000_000;
    vi.spyOn(Date, 'now').mockReturnValue(now);
    store.set(PENDING_SIGNUP_KEY, JSON.stringify({ email: 'fan@icons.gg', at: now - 60 * 60 * 1000 - 1 }));
    expect(readPendingSignupEmail()).toBeNull();
    store.set(PENDING_SIGNUP_KEY, JSON.stringify({ email: 'fan@icons.gg', at: now - 60 * 60 * 1000 }));
    expect(readPendingSignupEmail()).toBe('fan@icons.gg');
    store.set(PENDING_SIGNUP_KEY, JSON.stringify({ email: 'fan@icons.gg', at: now + 1 }));
    expect(readPendingSignupEmail()).toBeNull();
    store.set(PENDING_SIGNUP_KEY, JSON.stringify({ email: 'not-an-email', at: now }));
    expect(readPendingSignupEmail()).toBeNull();
    store.set(PENDING_SIGNUP_KEY, '{broken');
    expect(readPendingSignupEmail()).toBeNull();
  });

  it('저장소를 쓸 수 없어도 던지지 않는다', () => {
    vi.stubGlobal('window', { sessionStorage: {
      getItem: () => { throw new Error('denied'); },
      setItem: () => { throw new Error('denied'); },
      removeItem: () => { throw new Error('denied'); },
    } });
    expect(() => savePendingSignupEmail('fan@icons.gg')).not.toThrow();
    expect(() => savePendingSignupEmail(null)).not.toThrow();
    expect(readPendingSignupEmail()).toBeNull();
  });
});
