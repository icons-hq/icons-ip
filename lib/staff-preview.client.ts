import { parseOperatorAccess } from '@/lib/admin/access';
import { createClient } from '@/lib/supabase/client';

/** 로그인 계정의 현재 ICONS 운영 권한 — 스태프 전용 진입점의 노출에만 쓴다. */
export interface StaffAccess {
  /** 어드민 콘솔(`/admin`)에 들어갈 수 있다 — 어드민 셸 레이아웃의 `isStaff`와 같은 판정. */
  adminConsole: boolean;
  /** 그중 `platform.manage`를 가진다 — 비공개 시연·커뮤니티 프리뷰 서버 게이트와 같은 판정. */
  platformManage: boolean;
}

export const NO_STAFF_ACCESS: StaffAccess = { adminConsole: false, platformManage: false };

/** 비공개 ICONS 진입점의 현재 업무 권한 확인. `/admin` 서버 게이트(`getCurrentAdminAuthState`)와 같은 RPC·같은 파서를
 *  써서 판정이 갈라지지 않게 한다 — 운영 권한이 있고 `home`을 가져야 콘솔에 들어가고(셸 `isStaff`), `platform.manage`는
 *  그 위에서만 센다(`hasAdminCapability`). 오류·비정상 응답은 모두 닫힌다. 권한은 각 라우트 서버 게이트가 매 요청 다시 확인한다. */
export async function fetchStaffAccess(): Promise<StaffAccess> {
  try {
    const { data, error } = await createClient().rpc('admin_current_operator_access');
    if (error) return NO_STAFF_ACCESS;
    const access = parseOperatorAccess(data);
    if (!access || access.mode === 'none' || !access.capabilities.includes('home')) return NO_STAFF_ACCESS;
    return { adminConsole: true, platformManage: access.capabilities.includes('platform.manage') };
  } catch {
    return NO_STAFF_ACCESS;
  }
}
