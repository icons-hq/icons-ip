import 'server-only';

import type { CookieOptions } from '@supabase/ssr';
import type { NextRequest, NextResponse } from 'next/server';

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

export function authCallbackCookieAdapter(
  request: NextRequest,
  authResponse: AuthResponseState,
) {
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
        authResponse.cookies.set(name, { value, options });
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
