import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';
import { getSupabaseConfig } from './config';
import { AUTH_SESSION_ONLY_COOKIE, isSessionOnlyPreference, supabaseAuthCookieOptions } from './session-persistence';

/**
 * Refreshes the Supabase auth session on every request so it stays valid for
 * Server Components. Intentionally does NOT redirect unauthenticated users —
 * ICONS is a publicly browsable fandom site, so all pages stay open.
 *
 * No-op when Supabase env vars are absent (scaffolding stage), keeping the app
 * fully functional on mock data without a configured backend.
 */
export async function updateSession(request: NextRequest) {
  const supabaseResponse = NextResponse.next({ request });

  const { url, key, isConfigured } = getSupabaseConfig();
  if (!isConfigured || !url || !key) return supabaseResponse;

  let response = supabaseResponse;
  /* '로그인 상태 유지'를 끈 브라우저(SHEET-005)는 갱신한 세션도 브라우저 세션 쿠키로 다시 쓴다 — 400일로 되살리지 않는다. */
  const sessionOnly = isSessionOnlyPreference(request.cookies.get(AUTH_SESSION_ONLY_COOKIE)?.value);
  const supabase = createServerClient(url, key, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet, headers) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, supabaseAuthCookieOptions(options, value, sessionOnly)));
        Object.entries(headers).forEach(([name, value]) => response.headers.set(name, value));
      },
    },
  });

  // IMPORTANT: keep getClaims() directly after createServerClient — it refreshes the session.
  await supabase.auth.getClaims();

  return response;
}
