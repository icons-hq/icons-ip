import { createServerClient } from '@supabase/ssr';
import { getSupabaseConfig } from '@/lib/supabase/config';

/*
 * 배포 뒤 스모크(scripts/post-deploy-smoke.mjs)와 외부 가동 감시가 부르는 익명 헬스 확인.
 * 비밀값·개인정보 없이 앱이 떴는지(200)와 DB 공개 읽기가 닿는지만 본다. DB 확인은 이미 공개인
 * get_storefront_settings 한 번이다. 어느 쪽이든 실패하면 503 — 응답에 오류 상세는 싣지 않는다.
 * 캐시하지 않는다(CDN·브라우저가 옛 200을 돌려주면 장애를 못 본다).
 */
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 15;
const headers = { 'Cache-Control': 'private, no-store, max-age=0' };

export async function GET() {
  const commit = process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 12) ?? null;
  const { url, key, isConfigured } = getSupabaseConfig();
  if (!isConfigured || !url || !key) {
    return Response.json({ ok: false, database: 'unconfigured', commit }, { status: 503, headers });
  }
  try {
    const client = createServerClient(url, key, { cookies: { getAll: () => [], setAll: () => {} } });
    const { error } = await client.rpc('get_storefront_settings');
    if (error) return Response.json({ ok: false, database: 'error', commit }, { status: 503, headers });
    return Response.json({ ok: true, database: 'ok', commit }, { headers });
  } catch {
    return Response.json({ ok: false, database: 'error', commit }, { status: 503, headers });
  }
}
