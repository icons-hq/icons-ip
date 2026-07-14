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
  { id: 'packs', label: '카드팩' },
  { id: 'events', label: '팝업' },
  { id: 'community', label: '커뮤니티' },
];

/* 모바일 바텀탭 — 핵심 표면 4개 + 실장바구니 진입점 */
export const MOB_ITEMS: NavItem[] = [
  { id: 'home', label: '홈' },
  { id: 'shop', label: '굿즈샵' },
  { id: 'packs', label: '카드팩' },
  { id: 'community', label: '커뮤니티' },
  { id: 'cart', label: '장바구니' },
];

const PATHS: Record<string, string> = {
  home: '/',
  iphub: '/ip',
  shop: '/shop',
  packs: '/packs',
  binder: '/binder',
  events: '/events',
  community: '/community',
  exchange: '/exchange',
  market: '/market',
  search: '/search',
  login: '/login',
  cart: '/cart',
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
