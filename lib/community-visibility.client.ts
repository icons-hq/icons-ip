import { createClient } from '@/lib/supabase/client';
import { COMMUNITY_ENABLED, COMMUNITY_STAFF_PREVIEW_ENABLED } from './community-visibility';

/* 푸터 스태프 전용 진입점용 브라우저 readback. `lib/secondary-market-demo.client.ts` 와 같은
 * 계약 — 시작값과 실패값은 모두 OFF 이고, 권한 경계는 서버의 canViewCommunity 다.
 * `is_staff()` 는 anon/authenticated 에 execute 가 열린 stable RPC 로, 호출자 자신의
 * 정지되지 않은 staff/admin 여부만 돌려준다.
 *
 * 서버 게이트와 달리 공개 스위치가 켜진 배포에서는 false 다 — 그때는 푸터 발견 열에 공개
 * 커뮤니티 링크가 돌아오므로 "스태프 전용" 이라고 적힌 블록이 남으면 거짓말이 된다. */
export async function fetchCommunityStaffPreviewVisible(): Promise<boolean> {
  if (COMMUNITY_ENABLED || !COMMUNITY_STAFF_PREVIEW_ENABLED) return false;
  try {
    const { data, error } = await createClient().rpc('is_staff');
    return error === null && data === true;
  } catch {
    return false;
  }
}
