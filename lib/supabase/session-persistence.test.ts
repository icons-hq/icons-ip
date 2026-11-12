import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  AUTH_SESSION_ONLY_COOKIE,
  browserAuthCookieMethods,
  isSessionOnlyPreference,
  parseCookieHeader,
  serializeCookie,
  sessionOnlyPreferenceCookie,
  supabaseAuthCookieOptions,
} from './session-persistence';

/* @supabase/ssr 0.12 의 기본 쓰기 속성(DEFAULT_COOKIE_OPTIONS + 매번 400일) — 지금 브라우저에 남는 세션 쿠키의 모양이다. */
const DEFAULT_SET = { path: '/', sameSite: 'lax' as const, httpOnly: false, maxAge: 400 * 24 * 60 * 60 };
const DEFAULT_REMOVE = { ...DEFAULT_SET, maxAge: 0 };

type CookieMethods = {
  getAll: () => unknown;
  setAll: (cookies: Array<{ name: string; value: string; options: Record<string, unknown> }>, headers: Record<string, string>) => void;
};
const ssr = vi.hoisted(() => ({
  methods: null as null | CookieMethods,
  /* 프록시의 getClaims 가 세션을 갱신하며 setAll 을 부르는 순간을 흉내 낸다. */
  onGetClaims: null as null | ((methods: CookieMethods) => void),
}));

vi.mock('@supabase/ssr', () => ({
  createServerClient: (_url: string, _key: string, options: { cookies: CookieMethods }) => {
    ssr.methods = options.cookies;
    return { auth: { getClaims: async () => { ssr.onGetClaims?.(options.cookies); return { data: null }; } } };
  },
}));
vi.mock('./config', () => ({
  getSupabaseConfig: () => ({ url: 'http://127.0.0.1:54321', key: 'publishable-test', isConfigured: true }),
  requireSupabaseConfig: () => ({ url: 'http://127.0.0.1:54321', key: 'publishable-test' }),
}));

const headerCookies = vi.hoisted(() => ({
  jar: new Map<string, string>(),
  sets: [] as Array<{ name: string; value: string; options?: Record<string, unknown> }>,
}));
vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (name: string) => (headerCookies.jar.has(name) ? { name, value: headerCookies.jar.get(name)! } : undefined),
    getAll: () => [...headerCookies.jar.entries()].map(([name, value]) => ({ name, value })),
    set: (name: string, value: string, options?: Record<string, unknown>) => { headerCookies.sets.push({ name, value, options }); },
  }),
}));

beforeEach(() => {
  ssr.methods = null;
  ssr.onGetClaims = null;
  headerCookies.jar.clear();
  headerCookies.sets.length = 0;
});

describe('supabaseAuthCookieOptions', () => {
  it('유지(기본)면 받은 속성을 같은 객체 그대로 돌려준다 — 지금 동작이 한 글자도 바뀌지 않는다', () => {
    expect(supabaseAuthCookieOptions(DEFAULT_SET, 'base64-token', false)).toBe(DEFAULT_SET);
  });

  it('유지하지 않으면 값이 있는 쿠키에서 Max-Age·Expires 만 떼어 브라우저 세션 쿠키로 만든다', () => {
    const withExpires = { ...DEFAULT_SET, expires: new Date('2027-12-01T00:00:00Z') };
    const session = supabaseAuthCookieOptions(withExpires, 'base64-token', true);
    expect(session).toEqual({ path: '/', sameSite: 'lax', httpOnly: false });
    /* 받은 객체는 건드리지 않는다(같은 속성을 다른 쿠키에 다시 쓴다). */
    expect(withExpires.maxAge).toBe(DEFAULT_SET.maxAge);
  });

  it('지우는 쿠키(값 없음·Max-Age 0)는 유지하지 않아도 그대로 지운다', () => {
    expect(supabaseAuthCookieOptions(DEFAULT_REMOVE, '', true)).toBe(DEFAULT_REMOVE);
    expect(supabaseAuthCookieOptions(DEFAULT_REMOVE, 'stale', true)).toBe(DEFAULT_REMOVE);
    const expired = { path: '/', expires: new Date(0) };
    expect(supabaseAuthCookieOptions(expired, '', true)).toBe(expired);
  });

  it("표시 쿠키는 '1'만 '유지하지 않음'이다", () => {
    expect(isSessionOnlyPreference('1')).toBe(true);
    for (const value of [undefined, null, '', '0', 'true']) expect(isSessionOnlyPreference(value)).toBe(false);
    expect(sessionOnlyPreferenceCookie(true)).toEqual({
      name: AUTH_SESSION_ONLY_COOKIE,
      value: '1',
      options: { path: '/', sameSite: 'lax', httpOnly: false, secure: true },
    });
  });
});

describe('브라우저 쿠키 형식 — @supabase/ssr 기본(cookie@1)과 같다', () => {
  it('Set-Cookie 문자열을 cookie@1 과 같은 순서·표기로 만든다', () => {
    expect(serializeCookie('sb-127-auth-token', 'base64-eyJhIjoxfQ', DEFAULT_SET))
      .toBe('sb-127-auth-token=base64-eyJhIjoxfQ; Max-Age=34560000; Path=/; SameSite=Lax');
    expect(serializeCookie('sb-127-auth-token.0', '', DEFAULT_REMOVE))
      .toBe('sb-127-auth-token.0=; Max-Age=0; Path=/; SameSite=Lax');
    expect(serializeCookie('x', 'a b;c', {
      path: '/', domain: '.iconsip.com', secure: true, expires: new Date('2026-11-19T00:00:00Z'),
      sameSite: 'none', priority: 'high', partitioned: true, httpOnly: true,
    })).toBe('x=a%20b%3Bc; Domain=.iconsip.com; Path=/; Expires=Thu, 19 Nov 2026 00:00:00 GMT; HttpOnly; Secure; Partitioned; Priority=High; SameSite=None');
  });

  it('document.cookie 를 cookie@1 parse 와 같게 읽는다(첫 값·% 디코드·= 없는 조각 건너뜀)', () => {
    expect(parseCookieHeader('a=1; b=hello%20world; a=3;  c = d ; bad; e=%E0%A4%A')).toEqual([
      { name: 'a', value: '1' },
      { name: 'b', value: 'hello world' },
      { name: 'c', value: 'd' },
      { name: 'e', value: '%E0%A4%A' },
    ]);
    expect(parseCookieHeader('')).toEqual([]);
  });
});

describe('browserAuthCookieMethods — 토큰 갱신도 선택을 따른다', () => {
  function fakeDocument(initial: string) {
    const writes: string[] = [];
    let jar = initial;
    return {
      writes,
      target: {
        get cookie() { return jar; },
        set cookie(value: string) { writes.push(value); jar = jar ? `${jar}; ${value.split(';')[0]}` : value.split(';')[0]!; },
      },
    };
  }

  it('표시가 없으면(기본) 지금처럼 400일로 쓴다', () => {
    const doc = fakeDocument('sb-127-auth-token=old');
    const methods = browserAuthCookieMethods(() => doc.target);
    expect(methods.getAll()).toEqual([{ name: 'sb-127-auth-token', value: 'old' }]);
    methods.setAll([{ name: 'sb-127-auth-token', value: 'base64-new', options: DEFAULT_SET }]);
    expect(doc.writes).toEqual(['sb-127-auth-token=base64-new; Max-Age=34560000; Path=/; SameSite=Lax']);
  });

  it('표시가 있으면 브라우저 세션 쿠키로 쓰고, 지우는 쿠키는 그대로 지운다', () => {
    const doc = fakeDocument(`${AUTH_SESSION_ONLY_COOKIE}=1; sb-127-auth-token.0=a; sb-127-auth-token.1=b`);
    browserAuthCookieMethods(() => doc.target).setAll([
      { name: 'sb-127-auth-token.1', value: '', options: DEFAULT_REMOVE },
      { name: 'sb-127-auth-token', value: 'base64-new', options: DEFAULT_SET },
    ]);
    expect(doc.writes).toEqual([
      'sb-127-auth-token.1=; Max-Age=0; Path=/; SameSite=Lax',
      'sb-127-auth-token=base64-new; Path=/; SameSite=Lax',
    ]);
  });

  it('브라우저 밖에서는 읽기는 비고 쓰기는 거절한다(@supabase/ssr 기본과 같다)', () => {
    const methods = browserAuthCookieMethods(() => null);
    expect(methods.getAll()).toEqual([]);
    expect(() => methods.setAll([{ name: 'sb-127-auth-token', value: 'x', options: DEFAULT_SET }])).toThrow();
  });
});

describe('서버 클라이언트·요청 프록시가 세션 쿠키를 쓸 때', () => {
  it('서버 클라이언트는 표시가 없으면 받은 속성 그대로, 있으면 세션 쿠키로 쓴다', async () => {
    const { createClient } = await import('./server');

    await createClient();
    ssr.methods!.setAll([{ name: 'sb-127-auth-token', value: 'base64-a', options: DEFAULT_SET }], {});
    expect(headerCookies.sets).toEqual([{ name: 'sb-127-auth-token', value: 'base64-a', options: DEFAULT_SET }]);

    headerCookies.sets.length = 0;
    headerCookies.jar.set(AUTH_SESSION_ONLY_COOKIE, '1');
    await createClient();
    ssr.methods!.setAll([
      { name: 'sb-127-auth-token', value: 'base64-b', options: DEFAULT_SET },
      { name: 'sb-127-auth-token.0', value: '', options: DEFAULT_REMOVE },
    ], {});
    expect(headerCookies.sets).toEqual([
      { name: 'sb-127-auth-token', value: 'base64-b', options: { path: '/', sameSite: 'lax', httpOnly: false } },
      { name: 'sb-127-auth-token.0', value: '', options: DEFAULT_REMOVE },
    ]);
  });

  it('로그인 액션이 넘긴 선택(sessionOnly)은 요청의 표시보다 앞선다', async () => {
    const { createClient } = await import('./server');
    headerCookies.jar.set(AUTH_SESSION_ONLY_COOKIE, '1');

    await createClient({ sessionOnly: false });
    ssr.methods!.setAll([{ name: 'sb-127-auth-token', value: 'base64-c', options: DEFAULT_SET }], {});
    expect(headerCookies.sets.at(-1)?.options).toEqual(DEFAULT_SET);

    headerCookies.jar.clear();
    await createClient({ sessionOnly: true });
    ssr.methods!.setAll([{ name: 'sb-127-auth-token', value: 'base64-d', options: DEFAULT_SET }], {});
    expect(headerCookies.sets.at(-1)?.options).toEqual({ path: '/', sameSite: 'lax', httpOnly: false });
  });

  it('요청 프록시는 갱신한 세션을 표시에 맞춰 Set-Cookie 로 내린다', async () => {
    const { updateSession } = await import('./middleware');
    ssr.onGetClaims = (methods) => methods.setAll([{ name: 'sb-127-auth-token', value: 'base64-refreshed', options: DEFAULT_SET }], {});
    const refresh = async (cookieHeader: string) => {
      const request = new NextRequest('http://localhost:3000/shop', { headers: { cookie: cookieHeader } });
      const response = await updateSession(request);
      return response.headers.getSetCookie().find((line) => line.startsWith('sb-127-auth-token='))!;
    };

    const kept = await refresh('sb-127-auth-token=base64-old');
    expect(kept).toMatch(/Max-Age=34560000/);

    const sessionOnly = await refresh(`${AUTH_SESSION_ONLY_COOKIE}=1; sb-127-auth-token=base64-old`);
    expect(sessionOnly).not.toMatch(/Max-Age|Expires/i);
    expect(sessionOnly).toMatch(/^sb-127-auth-token=base64-refreshed; Path=\/; SameSite=lax$/i);
  });
});
