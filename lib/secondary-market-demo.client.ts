import { createClient } from '@/lib/supabase/client';
import { SECONDARY_MARKET_DEMO_ENABLED } from './secondary-market-demo';

/* 푸터 진입점용 브라우저 readback. lib/card-rewards/gate.client.ts 와 같은 계약 —
 * 시작값과 실패값은 모두 OFF 이고, 권한 경계는 서버 page 의 canViewSecondaryMarketDemo 다.
 * `has_operator_capability()`는 호출자 자신의 현재 ICONS 운영 권한만 확인한다. */
export async function fetchSecondaryMarketDemoVisible(): Promise<boolean> {
  if (!SECONDARY_MARKET_DEMO_ENABLED) return false;
  try {
    const { data, error } = await createClient().rpc('has_operator_capability', { p_capability: 'platform.manage' });
    return error === null && data === true;
  } catch {
    return false;
  }
}
