import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { signedPasswordRecoveryProofValue } from '@/lib/auth/recovery.server';
import { updatePasswordAction } from './actions';

const AUTH_NEXT_COOKIE_NAME = 'icons_auth_next';
const RECOVERY_PROOF_COOKIE_NAME = 'icons_auth_recovery_proof';
const SECRET = 'test-update-password-secret-with-enough-entropy';
const ORIGINAL_SECRET = process.env.AUTH_SIGNUP_RESEND_SECRET;

const mocks = vi.hoisted(() => ({
  configured: true,
  cookieSetCalls: [] as Array<{ name: string; value: string; options?: Record<string, unknown> }>,
  requestCookies: new Map<string, string>(),
  getUser: vi.fn(),
  getClaims: vi.fn(),
  updateUser: vi.fn(),
  signOut: vi.fn(),
  operationOrder: [] as string[],
}));

vi.mock('@/lib/supabase/config', () => ({
  getSupabaseConfig: () => ({ isConfigured: mocks.configured }),
}));
vi.mock('@/lib/supabase/server', () => ({
  createClient: () => ({
    auth: {
      getUser: mocks.getUser,
      getClaims: mocks.getClaims,
      updateUser: mocks.updateUser,
      signOut: mocks.signOut,
    },
  }),
}));
vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (name: string) => {
      const value = mocks.requestCookies.get(name);
      return value === undefined ? undefined : { name, value };
    },
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

function recoveryProof(issuedAt = Date.now(), sessionId = 'recovery-session-1') {
  return signedPasswordRecoveryProofValue({ sessionId, userId: 'user-1' }, issuedAt, SECRET);
}

describe('updatePasswordAction', () => {
  beforeEach(() => {
    process.env.AUTH_SIGNUP_RESEND_SECRET = SECRET;
    mocks.configured = true;
    mocks.cookieSetCalls.length = 0;
    mocks.requestCookies.clear();
    mocks.requestCookies.set(RECOVERY_PROOF_COOKIE_NAME, recoveryProof());
    mocks.operationOrder.length = 0;
    mocks.getUser.mockReset();
    mocks.getClaims.mockReset();
    mocks.updateUser.mockReset();
    mocks.signOut.mockReset();
    mocks.getUser.mockResolvedValue({
      data: { user: { id: 'user-1', identities: [{ provider: 'email' }] } },
      error: null,
    });
    mocks.getClaims.mockResolvedValue({
      data: { claims: { sub: 'user-1', session_id: 'recovery-session-1' } },
      error: null,
    });
    mocks.updateUser.mockImplementation(async () => {
      mocks.operationOrder.push('update');
      return { data: { user: { id: 'user-1' } }, error: null };
    });
    mocks.signOut.mockImplementation(async () => {
      mocks.operationOrder.push('signout');
      return { error: null };
    });
  });

  afterEach(() => {
    if (ORIGINAL_SECRET === undefined) delete process.env.AUTH_SIGNUP_RESEND_SECRET;
    else process.env.AUTH_SIGNUP_RESEND_SECRET = ORIGINAL_SECRET;
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

  it('refuses a signed-in session that never passed the recovery callback', async () => {
    mocks.requestCookies.clear();

    const state = await updatePasswordAction({}, formData());

    expect(state).toEqual({
      blocked: 'recovery_required',
      errors: { form: expect.stringContaining('재설정 메일의 링크를 연 뒤에만') },
    });
    expect(mocks.updateUser).not.toHaveBeenCalled();
    expect(mocks.signOut).not.toHaveBeenCalled();
    expect(mocks.cookieSetCalls).toEqual([]);
  });

  it.each([
    ['an expired proof', () => recoveryProof(Date.now() - 15 * 60 * 1000), undefined],
    ['a proof from another session', () => recoveryProof(Date.now(), 'old-recovery-session'), undefined],
    ['a forged proof', () => `${recoveryProof()}x`, undefined],
    ['unreadable claims', () => recoveryProof(), { data: null, error: { code: 'session_not_found' } }],
  ])('refuses %s before updateUser', async (_label, proof, claims) => {
    mocks.requestCookies.set(RECOVERY_PROOF_COOKIE_NAME, proof());
    if (claims) mocks.getClaims.mockResolvedValueOnce(claims);

    const state = await updatePasswordAction({}, formData());

    expect(state.blocked).toBe('recovery_required');
    expect(mocks.updateUser).not.toHaveBeenCalled();
    expect(mocks.signOut).not.toHaveBeenCalled();
  });

  it('refuses a social-only account even after a verified recovery link', async () => {
    mocks.getUser.mockResolvedValue({
      data: { user: { id: 'user-1', identities: [{ provider: 'kakao' }] } },
      error: null,
    });

    const state = await updatePasswordAction({}, formData());

    expect(state).toEqual({
      blocked: 'no_email_identity',
      errors: { form: expect.stringContaining('SNS로 가입한 계정은 비밀번호를 설정할 수 없습니다') },
    });
    expect(mocks.updateUser).not.toHaveBeenCalled();
    expect(mocks.signOut).not.toHaveBeenCalled();
    expect(mocks.cookieSetCalls).toEqual([]);
  });

  it('lets an email account linked to a social login change its password', async () => {
    mocks.getUser.mockResolvedValue({
      data: { user: { id: 'user-1', identities: [{ provider: 'email' }, { provider: 'kakao' }] } },
      error: null,
    });

    await expect(updatePasswordAction({}, formData())).rejects.toThrow('NEXT_REDIRECT:/login?password_reset=success');
    expect(mocks.updateUser).toHaveBeenCalledWith({ password: 'new-password-1234' });
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
    expect(mocks.cookieSetCalls).toContainEqual({
      name: RECOVERY_PROOF_COOKIE_NAME,
      value: '',
      options: { path: '/update-password', maxAge: 0 },
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
