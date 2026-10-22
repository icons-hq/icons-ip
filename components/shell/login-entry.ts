import { nextPathWithSearch } from '@/lib/auth/onboarding';

/** 크롬(유틸바·헤더 계정 아이콘·전체 메뉴)의 로그인 진입 주소. 복귀 경로는 클릭 시점의 주소로 계산한다.
 *  로그인 화면 자신에서 누르면 지금 들고 있는 복귀 경로(next)를 그대로 넘긴다 — /login에도 전역 크롬이 서면서(CH-13)
 *  현재 주소를 다시 next로 감싸면 '/login?next=/login?next=…'처럼 복귀 경로가 겹겹이 중첩되기 때문이다. */
export function loginEntryHref(pathname: string, search: string): string {
  const params = new URLSearchParams(search);
  if (pathname === '/login') {
    const next = params.get('next');
    return next ? `/login?next=${encodeURIComponent(next)}` : '/login';
  }
  return `/login?next=${encodeURIComponent(nextPathWithSearch(pathname, params))}`;
}
