import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PasswordRecoveryRequired } from './PasswordRecoveryRequired';

const mocks = vi.hoisted(() => ({
  state: {} as Record<string, unknown>,
  pending: false,
  requestPasswordResetAction: vi.fn(),
  actionPassed: null as unknown,
}));

vi.mock('@/app/login/actions', () => ({
  requestPasswordResetAction: mocks.requestPasswordResetAction,
}));
vi.mock('react', async () => {
  const actual = await vi.importActual<typeof import('react')>('react');
  return {
    ...actual,
    useActionState: (action: unknown) => {
      mocks.actionPassed = action;
      return [mocks.state, vi.fn(), mocks.pending];
    },
  };
});

describe('PasswordRecoveryRequired', () => {
  beforeEach(() => {
    mocks.state = {};
    mocks.pending = false;
    mocks.actionPassed = null;
  });

  it('offers a reset mail to the account email instead of a password form', () => {
    const html = renderToStaticMarkup(
      <PasswordRecoveryRequired email="fan@icons.gg" next="/community?sort=hot" />,
    );

    expect(mocks.actionPassed).toBe(mocks.requestPasswordResetAction);
    expect(html).toContain('재설정 메일의 링크를 연 뒤에만');
    expect(html).toContain('name="email" value="fan@icons.gg"');
    expect(html).toContain('name="next" value="/community?sort=hot"');
    expect(html).toContain('받는 주소: fan@icons.gg');
    expect(html).toContain('재설정 메일 받기');
    expect(html).not.toContain('type="password"');
    expect(html).toContain('href="/community?sort=hot"');
  });

  it('announces the sent message and progress', () => {
    mocks.state = { message: '재설정 메일을 보냈습니다.' };
    const sent = renderToStaticMarkup(<PasswordRecoveryRequired email="fan@icons.gg" next="/" />);
    mocks.state = {};
    mocks.pending = true;
    const pending = renderToStaticMarkup(<PasswordRecoveryRequired email="fan@icons.gg" next="/" />);

    expect(sent).toContain('role="status"');
    expect(sent).toContain('재설정 메일을 보냈습니다.');
    expect(pending).toContain('disabled=""');
    expect(pending).toContain('메일 보내는 중…');
  });

  it('shows the rate-limit or provider error as an alert instead of the sent message', () => {
    mocks.state = {
      message: '보냄',
      errors: { form: '비밀번호 재설정 요청이 너무 많습니다.' },
    };

    const html = renderToStaticMarkup(<PasswordRecoveryRequired email="fan@icons.gg" next="/" />);

    expect(html).toContain('role="alert"');
    expect(html).toContain('요청이 너무 많습니다');
    expect(html).not.toContain('보냄');
  });

  it('does not render a send form for an account without an email', () => {
    const html = renderToStaticMarkup(<PasswordRecoveryRequired email={null} next="/" />);

    expect(html).toContain('계정에 등록된 이메일이 없어');
    expect(html).not.toContain('<form');
  });
});
