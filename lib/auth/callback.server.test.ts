import { NextRequest, NextResponse } from 'next/server';
import { describe, expect, it } from 'vitest';
import {
  applyAuthResponseState,
  authCallbackCookieAdapter,
  clearExchangedAuthSession,
  createAuthResponseState,
} from './callback.server';

/* SHEET-005 '로그인 상태 유지'는 소셜 로그인에도 적용한다(오케스트레이터 결정 11/12). 소셜 세션은 공용 콜백(/auth/callback)이 쓰므로
   로그인 액션이 남긴 '유지하지 않음' 표시가 요청에 있으면 Max-Age·Expires 없는 세션 쿠키로 쓴다. 표시가 없으면 받은 속성 그대로이고,
   비밀번호 재설정(복구) 콜백도 같은 표시를 따른다. */
const PERSISTENT = { path: '/', sameSite: 'lax' as const, httpOnly: false, maxAge: 400 * 24 * 60 * 60 };
const EXPIRES = new Date('2027-12-17T00:00:00.000Z');

function callback(path: string, sessionOnly: boolean) {
  return new NextRequest(new URL(path, 'https://iconsip.com'), {
    headers: sessionOnly ? { cookie: 'icons_auth_session_only=1; icons_auth_next=signed' } : { cookie: 'icons_auth_next=signed' },
  });
}

function exchange(request: NextRequest) {
  const authResponse = createAuthResponseState();
  const adapter = authCallbackCookieAdapter(request, authResponse);
  adapter.setAll([
    { name: 'sb-local-auth-token', value: 'base64-session', options: { ...PERSISTENT, expires: EXPIRES } },
    { name: 'sb-local-auth-token-code-verifier', value: '', options: { ...PERSISTENT, maxAge: 0 } },
  ], { 'Cache-Control': 'private, no-store' });
  const response = NextResponse.redirect(new URL('/community', 'https://iconsip.com'));
  applyAuthResponseState(response, authResponse);
  return { authResponse, setCookies: response.headers.getSetCookie(), request };
}

describe('authCallbackCookieAdapter — 로그인 상태 유지', () => {
  it("소셜 콜백(/auth/callback)은 '유지하지 않음' 표시가 있으면 세션 쿠키를 Max-Age·Expires 없이 쓴다", () => {
    const { authResponse, setCookies } = exchange(callback('/auth/callback?code=oauth-code', true));

    expect(authResponse.cookies.get('sb-local-auth-token')).toEqual({
      value: 'base64-session',
      options: { path: '/', sameSite: 'lax', httpOnly: false },
    });
    const session = setCookies.find((line) => line.startsWith('sb-local-auth-token=base64-session'))!;
    expect(session).not.toMatch(/Max-Age|Expires/i);
    /* 지우는 쿠키는 그대로 지운다. */
    expect(setCookies.find((line) => line.startsWith('sb-local-auth-token-code-verifier='))).toMatch(/Max-Age=0/);
  });

  it('표시가 없으면(기본 — 유지) 받은 속성을 같은 객체 그대로 쓴다', () => {
    const { authResponse, setCookies } = exchange(callback('/auth/callback?code=oauth-code', false));

    expect(authResponse.cookies.get('sb-local-auth-token')?.options).toEqual({ ...PERSISTENT, expires: EXPIRES });
    expect(setCookies.find((line) => line.startsWith('sb-local-auth-token=base64-session'))).toMatch(/Max-Age=34560000/);
  });

  it("비밀번호 재설정(복구) 콜백도 '유지하지 않음' 표시가 있으면 세션 쿠키로 쓴다", () => {
    const { authResponse, setCookies } = exchange(callback('/auth/recovery/callback?token_hash=t&type=recovery', true));

    expect(authResponse.cookies.get('sb-local-auth-token')?.options).toEqual({ path: '/', sameSite: 'lax', httpOnly: false });
    expect(setCookies.find((line) => line.startsWith('sb-local-auth-token=base64-session'))).not.toMatch(/Max-Age|Expires/i);
  });

  it('비밀번호 재설정(복구) 콜백도 표시가 없으면 받은 속성을 같은 객체 그대로 쓴다', () => {
    const { authResponse, setCookies } = exchange(callback('/auth/recovery/callback?token_hash=t&type=recovery', false));

    expect(authResponse.cookies.get('sb-local-auth-token')?.options).toEqual({ ...PERSISTENT, expires: EXPIRES });
    expect(setCookies.find((line) => line.startsWith('sb-local-auth-token=base64-session'))).toMatch(/Max-Age=34560000/);
  });

  it('교환한 세션을 닫을 때는 세션 쿠키로 쓴 것도 Max-Age 0으로 지운다', async () => {
    const { authResponse } = exchange(callback('/auth/callback?code=oauth-code', true));

    await clearExchangedAuthSession({ auth: { signOut: async () => ({ error: null }) } }, authResponse);

    expect(authResponse.cookies.get('sb-local-auth-token')).toMatchObject({ value: '', options: { maxAge: 0 } });
  });
});
