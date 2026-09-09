import 'server-only';

import { getCurrentAdminAuthState } from '@/lib/auth/admin';
import { AOUAD_POPUP_ENABLED, AOUAD_POPUP_PUBLIC } from './aouad-popup';

/** 로컬 브라우저 QA용. Preview/production 빌드는 환경 변수가 남아도 우회하지 못한다. */
export function isAouadLocalPreviewEnabled(): boolean {
  return process.env.NODE_ENV === 'development'
    && process.env.ICONS_AOUAD_LOCAL_PREVIEW === '1';
}

/** 직접 URL 진입도 어드민과 같은 정지되지 않은 staff/admin 경계를 매 요청 통과한다. */
export async function canViewAouadPopup(): Promise<boolean> {
  if (!AOUAD_POPUP_ENABLED) return false;
  if (AOUAD_POPUP_PUBLIC || isAouadLocalPreviewEnabled()) return true;
  const { isStaff } = await getCurrentAdminAuthState();
  return isStaff;
}
