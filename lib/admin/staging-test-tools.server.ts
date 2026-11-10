import 'server-only';
import { createClient } from '@/lib/supabase/server';
import { PRODUCTION_SITE_HOST, PRODUCTION_SUPABASE_PROJECT_REF } from './staging-test-tools';

type RuntimeEnv = Record<string, string | undefined>;

/** 서버 쪽 1차 판별: 운영 배포이거나 운영 Supabase·운영 도메인을 가리키면 테스트 도구를 열지 않는다. */
export function stagingTestToolsRuntimeAllowed(env: RuntimeEnv = process.env): boolean {
  if (env.VERCEL_ENV === 'production') return false;
  const supabaseUrl = env.NEXT_PUBLIC_SUPABASE_URL?.trim() ?? '';
  if (!supabaseUrl || supabaseUrl.includes(PRODUCTION_SUPABASE_PROJECT_REF)) return false;
  const site = env.SITE_URL?.trim();
  if (site) {
    try {
      const host = new URL(site).hostname;
      if (host === PRODUCTION_SITE_HOST || host.endsWith(`.${PRODUCTION_SITE_HOST}`)) return false;
    } catch { return false; }
  }
  return true;
}

/** DB의 2차 판별(스테이징 시드의 허용 행) 결과까지 확인한다. 어느 쪽이든 실패하면 숨긴다. */
export async function stagingTestDeliveryAvailable(): Promise<boolean> {
  if (!stagingTestToolsRuntimeAllowed()) return false;
  try {
    const { data, error } = await (await createClient()).rpc('admin_staging_test_tools');
    return !error && typeof data === 'object' && data !== null && (data as Record<string, unknown>).testDelivery === true;
  } catch { return false; }
}
