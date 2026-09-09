import 'server-only';

import { getCurrentAdminAuthState } from '@/lib/auth/admin';
import { SECONDARY_MARKET_DEMO_ENABLED } from './secondary-market-demo';

/* 서버 게이트 — `/market`·`/exchange` page 가 시연 화면과 공개 플레이스홀더를 가르는 유일한 판정.
 * 경계는 어드민 콘솔과 같다(정지되지 않은 staff/admin). 푸터의 클라이언트 readback 은 진입점
 * 노출용일 뿐이고, URL 을 직접 열어도 이 판정을 통과해야 시연이 보인다. */
export async function canViewSecondaryMarketDemo(): Promise<boolean> {
  if (!SECONDARY_MARKET_DEMO_ENABLED) return false;
  const { isStaff } = await getCurrentAdminAuthState();
  return isStaff;
}
