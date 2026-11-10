import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Login, readSavedLoginEmail, saveLoginEmailChoice, SAVED_LOGIN_EMAIL_KEY } from './Login';

const mocks = vi.hoisted(() => ({
  signInState: {} as Record<string, unknown>,
  signUpState: {} as Record<string, unknown>,
  resetState: {} as Record<string, unknown>,
  socialState: {} as Record<string, unknown>,
  signIn: vi.fn(),
  signUp: vi.fn(),
  reset: vi.fn(),
  social: vi.fn(),
  savedEmail: null as string | null,
}));

vi.mock('@/app/login/actions', () => ({
  signInWithEmailAction: mocks.signIn,
  signUpWithEmailAction: mocks.signUp,
  requestPasswordResetAction: mocks.reset,
  signInWithSocialAction: mocks.social,
}));
vi.mock('react', async () => {
  const actual = await vi.importActual<typeof import('react')>('react');
  return {
    ...actual,
    useActionState: (action: unknown) => {
      if (action === mocks.signIn) return [mocks.signInState, vi.fn(), false];
      if (action === mocks.signUp) return [mocks.signUpState, vi.fn(), false];
      if (action === mocks.social) return [mocks.socialState, vi.fn(), false];
      return [mocks.resetState, vi.fn(), false];
    },
    /* 정적 렌더는 서버 스냅샷(null)만 본다 — 이 기기에 저장된 이메일을 읽은 클라이언트 렌더를 흉내 낸다. */
    useSyncExternalStore: () => mocks.savedEmail,
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
    mocks.savedEmail = null;
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

/* R29(MD-0004): 로그인 화면(어드민도 같은 /login)에 '이메일 저장'. 이 기기 localStorage 에만 두고,
   세션은 이미 @supabase/ssr 기본 쿠키(400일)로 유지된다. */
describe('Login 이메일 저장', () => {
  const checkbox = (html: string) => html.match(/<input[^>]*type="checkbox"[^>]*>/)?.[0] ?? '';
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
