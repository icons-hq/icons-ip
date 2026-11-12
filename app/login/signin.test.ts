import { beforeEach, describe, expect, it, vi } from 'vitest';
import { signInWithEmailAction } from './actions';

const mocks = vi.hoisted(() => ({
  signInWithPassword: vi.fn(),
  getProfileForUser: vi.fn(),
  createClient: vi.fn(),
  cookies: new Map<string, string>(),
  cookieSets: [] as Array<{ name: string; value: string; options?: Record<string, unknown> }>,
  cookieDeletes: [] as string[],
  origin: null as string | null,
}));

vi.mock('@/lib/supabase/config', () => ({
  getSupabaseConfig: () => ({ isConfigured: true }),
}));
vi.mock('@/lib/supabase/server', () => ({
  createClient: mocks.createClient,
}));
vi.mock('@/lib/auth/server', () => ({ getProfileForUser: mocks.getProfileForUser }));
vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (name: string) => (mocks.cookies.has(name) ? { name, value: mocks.cookies.get(name)! } : undefined),
    set: (name: string, value: string, options?: Record<string, unknown>) => { mocks.cookieSets.push({ name, value, options }); },
    delete: (name: string) => { mocks.cookieDeletes.push(name); },
  }),
  headers: async () => ({ get: (name: string) => (name === 'origin' ? mocks.origin : null) }),
}));
vi.mock('next/navigation', () => ({
  redirect: (path: string) => {
    throw new Error(`NEXT_REDIRECT:${path}`);
  },
}));

function formData(next = '/orders') {
  const data = new FormData();
  data.set('email', 'fan@icons.gg');
  data.set('password', 'password1234');
  data.set('next', next);
  return data;
}

describe('signInWithEmailAction', () => {
  beforeEach(() => {
    mocks.signInWithPassword.mockReset();
    mocks.getProfileForUser.mockReset();
    mocks.createClient.mockReset();
    mocks.createClient.mockImplementation(async () => ({ auth: { signInWithPassword: mocks.signInWithPassword } }));
    mocks.cookies.clear();
    mocks.cookieSets.length = 0;
    mocks.cookieDeletes.length = 0;
    mocks.origin = null;
    mocks.signInWithPassword.mockResolvedValue({
      data: { user: { id: 'user-1', email: 'fan@icons.gg' } },
      error: null,
    });
  });

  it('redirects a suspended account before onboarding or next', async () => {
    mocks.getProfileForUser.mockResolvedValue({
      email: 'fan@icons.gg',
      nickname: 'fan',
      birth_date: '2000-01-01',
      consents: { terms: true, privacy: true },
      onboarded_at: '2026-07-01T00:00:00.000Z',
      suspended_at: '2026-07-17T00:00:00.000Z',
    });

    await expect(signInWithEmailAction({}, formData())).rejects.toThrow(
      'NEXT_REDIRECT:/account-suspended',
    );
  });

  it('lets a suspended account reauthenticate for the self-service deletion route', async () => {
    mocks.getProfileForUser.mockResolvedValue({
      email: 'fan@icons.gg',
      nickname: 'fan',
      birth_date: '2000-01-01',
      consents: { terms: true, privacy: true },
      onboarded_at: '2026-07-01T00:00:00.000Z',
      suspended_at: '2026-07-17T00:00:00.000Z',
    });

    await expect(signInWithEmailAction({}, formData('/settings/delete-account'))).rejects.toThrow(
      'NEXT_REDIRECT:/settings/delete-account',
    );
  });

  it('returns an incomplete account to the deletion route without forcing onboarding', async () => {
    mocks.getProfileForUser.mockResolvedValue(null);

    await expect(signInWithEmailAction({}, formData('/settings/delete-account'))).rejects.toThrow(
      'NEXT_REDIRECT:/settings/delete-account',
    );
  });
});

/* SHEET-005 '로그인 상태 유지' — 체크(keepSignedIn=1, 기본)는 지금처럼 400일 세션, 끄면 이 브라우저에 '유지하지 않음' 표시를
   세션 쿠키로 남기고 이번 로그인의 세션 쿠키도 브라우저 세션 쿠키로 쓴다(createClient의 sessionOnly). */
describe("signInWithEmailAction '로그인 상태 유지'", () => {
  const onboarded = {
    email: 'fan@icons.gg',
    nickname: 'fan',
    birth_date: '2000-01-01',
    consents: { terms: true, privacy: true },
    onboarded_at: '2026-07-01T00:00:00.000Z',
    suspended_at: null,
  };

  beforeEach(() => {
    mocks.signInWithPassword.mockReset();
    mocks.getProfileForUser.mockReset();
    mocks.createClient.mockReset();
    mocks.createClient.mockImplementation(async () => ({ auth: { signInWithPassword: mocks.signInWithPassword } }));
    mocks.cookies.clear();
    mocks.cookieSets.length = 0;
    mocks.cookieDeletes.length = 0;
    mocks.origin = null;
    mocks.signInWithPassword.mockResolvedValue({ data: { user: { id: 'user-1', email: 'fan@icons.gg' } }, error: null });
    mocks.getProfileForUser.mockResolvedValue(onboarded);
  });

  function keepForm(keep: boolean) {
    const data = formData('/orders');
    if (keep) data.set('keepSignedIn', '1');
    return data;
  }

  it('체크하면 지금처럼 유지한다 — 세션 쿠키를 그대로 쓰고 남은 표시를 걷는다', async () => {
    mocks.cookies.set('icons_auth_session_only', '1');

    await expect(signInWithEmailAction({}, keepForm(true))).rejects.toThrow('NEXT_REDIRECT:/orders');

    expect(mocks.createClient).toHaveBeenCalledWith({ sessionOnly: false });
    expect(mocks.cookieDeletes).toEqual(['icons_auth_session_only']);
    expect(mocks.cookieSets).toEqual([]);
  });

  it('체크한 채 표시가 없으면 쿠키를 건드리지 않는다', async () => {
    await expect(signInWithEmailAction({}, keepForm(true))).rejects.toThrow('NEXT_REDIRECT:/orders');

    expect(mocks.cookieDeletes).toEqual([]);
    expect(mocks.cookieSets).toEqual([]);
  });

  it('끄면 세션 쿠키 로그인이다 — 이번 세션을 브라우저 세션 쿠키로 쓰고 HttpOnly 아닌 세션 표시를 남긴다', async () => {
    mocks.origin = 'https://iconsip.com';

    await expect(signInWithEmailAction({}, keepForm(false))).rejects.toThrow('NEXT_REDIRECT:/orders');

    expect(mocks.createClient).toHaveBeenCalledWith({ sessionOnly: true });
    expect(mocks.cookieSets).toEqual([{
      name: 'icons_auth_session_only',
      value: '1',
      options: { path: '/', sameSite: 'lax', httpOnly: false, secure: true },
    }]);
    expect(mocks.cookieSets[0]!.options).not.toHaveProperty('maxAge');
    expect(mocks.cookieSets[0]!.options).not.toHaveProperty('expires');
  });

  it('로컬 http 에서는 Secure 없이 남긴다', async () => {
    mocks.origin = 'http://localhost:3000';

    await expect(signInWithEmailAction({}, keepForm(false))).rejects.toThrow('NEXT_REDIRECT:/orders');

    expect(mocks.cookieSets[0]!.options).toMatchObject({ secure: false });
  });

  it('로그인에 실패하면 표시를 바꾸지 않는다', async () => {
    mocks.cookies.set('icons_auth_session_only', '1');
    mocks.signInWithPassword.mockResolvedValue({ data: { user: null }, error: { message: 'invalid' } });

    await expect(signInWithEmailAction({}, keepForm(true))).resolves.toEqual({ errors: { form: '이메일 또는 비밀번호를 확인해주세요.' } });
    await expect(signInWithEmailAction({}, keepForm(false))).resolves.toEqual({ errors: { form: '이메일 또는 비밀번호를 확인해주세요.' } });

    expect(mocks.cookieSets).toEqual([]);
    expect(mocks.cookieDeletes).toEqual([]);
  });
});
