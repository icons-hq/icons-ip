import 'server-only';

import { getCurrentAdminAuthState } from '@/lib/auth/admin';
import { COMMUNITY_ENABLED, COMMUNITY_STAFF_PREVIEW_ENABLED } from './community-visibility';

/* 서버 게이트 — `/community` 라우트와 커뮤니티 서버 액션이 공유하는 유일한 열람 판정.
 * 공개 스위치가 켜지면 누구나, 꺼져 있으면 스태프 프리뷰가 켜진 동안 정지되지 않은
 * staff/admin 만 통과한다(경계는 어드민 콘솔과 같다). 푸터의 클라이언트 readback 은
 * 진입점 노출용일 뿐이고, URL 을 직접 열거나 폼 없이 액션을 호출해도 이 판정을 거친다. */
export async function canViewCommunity(): Promise<boolean> {
  if (COMMUNITY_ENABLED) return true;
  if (!COMMUNITY_STAFF_PREVIEW_ENABLED) return false;
  const { isStaff } = await getCurrentAdminAuthState();
  return isStaff;
}
