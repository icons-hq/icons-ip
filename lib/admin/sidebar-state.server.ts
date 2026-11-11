import 'server-only';
import { cookies } from 'next/headers';
import { adminNavigationCookieName } from './navigation-preferences';

/*
 * 어드민 셸이 첫 렌더에 읽는 쿠키. 사이드바 폭은 kit Sidebar(components/admin/kit/ui/sidebar.tsx)가 접고 펼 때마다
 * `sidebar_state`에 true/false를 남기고, 열린 메뉴 그룹·즐겨찾기는 계정별 쿠키에 남는다.
 * 값이 없거나 읽을 수 없으면 펼친 사이드바와 기본 메뉴(현재 그룹만 열림)로 그린다.
 */
export const ADMIN_SIDEBAR_COOKIE = 'sidebar_state';

export async function readAdminShellCookies(accountId: string): Promise<{ sidebarDefaultOpen: boolean; navigationCookie: string | null }> {
  try {
    const store = await cookies();
    return {
      sidebarDefaultOpen: store.get(ADMIN_SIDEBAR_COOKIE)?.value !== 'false',
      navigationCookie: store.get(adminNavigationCookieName(accountId))?.value ?? null,
    };
  } catch {
    return { sidebarDefaultOpen: true, navigationCookie: null };
  }
}
