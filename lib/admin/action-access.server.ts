import 'server-only';

import { redirect } from 'next/navigation';
import { getCurrentAdminAuthState } from '@/lib/auth/admin';
import { canAccessAdminScreen, type AdminCapability } from './access';
import { adminScreenForPath } from './navigation';

export interface AdminActionAccessOptions {
  adminOnly?: boolean;
  capability?: AdminCapability;
  /**
   * 미로그인·미설정일 때의 동작. 기본 `'redirect'`는 로그인으로 이동한다.
   * 화면이 백그라운드(useEffect·폴링)로 부르는 읽기 전용 액션만 `'error'`를 쓴다 — 입력 중인 화면을 갑자기 떠나지 않도록
   * 이동 대신 거절 결과(null)를 돌려준다. 권한 판정은 그대로다. 쓰기 액션에는 쓰지 않는다(action-guard-contract.test.ts).
   */
  onUnauthenticated?: 'redirect' | 'error';
}

/** 미로그인은 복귀 경로로 이동하고, 권한 거절은 호출자가 폼 오류로 표시한다. */
export async function requireAdminActionAccess(pathname: string, { onUnauthenticated = 'redirect', ...options }: AdminActionAccessOptions = {}) {
  const auth = await getCurrentAdminAuthState();
  if (!auth.isConfigured || !auth.user) {
    if (onUnauthenticated === 'error') return null;
    redirect(`/login?next=${encodeURIComponent(pathname)}`);
  }
  if (!auth.isStaff || !canAccessAdminScreen(auth, adminScreenForPath(pathname), { ...options, intent: 'write' })) return null;
  return { ...auth, user: auth.user };
}
