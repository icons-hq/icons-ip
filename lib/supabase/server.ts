import 'server-only';

import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { requireSupabaseConfig } from './config';
import { AUTH_SESSION_ONLY_COOKIE, isSessionOnlyPreference, supabaseAuthCookieOptions } from './session-persistence';

export interface ServerClientOptions {
  /**
   * 이 클라이언트가 쓰는 세션 쿠키를 브라우저 세션 쿠키로 쓸지('로그인 상태 유지'를 끈 로그인, SHEET-005).
   * 없으면 요청에 실린 표시 쿠키(AUTH_SESSION_ONLY_COOKIE)를 따른다 — 로그인 액션처럼 같은 응답에서 표시를 막 바꾼 곳만 넘긴다.
   */
  sessionOnly?: boolean;
  /** 첫 사용자 확인 GET에만 적용한다. 두 번째 확인과 토큰 갱신은 SDK의 시간을 그대로 쓴다. */
  firstUserLookupTimeoutMs?: number;
}

function fetchWithFirstUserLookupDeadline(url: string, timeoutMs: number): typeof fetch {
  const userUrl = `${url.replace(/\/$/, '')}/auth/v1/user`;
  let used = false;
  return (input, init) => {
    const request = input instanceof Request ? input : undefined;
    const method = init?.method ?? request?.method ?? 'GET';
    if (used || method !== 'GET' || (request?.url ?? String(input)) !== userUrl) return fetch(input, init);
    used = true;
    const signal = init?.signal ?? request?.signal;
    const deadline = AbortSignal.timeout(timeoutMs);
    return fetch(input, { ...init, signal: signal ? AbortSignal.any([signal, deadline]) : deadline });
  };
}

/** Supabase client for Server Components, Route Handlers and Server Actions. */
export async function createClient(options: ServerClientOptions = {}) {
  const cookieStore = await cookies();
  const { url, key } = requireSupabaseConfig();
  const sessionOnly = options.sessionOnly ?? isSessionOnlyPreference(cookieStore.get(AUTH_SESSION_ONLY_COOKIE)?.value);

  return createServerClient(
    url,
    key,
    {
      global: options.firstUserLookupTimeoutMs === undefined ? undefined : {
        fetch: fetchWithFirstUserLookupDeadline(url, options.firstUserLookupTimeoutMs),
      },
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options: cookieOptions }) => cookieStore.set(
              name,
              value,
              supabaseAuthCookieOptions(cookieOptions, value, sessionOnly),
            ));
          } catch {
            // Called from a Server Component — safe to ignore while middleware refreshes sessions.
          }
        },
      },
    },
  );
}
