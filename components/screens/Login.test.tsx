import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Login } from './Login';

const mocks = vi.hoisted(() => ({
  signInState: {} as Record<string, unknown>,
  signUpState: {} as Record<string, unknown>,
  resetState: {} as Record<string, unknown>,
  socialState: {} as Record<string, unknown>,
  signIn: vi.fn(),
  signUp: vi.fn(),
  reset: vi.fn(),
  social: vi.fn(),
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
  };
});

function render(overrides: Partial<React.ComponentProps<typeof Login>> = {}) {
  return renderToStaticMarkup(<Login
    initialMode="signin"
    isConfigured
    next="/community?sort=hot"
    panelCards={[]}
    {...overrides}
  />);
}

describe('Login', () => {
  beforeEach(() => {
    mocks.signInState = {};
    mocks.signUpState = {};
    mocks.resetState = {};
    mocks.socialState = {};
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
});
