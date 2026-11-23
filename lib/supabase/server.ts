import 'server-only';

import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { requireSupabaseConfig } from './config';
import { AUTH_SESSION_ONLY_COOKIE, isSessionOnlyPreference, supabaseAuthCookieOptions } from './session-persistence';
import { createStorefrontReadCacheFetch } from './storefront-read-cache';

export interface ServerClientOptions {
  /**
   * 이 클라이언트가 쓰는 세션 쿠키를 브라우저 세션 쿠키로 쓸지('로그인 상태 유지'를 끈 로그인, SHEET-005).
   * 없으면 요청에 실린 표시 쿠키(AUTH_SESSION_ONLY_COOKIE)를 따른다 — 로그인 액션처럼 같은 응답에서 표시를 막 바꾼 곳만 넘긴다.
   */
  sessionOnly?: boolean;
  /** 첫 사용자 확인 GET에만 적용한다. 두 번째 확인과 토큰 갱신은 SDK의 시간을 그대로 쓴다. */
  firstUserLookupTimeoutMs?: number;
  /**
   * 쇼핑 화면(상품 상세·목록·홈)의 공개 조회를 짧게 공유 캐시한다(`storefront-read-cache.ts`의 허용 목록만).
   * 결제·관리자·본인 데이터 경로는 켜지 않는다.
   */
  storefrontReadCache?: boolean;
}

/** 성인 인증으로 19금 상품이 열린 방문자만 성인 등급 조회를 자기 세션으로 보낸다. 순환 import를 피해 늦게 읽는다. */
async function viewerSeesAdultGoods() {
  const { getAdultGoodsAccess } = await import('@/lib/adult-goods-access.server');
  return (await getAdultGoodsAccess()) === 'full';
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
  const lookupFetch = options.firstUserLookupTimeoutMs === undefined
    ? undefined
    : fetchWithFirstUserLookupDeadline(url, options.firstUserLookupTimeoutMs);
  /* 서버 액션·라우트 핸들러에서는 React cache가 요청 단위로 묶이지 않는다 — 클라이언트마다 판정을 한 번만 한다. */
  let adultDecision: Promise<boolean> | undefined;
  const clientFetch = options.storefrontReadCache
    ? createStorefrontReadCacheFetch({ anonKey: key, viewerSeesAdultGoods: () => (adultDecision ??= viewerSeesAdultGoods()), baseFetch: lookupFetch })
    : lookupFetch;

  return createServerClient(
    url,
    key,
    {
      global: clientFetch === undefined ? undefined : { fetch: clientFetch },
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
