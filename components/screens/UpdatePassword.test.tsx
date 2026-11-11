import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { UpdatePassword } from './UpdatePassword';

const mocks = vi.hoisted(() => ({
  state: {} as Record<string, unknown>,
  action: vi.fn(),
  pending: false,
  recoveryRequiredProps: null as Record<string, unknown> | null,
  socialNoticeProps: null as Record<string, unknown> | null,
}));

vi.mock('@/app/update-password/actions', () => ({
  updatePasswordAction: mocks.action,
}));
vi.mock('@/components/screens/PasswordRecoveryRequired', () => ({
  PasswordRecoveryRequired: (props: Record<string, unknown>) => {
    mocks.recoveryRequiredProps = props;
    return <p>recovery-required</p>;
  },
}));
vi.mock('@/components/screens/SocialAccountPasswordNotice', () => ({
  SocialAccountPasswordNotice: (props: Record<string, unknown>) => {
    mocks.socialNoticeProps = props;
    return <p>social-account</p>;
  },
}));
vi.mock('react', async () => {
  const actual = await vi.importActual<typeof import('react')>('react');
  return {
    ...actual,
    useActionState: () => [mocks.state, vi.fn(), mocks.pending],
  };
});

describe('UpdatePassword', () => {
  beforeEach(() => {
    mocks.state = {};
    mocks.pending = false;
    mocks.recoveryRequiredProps = null;
    mocks.socialNoticeProps = null;
  });

  it('renders labeled new-password fields and a safe hidden next value', () => {
    const html = renderToStaticMarkup(<UpdatePassword email="fan@icons.gg" next="/community?sort=hot" />);

    expect(html).toContain('새 비밀번호');
    expect(html).toContain('새 비밀번호 확인');
    expect(html).toContain('name="password"');
    expect(html).toContain('name="passwordConfirmation"');
    expect(html.match(/autoComplete="new-password"/g)).toHaveLength(2);
    expect(html).toContain('name="next" value="/community?sort=hot"');
    expect(html).toContain('비밀번호 변경하기');
  });

  it('connects field and form errors to accessible alert markup', () => {
    mocks.state = {
      errors: {
        password: '비밀번호 오류',
        passwordConfirmation: '확인 오류',
        form: '세션 오류',
      },
    };

    const html = renderToStaticMarkup(<UpdatePassword email="fan@icons.gg" next="/" />);

    expect(html).toContain('aria-invalid="true"');
    expect(html).toContain('비밀번호 오류');
    expect(html).toContain('확인 오류');
    expect(html).toContain('role="alert"');
    expect(html).toContain('세션 오류');
  });

  it('disables submission and announces progress while pending', () => {
    mocks.pending = true;

    const html = renderToStaticMarkup(<UpdatePassword email="fan@icons.gg" next="/" />);

    expect(html).toContain('disabled=""');
    expect(html).toContain('변경하는 중…');
  });

  it('replaces the form with reset-mail guidance when the action rejects the recovery proof', () => {
    mocks.state = { blocked: 'recovery_required', errors: { form: '재설정 필요' } };

    const html = renderToStaticMarkup(<UpdatePassword email="fan@icons.gg" next="/settings" />);

    expect(mocks.recoveryRequiredProps).toEqual({ email: 'fan@icons.gg', next: '/settings' });
    expect(html).toContain('recovery-required');
    expect(html).not.toContain('name="password"');
  });

  it('replaces the form with the SNS sign-in notice when the action refuses a social-only account', () => {
    mocks.state = { blocked: 'no_email_identity', errors: { form: 'SNS 계정' } };

    const html = renderToStaticMarkup(<UpdatePassword email="fan@icons.gg" next="/settings" />);

    expect(mocks.socialNoticeProps).toEqual({ next: '/settings' });
    expect(html).toContain('social-account');
    expect(html).not.toContain('name="password"');
  });
});
