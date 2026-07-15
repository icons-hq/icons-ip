import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { UpdatePassword } from './UpdatePassword';

const mocks = vi.hoisted(() => ({
  state: {} as Record<string, unknown>,
  action: vi.fn(),
  pending: false,
}));

vi.mock('@/app/update-password/actions', () => ({
  updatePasswordAction: mocks.action,
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
  });

  it('renders labeled new-password fields and a safe hidden next value', () => {
    const html = renderToStaticMarkup(<UpdatePassword next="/community?sort=hot" />);

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

    const html = renderToStaticMarkup(<UpdatePassword next="/" />);

    expect(html).toContain('aria-invalid="true"');
    expect(html).toContain('비밀번호 오류');
    expect(html).toContain('확인 오류');
    expect(html).toContain('role="alert"');
    expect(html).toContain('세션 오류');
  });

  it('disables submission and announces progress while pending', () => {
    mocks.pending = true;

    const html = renderToStaticMarkup(<UpdatePassword next="/" />);

    expect(html).toContain('disabled=""');
    expect(html).toContain('변경하는 중…');
  });
});
