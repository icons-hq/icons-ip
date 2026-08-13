import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';
import {
  ACCOUNT_SUSPENDED_PATH,
  AUTH_CALLBACK_PATH,
  AUTH_NEXT_COOKIE_NAME,
  authErrorLoginPath,
  isAccountSuspended,
  isOnboarded,
  onboardingPath,
  passwordResetErrorLoginPath,
  safeNextPath,
} from '@/lib/auth/onboarding';
import {
  applyAuthResponseState,
  authCallbackCookieAdapter,
  clearExchangedAuthSession,
  createAuthResponseState,
  isRecoveryExchange,
  type AuthResponseState,
} from '@/lib/auth/callback.server';
import { authCookieSecret, authNextStateFromCookie } from '@/lib/auth/recovery.server';
import { getProfileForUser } from '@/lib/auth/server';
import { getSupabaseConfig } from '@/lib/supabase/config';

function redirectTo(
  request: NextRequest,
  path: string,
  clearAuthNext = true,
  authResponse?: AuthResponseState,
) {
  const response = NextResponse.redirect(new URL(path, request.url));
  applyAuthResponseState(response, authResponse);
  if (clearAuthNext) {
    response.cookies.set(AUTH_NEXT_COOKIE_NAME, '', { path: AUTH_CALLBACK_PATH, maxAge: 0 });
  }
  return response;
}

function callbackState(request: NextRequest) {
  const cookieValue = request.cookies.get(AUTH_NEXT_COOKIE_NAME)?.value;
  const signedState = authNextStateFromCookie(cookieValue, Date.now(), authCookieSecret());
  const queryNext = request.nextUrl.searchParams.get('next');

  return {
    recoveryNext: signedState?.purpose === 'recovery' ? signedState.next : '/',
    loginNext: queryNext !== null
      ? safeNextPath(queryNext)
      : signedState?.purpose === 'signup' || signedState?.purpose === 'oauth'
        ? signedState.next
        : '/',
    signedState,
  };
}

function errorRedirect(
  request: NextRequest,
  code: string,
  next: string,
  authResponse?: AuthResponseState,
) {
  return redirectTo(
    request,
    authErrorLoginPath(code, next),
    true,
    authResponse,
  );
}

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get('code');
  const state = callbackState(request);
  const providerError = request.nextUrl.searchParams.get('error_code') ?? request.nextUrl.searchParams.get('error');

  if (providerError) {
    return errorRedirect(request, providerError, state.loginNext);
  }
  if (!code) {
    return errorRedirect(request, 'missing_code', state.loginNext);
  }

  const { isConfigured, key, url } = getSupabaseConfig();
  if (!isConfigured || !url || !key) {
    return errorRedirect(request, 'provider_disabled', state.loginNext);
  }

  const authResponse = createAuthResponseState();
  const supabase = createServerClient(url, key, {
    cookies: authCallbackCookieAdapter(request, authResponse),
  });
  const { data: exchangeData, error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) {
    return errorRedirect(request, error.code ?? 'exchange_failed', state.loginNext, authResponse);
  }

  if (isRecoveryExchange(exchangeData)) {
    await clearExchangedAuthSession(supabase, authResponse);
    return redirectTo(
      request,
      passwordResetErrorLoginPath('browser_mismatch', state.recoveryNext),
      true,
      authResponse,
    );
  }

  const { data, error: userError } = await supabase.auth.getUser();
  if (userError || !data.user) {
    await clearExchangedAuthSession(supabase, authResponse);
    return errorRedirect(request, 'exchange_failed', state.loginNext, authResponse);
  }

  const profile = await getProfileForUser(supabase, data.user.id);
  return redirectTo(
    request,
    isAccountSuspended(profile)
      ? ACCOUNT_SUSPENDED_PATH
      : isOnboarded(profile, data.user.email)
        ? state.loginNext
        : onboardingPath(state.loginNext),
    true,
    authResponse,
  );
}
