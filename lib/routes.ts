/* GNB·모바일 탭·유틸·푸터·메뉴 항목의 단일 진실원이다. 표면마다 자체 배열을 들고 있으면 항목이 조용히 갈라진다.
   components/shell/SiteFooter.tsx의 자체 링크 튜플은 S2 재작성에서 FOOTER_* 상수로 흡수했다.
   아직 여기로 모이지 않은 잔여물은 하나다: components/screens/Home.tsx의 하드코딩 내비게이션(S3에서 제거). */

export interface NavItem {
  id: string;
  label: string;
  icon?: string;
}

/* 데스크톱 GNB — 카탈로그 진입(NEW·BEST·카테고리)을 앞에 두고 그 뒤에 세계관 표면을 잇는다. */
export const NAV_ITEMS: NavItem[] = [
  { id: 'new', label: 'NEW' },
  { id: 'best', label: 'BEST' },
  { id: 'shop', label: '카테고리' },
  { id: 'iphub', label: '온라인 팝업' },
  { id: 'packs', label: '카드팩' },
  { id: 'events', label: '이벤트' },
  { id: 'community', label: '커뮤니티' },
];

/* 모바일 바텀 탭 5개 — 가운데가 홈이다.
   'menu'만 라우트가 없는 액션 탭이라 링크가 아니라 전체 메뉴 시트를 연다. */
export const MOB_ITEMS: NavItem[] = [
  { id: 'menu', label: '메뉴' },
  { id: 'shop', label: '굿즈샵' },
  { id: 'home', label: '홈' },
  { id: 'wish', label: '위시' },
  { id: 'my', label: '마이' },
];

/* 헤더 우측 유틸 — 내비게이션 위계가 아니라 계정 활동 진입점이라 NAV와 분리한다. */
export const UTIL_ITEMS: NavItem[] = [
  { id: 'orders', label: '주문조회' },
  { id: 'notifications', label: '알림함' },
];

const PATHS: Record<string, string> = {
  home: '/',
  new: '/shop/new',
  best: '/shop/best',
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
  checkout: '/checkout',
  orders: '/orders',
  tickets: '/tickets',
  my: '/my',
  wish: '/my/wishlist',
  notifications: '/notifications',
  about: '/about',
  /* 법정 고지 — 슬러그 표기와 헬퍼는 lib/legal/links.ts가 감싼다. */
  terms: '/legal/terms',
  privacy: '/legal/privacy',
  shipping: '/legal/shipping',
  /* 'menu'는 일부러 비워 둔다. 목적지가 없는 액션 탭이라 경로를 주면 없는 페이지로 이동한다.
     바텀바가 이 id를 링크가 아닌 시트 트리거로 특별 취급한다. */
};

/** 함정: 미등록 id는 '/'로 폴백한다. 오타 하나가 홈 링크로 둔갑해 조용히 통과하므로 새 항목은 반드시 PATHS에 등록한다. */
export function hrefFor(route: string, param?: string | null): string {
  if (route === 'ip') return param ? `/ip/${param}` : '/ip';
  return PATHS[route] ?? '/';
}

/** hrefFor가 실제 경로를 돌려주는 id인지 — '/' 폴백과 진짜 홈('/')을 구분한다. */
function hasPath(route: string): boolean {
  return route === 'ip' || route in PATHS;
}

/** does the given prototype route-id correspond to the current pathname? */
export function isActive(route: string, pathname: string): boolean {
  const href = hrefFor(route);
  if (href === '/') return pathname === '/';
  return pathname === href || pathname.startsWith(href + '/');
}

/** pathname에 가장 특정하게 매칭되는 nav 항목 id 하나를 고른다 (없으면 null).
    '/shop/new'에서 '카테고리(/shop)'가 아니라 'NEW(/shop/new)'가 이겨야 해서 최장 href가 우선한다. */
export function activeNavId(pathname: string, items: NavItem[] = NAV_ITEMS): string | null {
  let activeId: string | null = null;
  let activeLength = -1;
  for (const item of items) {
    /* 경로 없는 항목은 hrefFor가 '/'로 폴백해 홈에서만 거짓 매칭된다 — 후보에서 아예 뺀다. */
    if (!hasPath(item.id)) continue;
    if (!isActive(item.id, pathname)) continue;
    const length = hrefFor(item.id).length;
    if (length > activeLength) {
      activeId = item.id;
      activeLength = length;
    }
  }
  return activeId;
}

export function isAuthShellPath(pathname: string): boolean {
  return pathname === '/login'
    || pathname === '/update-password'
    || pathname === '/account-suspended';
}

/* 제목 있는 링크 묶음 — 메가메뉴와 모바일 시트가 같은 모양을 공유한다. */
export interface NavGroup {
  heading: string;
  items: NavItem[];
}

/* 푸터 상단 행 — 회사·정책. 법정 고지 3종은 lib/legal/links.ts가 컴포넌트에서 이어 붙인다.
   '오프라인 팝업'은 전용 경로(S8)가 생기기 전까지 현행 예매 표면(/events)으로 진입한다. */
export const FOOTER_PRIMARY_ITEMS: NavItem[] = [
  { id: 'about', label: '회사 소개' },
  { id: 'events', label: '오프라인 팝업' },
];

export const FOOTER_DISCOVER_ITEMS: NavItem[] = [
  { id: 'iphub', label: '온라인 팝업' },
  { id: 'shop', label: '굿즈샵' },
  { id: 'packs', label: '카드팩' },
  { id: 'events', label: '이벤트' },
  { id: 'community', label: '커뮤니티' },
];

export const FOOTER_ACCOUNT_ITEMS: NavItem[] = [
  { id: 'orders', label: '주문조회' },
  { id: 'tickets', label: '내 티켓' },
  { id: 'binder', label: '바인더' },
  { id: 'wish', label: '위시리스트' },
  { id: 'notifications', label: '알림함' },
  { id: 'exchange', label: '카드 트레이드' },
  { id: 'market', label: '굿즈 마켓' },
];

/* 카테고리 메가메뉴 — goods.type 표준화(S4) 전까지 실존 라우트 그룹만 노출한다. */
export const CATEGORY_MEGA_GROUPS: NavGroup[] = [
  { heading: '굿즈샵', items: [
    { id: 'shop', label: '전체 굿즈' },
    { id: 'new', label: 'NEW' },
    { id: 'best', label: 'BEST' },
  ] },
  { heading: '수집', items: [
    { id: 'packs', label: '카드팩' },
    { id: 'binder', label: '바인더' },
  ] },
  { heading: '거래', items: [
    { id: 'market', label: '굿즈 마켓' },
    { id: 'exchange', label: '카드 트레이드' },
  ] },
];

/* 모바일 전체 메뉴 시트 — 바텀바 '메뉴' 탭과 모바일 GNB '카테고리' 탭이 함께 연다. */
export const MENU_SHEET_GROUPS: NavGroup[] = [
  { heading: '쇼핑', items: [
    { id: 'shop', label: '전체 굿즈' },
    { id: 'new', label: 'NEW' },
    { id: 'best', label: 'BEST' },
    { id: 'packs', label: '카드팩' },
  ] },
  { heading: '세계', items: [
    { id: 'iphub', label: '온라인 팝업' },
    { id: 'events', label: '이벤트' },
    { id: 'community', label: '커뮤니티' },
  ] },
  { heading: '내 활동', items: [
    { id: 'orders', label: '주문조회' },
    { id: 'tickets', label: '내 티켓' },
    { id: 'binder', label: '바인더' },
    { id: 'wish', label: '위시리스트' },
    { id: 'notifications', label: '알림함' },
    { id: 'my', label: '마이페이지' },
  ] },
  { heading: '거래', items: [
    { id: 'market', label: '굿즈 마켓' },
    { id: 'exchange', label: '카드 트레이드' },
  ] },
];
