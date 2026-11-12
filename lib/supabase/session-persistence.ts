import type { CookieOptions } from '@supabase/ssr';

/*
 * '로그인 상태 유지'(SHEET-005 · MD-0004 '로그인 정보 저장', 결정 "상태 유지 체크 추가").
 *
 * 기본(체크)은 지금 그대로다 — @supabase/ssr 가 세션 쿠키(sb-<ref>-auth-token…)를 400일로 남긴다. 로그인 화면에서 체크를 끄면
 * 이 브라우저에 표시 쿠키(AUTH_SESSION_ONLY_COOKIE)를 세션 쿠키로 남기고, 그 표시가 있는 동안 쓰기 지점(서버 클라이언트·
 * 요청 프록시·브라우저 클라이언트·로그인 공용 콜백 — 소셜 로그인, lib/auth/callback.server.ts)이 Supabase 세션 쿠키를
 * Max-Age·Expires 없는 브라우저 세션 쿠키로 쓴다(비밀번호 재설정 콜백 세션은 로그인 폼 선택과 무관해 제외) — 브라우저를 닫으면
 * 표시와 세션이 함께 사라져 다음 방문은 로그아웃 상태다(공용 PC). 표시 쿠키는 브라우저 클라이언트의 토큰 갱신도 따라야 해서
 * HttpOnly가 아니다(값은 '이 브라우저는 유지하지 않음' 하나뿐이다).
 *
 * @supabase/ssr 0.12 는 cookieOptions.maxAge 를 무시하고 매번 400일을 넣는다(dist/main/cookies.js setCookieOptions) —
 * 그래서 옵션이 아니라 쓰는 순간(setAll)에 속성을 바꾼다. 지우는 쿠키(값 '' 또는 Max-Age 0)는 그대로 둔다.
 */
export const AUTH_SESSION_ONLY_COOKIE = 'icons_auth_session_only';
const AUTH_SESSION_ONLY_VALUE = '1';

/** 표시 쿠키의 값이 '유지하지 않음'인가. */
export function isSessionOnlyPreference(value: string | null | undefined): boolean {
  return value === AUTH_SESSION_ONLY_VALUE;
}

/** 표시 쿠키를 남길 때의 값과 속성 — 브라우저 세션 쿠키(Max-Age 없음), 브라우저 클라이언트가 읽도록 HttpOnly 아님. */
export function sessionOnlyPreferenceCookie(secure: boolean): { name: string; value: string; options: CookieOptions } {
  return {
    name: AUTH_SESSION_ONLY_COOKIE,
    value: AUTH_SESSION_ONLY_VALUE,
    options: { path: '/', sameSite: 'lax', httpOnly: false, secure },
  };
}

/**
 * Supabase 가 넘긴 쿠키 속성을 '로그인 상태 유지' 선택에 맞춘다. 유지하지 않는 브라우저(sessionOnly)에서 값이 있는 쿠키만
 * Max-Age·Expires 를 떼어 브라우저 세션 쿠키로 만든다. 유지(기본)·지우는 쿠키는 받은 속성을 그대로(같은 객체로) 돌려준다.
 */
export function supabaseAuthCookieOptions(options: CookieOptions, value: string, sessionOnly: boolean): CookieOptions {
  if (!sessionOnly || value === '' || options.maxAge === 0) return options;
  const sessionCookie = { ...options };
  delete sessionCookie.maxAge;
  delete sessionCookie.expires;
  return sessionCookie;
}

/* ------------------------------------------------------------------
 * 브라우저 클라이언트의 쿠키 읽기·쓰기 — @supabase/ssr 기본(document.cookie + cookie@1 parse·serialize)과 같은 형식이고,
 * 쓰기만 위 규칙을 거친다. 기본 구현은 export 되지 않아 같은 형식을 여기 둔다(lib/supabase/session-persistence.test.ts 가 형식을 잠근다).
 * ------------------------------------------------------------------ */

function decodeCookieValue(raw: string): string {
  if (!raw.includes('%')) return raw;
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

/** `document.cookie` 문자열 → 이름·값 목록. 같은 이름은 첫 값만(cookie@1 parse 와 같다), 값은 '%'가 있을 때만 디코드한다. */
export function parseCookieHeader(header: string): Array<{ name: string; value: string }> {
  const seen = new Set<string>();
  const cookies: Array<{ name: string; value: string }> = [];
  for (const pair of header.split(';')) {
    const separator = pair.indexOf('=');
    if (separator === -1) continue;
    const name = pair.slice(0, separator).trim();
    if (!name || seen.has(name)) continue;
    seen.add(name);
    cookies.push({ name, value: decodeCookieValue(pair.slice(separator + 1).trim()) });
  }
  return cookies;
}

const SAME_SITE: Record<string, string> = { true: 'Strict', strict: 'Strict', lax: 'Lax', none: 'None' };
const PRIORITY: Record<string, string> = { low: 'Low', medium: 'Medium', high: 'High' };

/** `document.cookie` 에 넣을 문자열 — cookie@1 stringifySetCookie 와 같은 속성 순서·표기다(HttpOnly 는 브라우저가 무시한다). */
export function serializeCookie(name: string, value: string, options: CookieOptions = {}): string {
  let cookie = `${name}=${value ? encodeURIComponent(value) : ''}`;
  if (options.maxAge !== undefined) cookie += `; Max-Age=${options.maxAge}`;
  if (options.domain) cookie += `; Domain=${options.domain}`;
  if (options.path) cookie += `; Path=${options.path}`;
  if (options.expires) cookie += `; Expires=${options.expires.toUTCString()}`;
  if (options.httpOnly) cookie += '; HttpOnly';
  if (options.secure) cookie += '; Secure';
  if (options.partitioned) cookie += '; Partitioned';
  if (options.priority) cookie += `; Priority=${PRIORITY[String(options.priority).toLowerCase()] ?? options.priority}`;
  if (options.sameSite) cookie += `; SameSite=${SAME_SITE[String(options.sameSite).toLowerCase()] ?? options.sameSite}`;
  return cookie;
}

interface DocumentCookieTarget {
  cookie: string;
}

/** 브라우저 클라이언트에 넘길 쿠키 메서드. 쓰는 순간의 표시 쿠키로 유지 여부를 고른다(다른 탭에서 바뀐 선택도 따른다). */
export function browserAuthCookieMethods(target: () => DocumentCookieTarget | null = () => (typeof document === 'undefined' ? null : document)) {
  return {
    getAll(): Array<{ name: string; value: string }> {
      const doc = target();
      return doc ? parseCookieHeader(doc.cookie) : [];
    },
    setAll(cookiesToSet: Array<{ name: string; value: string; options: CookieOptions }>): void {
      const doc = target();
      if (!doc) throw new Error('supabase_browser_cookie_write_outside_browser');
      const sessionOnly = isSessionOnlyPreference(parseCookieHeader(doc.cookie).find(({ name }) => name === AUTH_SESSION_ONLY_COOKIE)?.value);
      for (const { name, value, options } of cookiesToSet) {
        doc.cookie = serializeCookie(name, value, supabaseAuthCookieOptions(options, value, sessionOnly));
      }
    },
  };
}
