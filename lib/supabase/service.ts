import 'server-only';

import { createClient as createSupabaseClient } from '@supabase/supabase-js';

/* service role 클라이언트 — RLS를 우회하므로 서버 신뢰 경계 안(웹훅·결제 승인 경로)에서만 쓴다.
 * 클라이언트 번들·NEXT_PUBLIC_ env 노출 금지(AGENTS.md). */

export function getServiceRoleConfig() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  return { url, key, isConfigured: Boolean(url && key) };
}

export function createServiceClient() {
  const { url, key } = getServiceRoleConfig();
  if (!url || !key) {
    throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  }

  return createSupabaseClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
