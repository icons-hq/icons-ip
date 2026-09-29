import 'server-only';

import { redirect } from 'next/navigation';
import { getCurrentAdminAuthState } from '@/lib/auth/admin';

/** 미로그인은 복귀 경로로 이동하고, 권한 거절은 호출자가 폼 오류로 표시한다. */
export async function requireAdminActionAccess(pathname: string, options: { adminOnly?: boolean } = {}) {
  const auth = await getCurrentAdminAuthState();
  if (!auth.isConfigured || !auth.user) redirect(`/login?next=${encodeURIComponent(pathname)}`);
  if (!auth.isStaff || (options.adminOnly && auth.role !== 'admin')) return null;
  return { ...auth, user: auth.user };
}
