import { beforeEach, describe, expect, it, vi } from 'vitest';
import { updatePasswordAction } from './actions';

const AUTH_NEXT_COOKIE_NAME = 'icons_auth_next';

const mocks = vi.hoisted(() => ({
  configured: true,
  cookieSetCalls: [] as Array<{ name: string; value: string; options?: Record<string, unknown> }>,
  getUser: vi.fn(),
  updateUser: vi.fn(),
  signOut: vi.fn(),
  operationOrder: [] as string[],
}));

vi.mock('@/lib/auth/onboarding', async () => await import('../../lib/auth/onboarding'));
vi.mock('@/lib/supabase/config', () => ({
  getSupabaseConfig: () => ({ isConfigured: mocks.configured }),
}));
vi.mock('@/lib/supabase/server', () => ({
  createClient: () => ({
    auth: {
      getUser: mocks.getUser,
      updateUser: mocks.updateUser,
      signOut: mocks.signOut,
    },
  }),
}));
vi.mock('next/headers', () => ({
  cookies: async () => ({
    set: (name: string, value: string, options?: Record<string, unknown>) => {
      mocks.cookieSetCalls.push({ name, value, options });
    },
  }),
}));
vi.mock('next/navigation', () => ({
  redirect: (path: string) => {
    throw new Error(`NEXT_REDIRECT:${path}`);
  },
}));

function formData(
  password = 'new-password-1234',
  passwordConfirmation = password,
  next = '/community?sort=hot',
) {
  const data = new FormData();
  data.set('password', password);
  data.set('passwordConfirmation', passwordConfirmation);
  data.set('next', next);
  return data;
}

describe('updatePasswordAction', () => {
  beforeEach(() => {
    mocks.configured = true;
    mocks.cookieSetCalls.length = 0;
    mocks.operationOrder.length = 0;
    mocks.getUser.mockReset();
    mocks.updateUser.mockReset();
    mocks.signOut.mockReset();
    mocks.getUser.mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null });
    mocks.updateUser.mockImplementation(async () => {
      mocks.operationOrder.push('update');
      return { data: { user: { id: 'user-1' } }, error: null };
    });
    mocks.signOut.mockImplementation(async () => {
      mocks.operationOrder.push('signout');
      return { error: null };
    });
  });

  it('validates both password fields before authenticating or updating', async () => {
    const empty = await updatePasswordAction({}, formData('', ''));
    const mismatch = await updatePasswordAction({}, formData('new-password-1234', 'different-password'));

    expect(empty.errors).toMatchObject({
      password: '새 비밀번호를 입력해주세요.',
      passwordConfirmation: '새 비밀번호 확인을 입력해주세요.',
    });
    expect(mismatch.errors?.passwordConfirmation).toContain('일치하지 않습니다');
    expect(mocks.getUser).not.toHaveBeenCalled();
    expect(mocks.updateUser).not.toHaveBeenCalled();
  });

  it('rejects unauthenticated submissions before updateUser', async () => {
    mocks.getUser.mockResolvedValue({ data: { user: null }, error: { code: 'session_not_found' } });

    const state = await updatePasswordAction({}, formData());

    expect(state.errors?.form).toContain('세션이 만료');
    expect(mocks.updateUser).not.toHaveBeenCalled();
    expect(mocks.signOut).not.toHaveBeenCalled();
  });

  it.each([
    ['weak_password', '보안 조건'],
    ['same_password', '현재 비밀번호와 다르게'],
    ['session_expired', '세션이 만료'],
    ['session_not_found', '세션이 만료'],
    ['reauthentication_needed', '세션이 만료'],
  ])('maps updateUser error %s and keeps the recovery session', async (code, expected) => {
    mocks.updateUser.mockResolvedValue({ data: { user: null }, error: { code, message: 'private provider detail' } });

    const state = await updatePasswordAction({}, formData());

    expect(state.errors?.form).toContain(expected);
    expect(JSON.stringify(state)).not.toContain('private');
    expect(mocks.signOut).not.toHaveBeenCalled();
  });

  it('updates the password before globally signing out and redirects with a safe next path', async () => {
    await expect(updatePasswordAction({}, formData())).rejects.toThrow(
      'NEXT_REDIRECT:/login?password_reset=success&next=%2Fcommunity%3Fsort%3Dhot',
    );

    expect(mocks.getUser).toHaveBeenCalledOnce();
    expect(mocks.updateUser).toHaveBeenCalledWith({ password: 'new-password-1234' });
    expect(mocks.signOut).toHaveBeenCalledWith({ scope: 'global' });
    expect(mocks.operationOrder).toEqual(['update', 'signout']);
    expect(mocks.cookieSetCalls).toContainEqual({
      name: AUTH_NEXT_COOKIE_NAME,
      value: '',
      options: { path: '/auth/callback', maxAge: 0 },
    });
    expect(JSON.stringify(mocks.cookieSetCalls)).not.toContain('new-password-1234');
  });

  it('normalizes an unsafe next path before the success redirect', async () => {
    await expect(updatePasswordAction({}, formData(
      'new-password-1234',
      'new-password-1234',
      'https://evil.example/steal',
    ))).rejects.toThrow('NEXT_REDIRECT:/login?password_reset=success');

    expect(JSON.stringify(mocks.cookieSetCalls)).not.toContain('evil.example');
  });

  it('reports global sign-out failure honestly after the password changed', async () => {
    mocks.signOut
      .mockResolvedValueOnce({ error: { code: 'unexpected_failure', message: 'private' } })
      .mockResolvedValueOnce({ error: null });

    const state = await updatePasswordAction({}, formData());

    expect(state.message).toContain('비밀번호는 변경되었습니다');
    expect(state.message).toContain('다른 기기의 로그아웃을 완료하지 못했습니다');
    expect(JSON.stringify(state)).not.toContain('private');
    expect(mocks.signOut).toHaveBeenNthCalledWith(1, { scope: 'global' });
    expect(mocks.signOut).toHaveBeenNthCalledWith(2, { scope: 'local' });
    expect(mocks.cookieSetCalls).toContainEqual({
      name: AUTH_NEXT_COOKIE_NAME,
      value: '',
      options: { path: '/auth/callback', maxAge: 0 },
    });
  });

  it('warns when both global and local sign-out fail after the password changed', async () => {
    mocks.signOut.mockResolvedValue({ error: { code: 'unexpected_failure', message: 'private' } });

    const state = await updatePasswordAction({}, formData());

    expect(state.message).toContain('로그아웃을 완료하지 못했습니다');
    expect(state.message).toContain('이 브라우저를 닫아주세요');
    expect(mocks.signOut).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(state)).not.toContain('private');
  });
});
