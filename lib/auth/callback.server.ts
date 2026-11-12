import 'server-only';

import type { CookieOptions } from '@supabase/ssr';
import type { NextRequest, NextResponse } from 'next/server';
import { AUTH_SESSION_ONLY_COOKIE, isSessionOnlyPreference, supabaseAuthCookieOptions } from '@/lib/supabase/session-persistence';
import { AUTH_CALLBACK_PATH } from './onboarding';

export interface AuthResponseState {
  cookies: Map<string, { value: string; options: CookieOptions }>;
  headers: Map<string, string>;
}

export function createAuthResponseState(): AuthResponseState {
  return {
    cookies: new Map(),
    headers: new Map(),
  };
}

/*
 * '로그인 상태 유지'(SHEET-005)는 로그인 화면의 선택이다. 그 선택을 따르는 세션은 로그인·가입·계정 연결이 돌아오는 공용 콜백
 * (AUTH_CALLBACK_PATH — 소셜 로그인 포함)에서 만든 것뿐이다 — 로그인 액션이 남긴 '유지하지 않음' 표시가 요청에 있으면
 * 세션 쿠키를 Max-Age·Expires 없는 브라우저 세션 쿠키로 쓴다(lib/supabase/session-persistence.ts).
 * 비밀번호 재설정(복구) 콜백 세션은 로그인 폼 선택과 무관하므로 받은 속성 그대로 쓴다.
 */
function sessionOnlyCallback(request: NextRequest): boolean {
  return request.nextUrl.pathname === AUTH_CALLBACK_PATH
    && isSessionOnlyPreference(request.cookies.get(AUTH_SESSION_ONLY_COOKIE)?.value);
}

export function authCallbackCookieAdapter(
  request: NextRequest,
  authResponse: AuthResponseState,
) {
  const sessionOnly = sessionOnlyCallback(request);
  return {
    getAll() {
      return request.cookies.getAll();
    },
    setAll(
      cookiesToSet: Array<{ name: string; value: string; options: CookieOptions }>,
      headers: Record<string, string>,
    ) {
      cookiesToSet.forEach(({ name, value, options }) => {
        request.cookies.set(name, value);
        authResponse.cookies.set(name, { value, options: supabaseAuthCookieOptions(options, value, sessionOnly) });
      });
      Object.entries(headers).forEach(([name, value]) => {
        authResponse.headers.set(name, value);
      });
    },
  };
}

export function applyAuthResponseState(
  response: NextResponse,
  authResponse?: AuthResponseState,
) {
  authResponse?.cookies.forEach(({ value, options }, name) => {
    response.cookies.set(name, value, options);
  });
  authResponse?.headers.forEach((value, name) => {
    response.headers.set(name, value);
  });
  if (!response.headers.has('cache-control')) {
    response.headers.set('cache-control', 'private, no-store');
  }
}

export function isRecoveryExchange(data: unknown) {
  return Boolean(
    data
    && typeof data === 'object'
    && 'redirectType' in data
    && data.redirectType === 'recovery',
  );
}

export async function clearExchangedAuthSession(
  supabase: { auth: { signOut: (options: { scope: 'local' }) => Promise<unknown> } },
  authResponse: AuthResponseState,
) {
  try {
    await supabase.auth.signOut({ scope: 'local' });
  } catch {
    // The response cookies below are still expired if local cleanup fails.
  }
  authResponse.cookies.forEach(({ options }, name) => {
    authResponse.cookies.set(name, {
      value: '',
      options: { ...options, expires: new Date(0), maxAge: 0 },
    });
  });
}
