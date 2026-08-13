import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';
import {
  ACCOUNT_SUSPENDED_PATH,
  AUTH_CALLBACK_PATH,
  AUTH_NEXT_COOKIE_NAME,
  authErrorLoginPath,
  isAccountSuspended,
  postAuthenticationPath,
  passwordResetErrorLoginPath,
  publicPasswordRecoveryErrorCode,
  safeNextPath,
  updatePasswordSessionReadyPath,
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
    legacyRecoveryNext: signedState?.purpose === 'recovery' ? signedState.next : '/',
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
    if (state.signedState?.purpose === 'recovery') {
      return redirectTo(
        request,
        passwordResetErrorLoginPath(
          publicPasswordRecoveryErrorCode(providerError),
          state.legacyRecoveryNext,
        ),
      );
    }
    return errorRedirect(request, providerError, state.loginNext);
  }
  if (!code) {
    if (state.signedState?.purpose === 'recovery') {
      return redirectTo(
        request,
        passwordResetErrorLoginPath('missing_code', state.legacyRecoveryNext),
      );
    }
    return errorRedirect(request, 'missing_code', state.loginNext);
  }

  const { isConfigured, key, url } = getSupabaseConfig();
  if (!isConfigured || !url || !key) {
    if (state.signedState?.purpose === 'recovery') {
      return redirectTo(
        request,
        passwordResetErrorLoginPath('recovery_unavailable', state.legacyRecoveryNext),
      );
    }
    return errorRedirect(request, 'provider_disabled', state.loginNext);
  }

  const authResponse = createAuthResponseState();
  const supabase = createServerClient(url, key, {
    cookies: authCallbackCookieAdapter(request, authResponse),
  });
  const { data: exchangeData, error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) {
    if (state.signedState?.purpose === 'recovery') {
      return redirectTo(
        request,
        passwordResetErrorLoginPath(
          publicPasswordRecoveryErrorCode(error.code),
          state.legacyRecoveryNext,
        ),
        true,
        authResponse,
      );
    }
    return errorRedirect(request, error.code ?? 'exchange_failed', state.loginNext, authResponse);
  }

  if (isRecoveryExchange(exchangeData) && state.signedState?.purpose !== 'recovery') {
    await clearExchangedAuthSession(supabase, authResponse);
    return redirectTo(
      request,
      passwordResetErrorLoginPath('browser_mismatch'),
      true,
      authResponse,
    );
  }

  const { data, error: userError } = await supabase.auth.getUser();
  if (userError || !data.user) {
    await clearExchangedAuthSession(supabase, authResponse);
    if (state.signedState?.purpose === 'recovery' && isRecoveryExchange(exchangeData)) {
      return redirectTo(
        request,
        passwordResetErrorLoginPath('session_not_found', state.legacyRecoveryNext),
        true,
        authResponse,
      );
    }
    return errorRedirect(request, 'exchange_failed', state.loginNext, authResponse);
  }

  // Keep links issued before the dedicated callback rollout usable for one Auth-link TTL.
  // redirectType is only a local PKCE marker, so it never authorizes recovery by itself.
  if (state.signedState?.purpose === 'recovery' && isRecoveryExchange(exchangeData)) {
    return redirectTo(
      request,
      updatePasswordSessionReadyPath(state.legacyRecoveryNext),
      true,
      authResponse,
    );
  }

  const profile = await getProfileForUser(supabase, data.user.id);
  return redirectTo(
    request,
    isAccountSuspended(profile)
      ? ACCOUNT_SUSPENDED_PATH
      : postAuthenticationPath(profile, data.user.email, state.loginNext),
    true,
    authResponse,
  );
}
