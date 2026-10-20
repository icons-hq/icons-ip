import 'server-only';

import { redirect } from 'next/navigation';
import { getCurrentAdminAuthState } from '@/lib/auth/admin';
import { canAccessAdminScreen, type AdminCapability } from './access';
import { adminScreenForPath } from './navigation';

/** 미로그인은 복귀 경로로 이동하고, 권한 거절은 호출자가 폼 오류로 표시한다. */
export async function requireAdminActionAccess(pathname: string, options: { adminOnly?: boolean; capability?: AdminCapability } = {}) {
  const auth = await getCurrentAdminAuthState();
  if (!auth.isConfigured || !auth.user) redirect(`/login?next=${encodeURIComponent(pathname)}`);
  if (!auth.isStaff || !canAccessAdminScreen(auth, adminScreenForPath(pathname), { ...options, intent: 'write' })) return null;
  return { ...auth, user: auth.user };
}
