/*
 * 어드민 정보구조(IA) — 대분류 > 소분류 2단 메뉴와 화면별 라우트.
 *
 * 대분류는 편성(팝업·전시·마케팅) / 원장(상품) / 거래(주문·고객·CS) 순서로 놓고,
 * **매일 쓰지 않는 그룹은 아래로 내린다**(팬덤 콘텐츠·이벤트·티켓·설정). 커머스 원장과
 * 팬덤 원장의 운영자가 다르고, 팝업은 두 원장을 참조하는 편성 층이라 어느 원장 밑에도
 * 넣을 수 없다(설계서 v2 1-8). `planned` 화면은 데이터 층이 착지하면 라우트가 생기는 자리다.
 *
 * `tier` 는 사이드바의 「기본 / 전체」 전환이 보는 값이다 — 기본에서는 `core` 만 보이고
 * 전체에서 `extended` 까지 펼쳐진다. **감추는 것이 아니라 순서를 정하는 것**이라, 전체로
 * 켜면 아래에 그대로 이어 붙는다(카페24 왼쪽 메뉴와 같은 성격).
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

/** 기본 메뉴에 늘 보이는 그룹(`core`)과 「전체 메뉴」에서 펼쳐지는 그룹(`extended`). */
export type AdminNavTier = 'core' | 'extended';

export interface AdminNavGroup {
  id: string;
  label: string;
  icon: string;
  tier: AdminNavTier;
  screens: AdminScreen[];
}

export const ADMIN_NAV_GROUPS: AdminNavGroup[] = [
  {
    id: 'home',
    label: '홈',
    icon: 'grid',
    tier: 'core',
    screens: [
      { id: 'overview', label: '개요', href: '/admin', status: 'ready' },
    ],
  },
  /* ── 편성 층: 무엇을 언제 어디에 내보이나 ─────────────────────────────── */
  {
    id: 'popups',
    label: '온라인 팝업',
    icon: 'spark',
    tier: 'core',
    screens: [
      /* 설계서 v2 1-8 — 팝업 1급 객체(페이즈·존·연결). 라우트는 데이터 층 뒤에. */
      { id: 'popups', label: '팝업 목록', href: '/admin/popups', status: 'ready' },
      { id: 'popup-schedule', label: '팝업 편성', href: '/admin/popups/schedule', status: 'ready' },
    ],
  },
  {
    id: 'display',
    label: '전시·마케팅',
    icon: 'star',
    tier: 'core',
    screens: [
      { id: 'curations', label: '홈 큐레이션', href: '/admin/display/curations', status: 'ready' },
      { id: 'campaigns', label: '캠페인', href: '/admin/display/campaigns', status: 'ready' },
      { id: 'coupons', label: '쿠폰 관리', href: '/admin/sales/coupons', status: 'ready' },
      { id: 'promotions', label: '프로모션', href: '/admin/display/promotions', status: 'planned' },
      { id: 'notifications', label: '공지 발송', href: '/admin/messaging/notifications', status: 'ready' },
      { id: 'emails', label: '메일 발송 이력', href: '/admin/messaging/emails', status: 'ready' },
      { id: 'auto-notifications', label: '자동 알림', href: '/admin/messaging/auto', status: 'planned' },
    ],
  },
  /* ── 원장 층: 커머스 원장(상품·재고) ──────────────────────────────────── */
  {
    id: 'catalog',
    label: '상품',
    icon: 'shop',
    tier: 'core',
    screens: [
      { id: 'ips', label: 'IP', href: '/admin/catalog/ips', status: 'ready' },
      { id: 'goods', label: '굿즈', href: '/admin/catalog/goods', status: 'ready' },
      { id: 'categories', label: '분류', href: '/admin/catalog/categories', status: 'ready' },
      { id: 'option-masters', label: '옵션 마스터', href: '/admin/catalog/options', status: 'ready' },
      { id: 'inventory', label: '재고', href: '/admin/catalog/inventory', status: 'ready' },
    ],
  },
  /* ── 거래 층 ──────────────────────────────────────────────────────────── */
  {
    id: 'sales',
    label: '주문',
    icon: 'bag',
    tier: 'core',
    screens: [
      { id: 'orders', label: '주문 통합검색', href: '/admin/sales/orders', status: 'ready' },
      { id: 'unpaid', label: '미입금 확인', href: '/admin/sales/unpaid', status: 'ready' },
      { id: 'dispatch', label: '발주·발송 관리', href: '/admin/sales/dispatch', status: 'ready' },
      { id: 'shipping', label: '배송현황 관리', href: '/admin/sales/shipping', status: 'ready' },
      { id: 'settled', label: '거래확정 내역', href: '/admin/sales/settled', status: 'ready' },
      { id: 'receipts', label: '현금영수증·세금계산서', href: '/admin/sales/receipts', status: 'ready' },
      { id: 'claims-cancels', label: '취소 관리', href: '/admin/sales/claims/cancels', status: 'ready' },
      { id: 'claims-returns', label: '반품 관리', href: '/admin/sales/claims/returns', status: 'ready' },
      { id: 'claims-exchanges', label: '교환 관리', href: '/admin/sales/claims/exchanges', status: 'ready' },
    ],
  },
  {
    id: 'cs',
    label: '고객·CS',
    icon: 'user',
    tier: 'core',
    screens: [
      { id: 'members', label: '회원', href: '/admin/community/members', status: 'ready' },
      { id: 'customer-history', label: '고객 이력 허브', href: '/admin/community/history', status: 'planned' },
      { id: 'inquiries', label: '1:1 문의', href: '/admin/cs/inquiries', status: 'ready' },
      { id: 'qna', label: '상품 Q&A', href: '/admin/cs/qna', status: 'ready' },
      { id: 'reviews', label: '리뷰 관리', href: '/admin/cs/reviews', status: 'ready' },
      { id: 'moderation', label: '모더레이션', href: '/admin/community/moderation', status: 'ready' },
      { id: 'roles', label: '역할', href: '/admin/community/roles', status: 'ready', adminOnly: true },
    ],
  },
  {
    id: 'stats',
    label: '통계',
    icon: 'trendUp',
    tier: 'core',
    screens: [
      { id: 'stats-sales', label: '판매분석', href: '/admin/stats/sales', status: 'ready' },
      { id: 'stats-analysis', label: '판매 분석 (축·비교)', href: '/admin/stats/analysis', status: 'ready' },
      { id: 'stats-claims', label: '클레임', href: '/admin/stats/claims', status: 'ready' },
      { id: 'stats-customers', label: '고객현황', href: '/admin/stats/customers', status: 'ready' },
      { id: 'stats-ips', label: 'IP별 매출', href: '/admin/stats/ips', status: 'planned' },
    ],
  },
  /* ── 아래부터는 「전체 메뉴」에서 펼쳐진다 — 매일 쓰는 그룹이 아니다 ──── */
  {
    id: 'fandom',
    label: '팬덤 콘텐츠',
    icon: 'card',
    tier: 'extended',
    screens: [
      { id: 'cards', label: '카드', href: '/admin/catalog/cards', status: 'ready' },
      { id: 'pools', label: '카드풀', href: '/admin/catalog/pools', status: 'ready' },
      { id: 'policies', label: '뽑기권 발급 정책', href: '/admin/catalog/policies', status: 'ready' },
      { id: 'grants', label: '카드팩 수동 발급', href: '/admin/catalog/grants', status: 'ready' },
      { id: 'games', label: '게임', href: '/admin/catalog/games', status: 'ready' },
    ],
  },
  {
    id: 'events',
    label: '이벤트·티켓',
    icon: 'event',
    tier: 'extended',
    screens: [
      { id: 'events', label: '이벤트', href: '/admin/catalog/events', status: 'ready' },
      { id: 'ticket-types', label: '티켓 회차', href: '/admin/catalog/ticket-types', status: 'ready' },
      /* 검표는 `(shell)` route group 밖이라 사이드바 없이 전체화면으로 뜬다. */
      { id: 'check-in', label: '티켓 검표', href: '/admin/check-in', status: 'ready' },
    ],
  },
  {
    id: 'settings',
    label: '설정·도움말',
    icon: 'settings',
    tier: 'extended',
    screens: [
      { id: 'shipping-settings', label: '출고지·배송 정책', href: '/admin/settings/shipping', status: 'ready' },
      { id: 'export-templates', label: '엑셀 양식', href: '/admin/settings/exports', status: 'ready' },
      { id: 'guide', label: '사용 가이드', href: '/admin/guide', status: 'ready' },
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

/* ---------------------------------------------------------------------------
 * 사이드바 보기 상태 (기본/전체 · 그룹 접기)
 *
 * 순수 함수로 두는 이유: 사이드바는 클라이언트 컴포넌트지만 판정은 서버 렌더와
 * 하이드레이션에서 같아야 한다. 저장소 읽기는 컴포넌트가 하고, 무엇을 보일지는 여기서 정한다.
 * ------------------------------------------------------------------------- */

/** 사이드바 보기 상태를 담는 브라우저 저장소 키. 운영자 개인 취향이라 계정에 저장하지 않는다. */
export const ADMIN_NAV_TIER_KEY = 'admin:nav:tier';
export const ADMIN_NAV_COLLAPSED_KEY = 'admin:nav:collapsed-groups';

/**
 * 「전체 메뉴」인지. 저장된 값이 없으면 **기본 메뉴**로 시작한다 — 처음 여는 사람에게
 * 10개 그룹을 한 번에 펼쳐 놓으면 어디부터 봐야 할지가 사라진다.
 */
export function isAdminNavShowingAll(raw: string): boolean {
  return raw === 'all';
}

export function adminNavTierValue(showAll: boolean): string {
  return showAll ? 'all' : 'core';
}

/**
 * 지금 그릴 그룹.
 *
 * 기본 메뉴에서도 **지금 보고 있는 화면이 든 그룹은 남긴다** — 전체 메뉴에서 팬덤 화면을
 * 열어 둔 채 기본으로 돌리면 왼쪽에서 현재 위치가 사라져 어디 있는지 알 수 없게 된다.
 */
export function adminNavGroupsForView(
  role: string,
  options: { showAll: boolean; activeGroupId?: string | null },
): AdminNavGroup[] {
  const groups = visibleAdminNavGroups(role);
  if (options.showAll) return groups;
  return groups.filter(
    (group) => group.tier === 'core' || group.id === options.activeGroupId,
  );
}

/** 접어 둔 그룹 id. 형식이 깨졌으면 빈 목록 — 메뉴가 안 열리는 것보다 낫다. */
export function parseCollapsedNavGroups(raw: string): string[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return [...new Set(parsed.filter((id): id is string => typeof id === 'string' && id.length > 0))];
  } catch {
    return [];
  }
}

export function serializeCollapsedNavGroups(ids: readonly string[]): string {
  return JSON.stringify([...new Set(ids)]);
}

/** 그룹 하나를 접거나 편다. */
export function toggleCollapsedNavGroup(ids: readonly string[], groupId: string): string[] {
  return ids.includes(groupId) ? ids.filter((id) => id !== groupId) : [...ids, groupId];
}

/**
 * 그룹을 접어 둘 수 있는지. **지금 보고 있는 화면이 든 그룹은 접지 않는다** — 접으면
 * 현재 위치 표시가 사라지고, 다시 펴기 전까지 내가 어디 있는지 알 수 없다.
 */
export function isNavGroupCollapsed(
  collapsedIds: readonly string[],
  groupId: string,
  activeGroupId: string | null,
): boolean {
  if (groupId === activeGroupId) return false;
  return collapsedIds.includes(groupId);
}
