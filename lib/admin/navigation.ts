/*
 * 어드민 정보구조(IA) — 대분류 > 소분류 2단 메뉴와 화면별 라우트.
 *
 * 서버 컴포넌트(layout·page)와 클라이언트 사이드바가 같은 정의를 봐야 해서
 * 'use client' 없는 순수 모듈로 둔다. 화면을 추가할 때 여기 한 곳만 고치면
 * 사이드바·헤더 제목·레거시 리다이렉트가 함께 따라온다.
 */

/** 화면이 실제로 구현됐는지. `planned`는 메뉴에 자리만 두고 라우트가 없다. */
export type AdminScreenStatus = 'ready' | 'planned';

export interface AdminScreen {
  id: string;
  label: string;
  href: string;
  status: AdminScreenStatus;
  /** `admin` 역할만 볼 수 있는 화면. staff에게는 메뉴에서도 감춘다. */
  adminOnly?: boolean;
}

export interface AdminNavGroup {
  id: string;
  label: string;
  icon: string;
  screens: AdminScreen[];
}

export const ADMIN_NAV_GROUPS: AdminNavGroup[] = [
  {
    id: 'home',
    label: '홈',
    icon: 'grid',
    screens: [
      { id: 'overview', label: '개요', href: '/admin', status: 'ready' },
    ],
  },
  {
    id: 'sales',
    label: '판매 관리',
    icon: 'bag',
    screens: [
      { id: 'orders', label: '주문 통합검색', href: '/admin/sales/orders', status: 'ready' },
      { id: 'unpaid', label: '미입금 확인', href: '/admin/sales/unpaid', status: 'planned' },
      { id: 'dispatch', label: '발주·발송 관리', href: '/admin/sales/dispatch', status: 'ready' },
      { id: 'shipping', label: '배송현황 관리', href: '/admin/sales/shipping', status: 'planned' },
      { id: 'settled', label: '거래확정 내역', href: '/admin/sales/settled', status: 'ready' },
      { id: 'claims-cancels', label: '취소 관리', href: '/admin/sales/claims/cancels', status: 'planned' },
      { id: 'claims-returns', label: '반품 관리', href: '/admin/sales/claims/returns', status: 'planned' },
      { id: 'claims-exchanges', label: '교환 관리', href: '/admin/sales/claims/exchanges', status: 'planned' },
    ],
  },
  {
    id: 'cs',
    label: '문의·리뷰 관리',
    icon: 'chat',
    screens: [
      { id: 'inquiries', label: '1:1 문의', href: '/admin/cs/inquiries', status: 'planned' },
      { id: 'reviews', label: '리뷰 관리', href: '/admin/cs/reviews', status: 'planned' },
    ],
  },
  {
    id: 'catalog',
    label: '카탈로그 관리',
    icon: 'shop',
    screens: [
      { id: 'ips', label: 'IP', href: '/admin/catalog/ips', status: 'ready' },
      { id: 'goods', label: '굿즈', href: '/admin/catalog/goods', status: 'ready' },
      { id: 'cards', label: '카드', href: '/admin/catalog/cards', status: 'ready' },
      { id: 'pools', label: '카드풀', href: '/admin/catalog/pools', status: 'ready' },
      { id: 'policies', label: '뽑기권 발급 정책', href: '/admin/catalog/policies', status: 'ready' },
      { id: 'grants', label: '카드팩 수동 발급', href: '/admin/catalog/grants', status: 'ready' },
      { id: 'games', label: '게임', href: '/admin/catalog/games', status: 'ready' },
      { id: 'events', label: '이벤트', href: '/admin/catalog/events', status: 'ready' },
      { id: 'ticket-types', label: '티켓 회차', href: '/admin/catalog/ticket-types', status: 'ready' },
    ],
  },
  {
    id: 'display',
    label: '전시 관리',
    icon: 'star',
    screens: [
      { id: 'curations', label: '홈 큐레이션', href: '/admin/display/curations', status: 'ready' },
    ],
  },
  {
    id: 'community',
    label: '커뮤니티·회원',
    icon: 'shield',
    screens: [
      { id: 'moderation', label: '모더레이션', href: '/admin/community/moderation', status: 'ready' },
      { id: 'members', label: '회원', href: '/admin/community/members', status: 'ready' },
      { id: 'roles', label: '역할', href: '/admin/community/roles', status: 'ready', adminOnly: true },
    ],
  },
  {
    id: 'messaging',
    label: '알림·메시지',
    icon: 'bell',
    screens: [
      { id: 'notifications', label: '공지 발송', href: '/admin/messaging/notifications', status: 'ready' },
      { id: 'emails', label: '메일 발송 이력', href: '/admin/messaging/emails', status: 'ready' },
    ],
  },
  {
    id: 'stats',
    label: '통계',
    icon: 'trendUp',
    screens: [
      { id: 'stats-sales', label: '판매분석', href: '/admin/stats/sales', status: 'planned' },
      { id: 'stats-claims', label: '클레임', href: '/admin/stats/claims', status: 'planned' },
      { id: 'stats-customers', label: '고객현황', href: '/admin/stats/customers', status: 'planned' },
    ],
  },
  {
    id: 'field',
    label: '현장 운영',
    icon: 'event',
    screens: [
      /* 검표는 `(shell)` route group 밖이라 사이드바 없이 전체화면으로 뜬다. */
      { id: 'check-in', label: '티켓 검표', href: '/admin/check-in', status: 'ready' },
    ],
  },
];

export const ADMIN_SCREENS: AdminScreen[] = ADMIN_NAV_GROUPS.flatMap((group) => group.screens);

/**
 * pathname이 어느 화면인지. 정확 일치를 먼저 보고, 없으면 가장 긴 접두 일치를 쓴다.
 * `/admin`이 모든 경로의 접두라서 접두만으로 고르면 전부 개요로 떨어진다.
 */
export function adminScreenForPath(pathname: string): AdminScreen | null {
  const normalized = pathname.length > 1 && pathname.endsWith('/')
    ? pathname.slice(0, -1)
    : pathname;

  const exact = ADMIN_SCREENS.find((screen) => screen.href === normalized);
  if (exact) return exact;

  let best: AdminScreen | null = null;
  for (const screen of ADMIN_SCREENS) {
    if (screen.href === '/admin') continue;
    if (!normalized.startsWith(`${screen.href}/`)) continue;
    if (!best || screen.href.length > best.href.length) best = screen;
  }
  return best;
}

export function adminGroupForPath(pathname: string): AdminNavGroup | null {
  const screen = adminScreenForPath(pathname);
  if (!screen) return null;
  return ADMIN_NAV_GROUPS.find((group) => group.screens.includes(screen)) ?? null;
}

/*
 * 레거시 `?section=` 딥링크 → 새 라우트.
 *
 * 기존 화면에 걸린 북마크·문서 링크가 조용히 개요로 떨어지지 않게 전 섹션을
 * 매핑한다. 예전 딥링크 허용 목록(11개)보다 넓은 이유는, 리다이렉트는 상세
 * 레코드 선택 없이도 화면만 열면 되기 때문이다.
 */
const LEGACY_SECTION_HREFS: Record<string, string> = {
  overview: '/admin',
  orders: '/admin/sales/orders',
  ip: '/admin/catalog/ips',
  good: '/admin/catalog/goods',
  card: '/admin/catalog/cards',
  pool: '/admin/catalog/pools',
  policy: '/admin/catalog/policies',
  grants: '/admin/catalog/grants',
  game: '/admin/catalog/games',
  event: '/admin/catalog/events',
  ticket: '/admin/catalog/ticket-types',
  curations: '/admin/display/curations',
  notifications: '/admin/messaging/notifications',
  emails: '/admin/messaging/emails',
  moderation: '/admin/community/moderation',
  members: '/admin/community/members',
  roles: '/admin/community/roles',
};

/** `?section=` 값이 가리키던 화면의 새 경로. 개요(`/admin`)와 모르는 값은 null. */
export function legacyAdminSectionHref(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const href = LEGACY_SECTION_HREFS[value];
  return href && href !== '/admin' ? href : null;
}

/** 역할이 볼 수 있는 메뉴만 남긴다. `planned`는 자리 표시로 남겨 둔다. */
export function visibleAdminNavGroups(role: string): AdminNavGroup[] {
  return ADMIN_NAV_GROUPS
    .map((group) => ({
      ...group,
      screens: group.screens.filter((screen) => !screen.adminOnly || role === 'admin'),
    }))
    .filter((group) => group.screens.length > 0);
}
