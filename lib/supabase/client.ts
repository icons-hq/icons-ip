import { createBrowserClient } from '@supabase/ssr';
import { requireSupabaseConfig } from './config';
import { browserAuthCookieMethods } from './session-persistence';

/** Supabase client for Client Components. 토큰 갱신이 쓰는 세션 쿠키도 '로그인 상태 유지' 선택을 따른다(SHEET-005). */
export function createClient() {
  const { url, key } = requireSupabaseConfig();
  return createBrowserClient(url, key, { cookies: browserAuthCookieMethods() });
}
