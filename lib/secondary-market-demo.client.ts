import { createClient } from '@/lib/supabase/client';
import { SECONDARY_MARKET_DEMO_ENABLED } from './secondary-market-demo';

/* 푸터 진입점용 브라우저 readback. lib/card-rewards/gate.client.ts 와 같은 계약 —
 * 시작값과 실패값은 모두 OFF 이고, 권한 경계는 서버 page 의 canViewSecondaryMarketDemo 다.
 * `is_staff()` 는 anon/authenticated 에 execute 가 열린 stable RPC 로, 호출자 자신의
 * 정지되지 않은 staff/admin 여부만 돌려준다. */
export async function fetchSecondaryMarketDemoVisible(): Promise<boolean> {
  if (!SECONDARY_MARKET_DEMO_ENABLED) return false;
  try {
    const { data, error } = await createClient().rpc('is_staff');
    return error === null && data === true;
  } catch {
    return false;
  }
}
