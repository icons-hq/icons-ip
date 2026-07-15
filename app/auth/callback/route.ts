import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';
import {
  AUTH_CALLBACK_PATH,
  AUTH_NEXT_COOKIE_NAME,
  authErrorLoginPath,
  authNextPathFromCookie,
  isOnboarded,
  onboardingPath,
  passwordResetErrorLoginPath,
  safeNextPath,
  updatePasswordSessionReadyPath,
} from '@/lib/auth/onboarding';
import { authCookieSecret, authNextStateFromCookie } from '@/lib/auth/recovery.server';
import { getProfileForUser } from '@/lib/auth/server';
import { getSupabaseConfig } from '@/lib/supabase/config';

interface AuthResponseState {
  cookies: Map<string, { value: string; options: CookieOptions }>;
  headers: Map<string, string>;
}

function redirectTo(
  request: NextRequest,
  path: string,
  clearAuthNext = true,
  authResponse?: AuthResponseState,
) {
  const response = NextResponse.redirect(new URL(path, request.url));
  authResponse?.cookies.forEach(({ value, options }, name) => {
    response.cookies.set(name, value, options);
  });
  authResponse?.headers.forEach((value, name) => {
    response.headers.set(name, value);
  });
  if (clearAuthNext) {
    response.cookies.set(AUTH_NEXT_COOKIE_NAME, '', { path: AUTH_CALLBACK_PATH, maxAge: 0 });
  }
  return response;
}

function callbackState(request: NextRequest) {
  const cookieValue = request.cookies.get(AUTH_NEXT_COOKIE_NAME)?.value;
  const signedState = authNextStateFromCookie(cookieValue, Date.now(), authCookieSecret());
  const queryNext = request.nextUrl.searchParams.get('next');
  const fallbackNext = queryNext !== null
    ? safeNextPath(queryNext)
    : authNextPathFromCookie(cookieValue);

  return {
    fallbackNext,
    recoveryNext: signedState?.purpose === 'recovery' ? signedState.next : '/',
    signupNext: queryNext !== null
      ? safeNextPath(queryNext)
      : signedState?.purpose === 'signup'
        ? signedState.next
        : fallbackNext,
    signedState,
  };
}

function errorRedirect(
  request: NextRequest,
  code: string,
  recovery: boolean,
  next: string,
  authResponse?: AuthResponseState,
) {
  return redirectTo(
    request,
    recovery ? passwordResetErrorLoginPath(code, next) : authErrorLoginPath(code, next),
    !recovery,
    authResponse,
  );
}

function isRecoveryExchange(data: unknown) {
  // auth-js returns redirectType at runtime, but its public AuthTokenResponse type omits the field.
  return Boolean(data && typeof data === 'object' && 'redirectType' in data && data.redirectType === 'recovery');
}

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get('code');
  const state = callbackState(request);
  const markedRecovery = state.signedState?.purpose === 'recovery';
  const providerError = request.nextUrl.searchParams.get('error_code') ?? request.nextUrl.searchParams.get('error');

  if (providerError) {
    return errorRedirect(
      request,
      providerError,
      markedRecovery,
      markedRecovery ? state.recoveryNext : state.signupNext,
    );
  }
  if (!code) {
    return errorRedirect(
      request,
      'missing_code',
      markedRecovery,
      markedRecovery ? state.recoveryNext : state.signupNext,
    );
  }

  const { isConfigured, key, url } = getSupabaseConfig();
  if (!isConfigured || !url || !key) {
    return errorRedirect(
      request,
      'provider_disabled',
      markedRecovery,
      markedRecovery ? state.recoveryNext : state.signupNext,
    );
  }

  const authResponse: AuthResponseState = {
    cookies: new Map(),
    headers: new Map(),
  };
  const supabase = createServerClient(url, key, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet, headers) {
        cookiesToSet.forEach(({ name, value, options }) => {
          request.cookies.set(name, value);
          authResponse.cookies.set(name, { value, options });
        });
        Object.entries(headers).forEach(([name, value]) => {
          authResponse.headers.set(name, value);
        });
      },
    },
  });
  const { data: exchangeData, error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) {
    return errorRedirect(
      request,
      error.code ?? 'exchange_failed',
      markedRecovery,
      markedRecovery ? state.recoveryNext : state.signupNext,
      authResponse,
    );
  }

  const recovery = isRecoveryExchange(exchangeData);
  const next = recovery ? state.recoveryNext : state.signupNext;

  const { data, error: userError } = await supabase.auth.getUser();
  if (userError || !data.user) {
    try {
      await supabase.auth.signOut({ scope: 'local' });
    } catch {
      // The response cookies below are still expired even if local cleanup fails.
    }
    authResponse.cookies.forEach(({ options }, name) => {
      authResponse.cookies.set(name, {
        value: '',
        options: { ...options, expires: new Date(0), maxAge: 0 },
      });
    });
    return errorRedirect(request, 'exchange_failed', recovery, next, authResponse);
  }

  if (recovery) {
    return redirectTo(request, updatePasswordSessionReadyPath(next), false, authResponse);
  }

  const profile = await getProfileForUser(supabase, data.user.id);
  return redirectTo(
    request,
    isOnboarded(profile, data.user.email) ? next : onboardingPath(next),
    true,
    authResponse,
  );
}
