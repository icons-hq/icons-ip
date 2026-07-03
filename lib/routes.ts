/* prototype route-id -> Next.js path mapping + nav config */

export interface NavItem {
  id: string;
  label: string;
  icon?: string;
}

export const NAV_ITEMS: NavItem[] = [
  { id: 'home', label: '홈' },
  { id: 'iphub', label: 'IP 허브' },
  { id: 'shop', label: '굿즈샵' },
  { id: 'gacha', label: '뽑기' },
  { id: 'events', label: '팝업' },
  { id: 'community', label: '커뮤니티' },
];

/* 모바일 바텀탭 — 디자인 핸드오프의 페이지별 4탭 변형을 다수결 구성으로 고정 */
export const MOB_ITEMS: NavItem[] = [
  { id: 'home', label: '홈' },
  { id: 'shop', label: '굿즈샵' },
  { id: 'gacha', label: '뽑기' },
  { id: 'community', label: '커뮤니티' },
];

const PATHS: Record<string, string> = {
  home: '/',
  iphub: '/ip',
  shop: '/shop',
  gacha: '/gacha',
  binder: '/binder',
  events: '/events',
  community: '/community',
  exchange: '/exchange',
  market: '/market',
  search: '/search',
  login: '/login',
  cart: '/shop', // prototype had no dedicated cart route
};

export function hrefFor(route: string, param?: string | null): string {
  if (route === 'ip') return param ? `/ip/${param}` : '/ip';
  return PATHS[route] ?? '/';
}

/** does the given prototype route-id correspond to the current pathname? */
export function isActive(route: string, pathname: string): boolean {
  const href = hrefFor(route);
  if (href === '/') return pathname === '/';
  return pathname === href || pathname.startsWith(href + '/');
}
