import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Login } from './Login';

const mocks = vi.hoisted(() => ({
  signInState: {} as Record<string, unknown>,
  signUpState: {} as Record<string, unknown>,
  resetState: {} as Record<string, unknown>,
  signIn: vi.fn(),
  signUp: vi.fn(),
  reset: vi.fn(),
}));

vi.mock('@/app/login/actions', () => ({
  signInWithEmailAction: mocks.signIn,
  signUpWithEmailAction: mocks.signUp,
  requestPasswordResetAction: mocks.reset,
}));
vi.mock('react', async () => {
  const actual = await vi.importActual<typeof import('react')>('react');
  return {
    ...actual,
    useActionState: (action: unknown) => {
      if (action === mocks.signIn) return [mocks.signInState, vi.fn(), false];
      if (action === mocks.signUp) return [mocks.signUpState, vi.fn(), false];
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
