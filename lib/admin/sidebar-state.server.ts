import 'server-only';
import { cookies } from 'next/headers';

/*
 * 어드민 사이드바 접힘 상태. kit Sidebar(components/admin/kit/ui/sidebar.tsx)가 접고 펼 때마다
 * `sidebar_state` 쿠키에 true/false를 남기고, 셸 레이아웃이 첫 렌더에 그 값을 돌려준다.
 * 값이 없거나 읽을 수 없으면 펼친 상태가 기본이다.
 */
export const ADMIN_SIDEBAR_COOKIE = 'sidebar_state';

export async function adminSidebarDefaultOpen(): Promise<boolean> {
  try {
    return (await cookies()).get(ADMIN_SIDEBAR_COOKIE)?.value !== 'false';
  } catch {
    return true;
  }
}
