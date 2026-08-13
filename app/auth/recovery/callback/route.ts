import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';
import {
  AUTH_RECOVERY_NEXT_COOKIE_NAME,
  AUTH_RECOVERY_CALLBACK_PATH,
  passwordResetErrorLoginPath,
  publicPasswordRecoveryErrorCode,
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
import { getSupabaseConfig } from '@/lib/supabase/config';

function redirectTo(
  request: NextRequest,
  path: string,
  authResponse?: AuthResponseState,
) {
  const response = NextResponse.redirect(new URL(path, request.url));
  applyAuthResponseState(response, authResponse);
  response.cookies.set(AUTH_RECOVERY_NEXT_COOKIE_NAME, '', {
    path: AUTH_RECOVERY_CALLBACK_PATH,
    maxAge: 0,
  });
  return response;
}

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get('code');
  const signedState = authNextStateFromCookie(
    request.cookies.get(AUTH_RECOVERY_NEXT_COOKIE_NAME)?.value,
    Date.now(),
    authCookieSecret(),
  );
  const next = signedState?.purpose === 'recovery' ? signedState.next : '/';
  const providerError = request.nextUrl.searchParams.get('error_code')
    ?? request.nextUrl.searchParams.get('error');

  if (providerError) {
    return redirectTo(
      request,
      passwordResetErrorLoginPath(publicPasswordRecoveryErrorCode(providerError), next),
    );
  }
  if (!code) {
    return redirectTo(request, passwordResetErrorLoginPath('missing_code', next));
  }

  const { isConfigured, key, url } = getSupabaseConfig();
  if (!isConfigured || !url || !key) {
    return redirectTo(request, passwordResetErrorLoginPath('recovery_unavailable', next));
  }

  const authResponse = createAuthResponseState();
  const supabase = createServerClient(url, key, {
    cookies: authCallbackCookieAdapter(request, authResponse),
  });

  const { data: exchangeData, error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) {
    return redirectTo(
      request,
      passwordResetErrorLoginPath(publicPasswordRecoveryErrorCode(error.code), next),
      authResponse,
    );
  }
  if (signedState?.purpose !== 'recovery' || !isRecoveryExchange(exchangeData)) {
    await clearExchangedAuthSession(supabase, authResponse);
    return redirectTo(
      request,
      passwordResetErrorLoginPath('browser_mismatch', next),
      authResponse,
    );
  }

  const { data, error: userError } = await supabase.auth.getUser();
  if (userError || !data.user) {
    await clearExchangedAuthSession(supabase, authResponse);
    return redirectTo(
      request,
      passwordResetErrorLoginPath('session_not_found', next),
      authResponse,
    );
  }

  return redirectTo(request, updatePasswordSessionReadyPath(next), authResponse);
}
