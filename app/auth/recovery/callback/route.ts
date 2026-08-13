import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';
import {
  AUTH_RECOVERY_NEXT_COOKIE_NAME,
  AUTH_RECOVERY_CALLBACK_PATH,
  passwordResetErrorLoginPath,
  publicPasswordRecoveryErrorCode,
  updatePasswordSessionReadyPath,
} from '@/lib/auth/onboarding';
import { authCookieSecret, authNextStateFromCookie } from '@/lib/auth/recovery.server';
import { getSupabaseConfig } from '@/lib/supabase/config';

interface AuthResponseState {
  cookies: Map<string, { value: string; options: CookieOptions }>;
  headers: Map<string, string>;
}

function redirectTo(
  request: NextRequest,
  path: string,
  authResponse?: AuthResponseState,
) {
  const response = NextResponse.redirect(new URL(path, request.url));
  authResponse?.cookies.forEach(({ value, options }, name) => {
    response.cookies.set(name, value, options);
  });
  authResponse?.headers.forEach((value, name) => {
    response.headers.set(name, value);
  });
  response.cookies.set(AUTH_RECOVERY_NEXT_COOKIE_NAME, '', {
    path: AUTH_RECOVERY_CALLBACK_PATH,
    maxAge: 0,
  });
  if (!response.headers.has('cache-control')) {
    response.headers.set('cache-control', 'private, no-store');
  }
  return response;
}

function isRecoveryExchange(data: unknown) {
  return Boolean(
    data
    && typeof data === 'object'
    && 'redirectType' in data
    && data.redirectType === 'recovery',
  );
}

async function clearExchangedSession(
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
    return redirectTo(
      request,
      passwordResetErrorLoginPath(publicPasswordRecoveryErrorCode(error.code), next),
      authResponse,
    );
  }
  if (signedState?.purpose !== 'recovery' || !isRecoveryExchange(exchangeData)) {
    await clearExchangedSession(supabase, authResponse);
    return redirectTo(
      request,
      passwordResetErrorLoginPath('browser_mismatch', next),
      authResponse,
    );
  }

  const { data, error: userError } = await supabase.auth.getUser();
  if (userError || !data.user) {
    await clearExchangedSession(supabase, authResponse);
    return redirectTo(
      request,
      passwordResetErrorLoginPath('session_not_found', next),
      authResponse,
    );
  }

  return redirectTo(request, updatePasswordSessionReadyPath(next), authResponse);
}
