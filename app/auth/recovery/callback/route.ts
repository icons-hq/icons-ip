import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';
import {
  AUTH_RECOVERY_NEXT_COOKIE_NAME,
  AUTH_RECOVERY_CALLBACK_PATH,
  AUTH_RECOVERY_PROOF_COOKIE_NAME,
  passwordResetErrorLoginPath,
  publicPasswordRecoveryErrorCode,
  updatePasswordSessionReadyPath,
} from '@/lib/auth/onboarding';
import {
  applyAuthResponseState,
  authCallbackCookieAdapter,
  clearExchangedAuthSession,
  createAuthResponseState,
  type AuthResponseState,
} from '@/lib/auth/callback.server';
import {
  authCookieSecret,
  authNextStateFromCookie,
  passwordRecoveryProofCookieOptions,
  signedPasswordRecoveryProofValue,
} from '@/lib/auth/recovery.server';
import { getSupabaseConfig } from '@/lib/supabase/config';

function redirectTo(
  request: NextRequest,
  path: string,
  authResponse?: AuthResponseState,
  clearRecoveryState = false,
) {
  const response = NextResponse.redirect(new URL(path, request.url));
  applyAuthResponseState(response, authResponse);
  if (clearRecoveryState) {
    response.cookies.set(AUTH_RECOVERY_NEXT_COOKIE_NAME, '', {
      path: AUTH_RECOVERY_CALLBACK_PATH,
      maxAge: 0,
    });
  }
  return response;
}

export async function GET(request: NextRequest) {
  const tokenHash = request.nextUrl.searchParams.get('token_hash');
  const tokenType = request.nextUrl.searchParams.get('type');
  const secret = authCookieSecret();
  const signedState = authNextStateFromCookie(
    request.cookies.get(AUTH_RECOVERY_NEXT_COOKIE_NAME)?.value,
    Date.now(),
    secret,
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
  if (!tokenHash) {
    return redirectTo(request, passwordResetErrorLoginPath('missing_code', next));
  }
  if (tokenType !== 'recovery') {
    return redirectTo(request, passwordResetErrorLoginPath('browser_mismatch', next));
  }
  if (signedState?.purpose !== 'recovery') {
    return redirectTo(request, passwordResetErrorLoginPath('browser_mismatch'));
  }

  const { isConfigured, key, url } = getSupabaseConfig();
  if (!isConfigured || !url || !key) {
    return redirectTo(request, passwordResetErrorLoginPath('recovery_unavailable', next));
  }

  const authResponse = createAuthResponseState();
  const supabase = createServerClient(url, key, {
    cookies: authCallbackCookieAdapter(request, authResponse),
  });

  const { data: verificationData, error } = await supabase.auth.verifyOtp({
    token_hash: tokenHash,
    type: 'recovery',
  });
  if (error) {
    return redirectTo(
      request,
      passwordResetErrorLoginPath(publicPasswordRecoveryErrorCode(error.code), next),
      authResponse,
    );
  }
  const isVerifiedRecovery = Boolean(verificationData?.session && verificationData?.user);
  if (signedState?.purpose !== 'recovery' || !isVerifiedRecovery) {
    await clearExchangedAuthSession(supabase, authResponse);
    return redirectTo(
      request,
      passwordResetErrorLoginPath('browser_mismatch', next),
      authResponse,
    );
  }

  const { data, error: userError } = await supabase.auth.getUser();
  const claims = data.user && !userError ? (await supabase.auth.getClaims()).data?.claims : null;
  const sessionId = claims && claims.sub === data.user?.id ? claims.session_id : null;
  if (userError || !data.user || !secret || typeof sessionId !== 'string') {
    await clearExchangedAuthSession(supabase, authResponse);
    return redirectTo(
      request,
      passwordResetErrorLoginPath('session_not_found', next),
      authResponse,
    );
  }

  // /update-password가 비밀번호를 받는 유일한 근거 — 이 콜백을 통과한 그 세션에만 짧게 남긴다.
  const response = redirectTo(request, updatePasswordSessionReadyPath(next), authResponse, true);
  response.cookies.set(
    AUTH_RECOVERY_PROOF_COOKIE_NAME,
    signedPasswordRecoveryProofValue({ sessionId, userId: data.user.id }, Date.now(), secret),
    passwordRecoveryProofCookieOptions(request.nextUrl.protocol === 'https:'),
  );
  return response;
}
