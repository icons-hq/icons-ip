/*
 * 어드민 정보구조(IA) — 대분류 > 소분류 2단 메뉴와 화면별 라우트.
 *
 * 서버 컴포넌트(layout·page)와 클라이언트 사이드바가 같은 정의를 봐야 해서
 * 'use client' 없는 순수 모듈로 둔다. 화면을 추가할 때 여기 한 곳만 고치면
 * 사이드바·헤더 제목·레거시 리다이렉트가 함께 따라온다.
 */

import { ADMIN_VOCABULARY } from './vocabulary';
import { canAccessAdminScreen, type OperatorAccess } from './access';

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
      { id: 'overview', label: '홈', href: '/admin', status: 'ready' },
    ],
  },
  {
    id: 'catalog',
    label: '상품관리',
    icon: 'shop',
    screens: [
      { id: 'goods', label: ADMIN_VOCABULARY.goodsList, href: '/admin/catalog/goods', status: 'ready' },
      { id: 'goods-create', label: ADMIN_VOCABULARY.goodsRegister, href: '/admin/catalog/goods?create=1', status: 'ready' },
      { id: 'goods-groups-create', label: ADMIN_VOCABULARY.goodsGroupsCreate, href: '/admin/catalog/groups/new?mode=assemble', status: 'ready' },
      { id: 'goods-groups', label: ADMIN_VOCABULARY.goodsGroups, href: '/admin/catalog/groups', status: 'ready' },
      { id: 'goods-import', label: ADMIN_VOCABULARY.goodsImport, href: '/admin/catalog/goods/import', status: 'ready' },
      { id: 'fulfillment-origins', label: '배송정보 관리', href: '/admin/settings/origins', status: 'ready' },
      { id: 'shipping-settings-templates', label: '배송정보 템플릿 관리', href: '/admin/settings/shipping-templates', status: 'ready' },
      { id: 'shipping-notice-templates', label: '배송 안내 템플릿 관리', href: '/admin/settings/shipping-notices', status: 'ready' },
      { id: 'notice-presets', label: `${ADMIN_VOCABULARY.noticeInfo} 템플릿 관리`, href: '/admin/catalog/notice-presets', status: 'ready' },
      { id: 'goods-event-templates', label: '이벤트 템플릿 관리', href: '/admin/catalog/event-templates', status: 'ready' },
      { id: 'category-templates', label: '카테고리 템플릿 관리', href: '/admin/catalog/category-templates', status: 'ready' },
      { id: 'goods-after-sales-templates', label: 'A/S 템플릿 관리', href: '/admin/catalog/after-sales-templates', status: 'ready' },
      { id: 'size-templates', label: '사이즈 템플릿 관리', href: '/admin/catalog/size-templates', status: 'ready' },
      { id: 'categories', label: '카테고리 관리', href: '/admin/catalog/categories', status: 'ready' },
      /* ERP 반입과 카테고리 연결은 ICONS 운영에 필요한 별도 메뉴로 유지한다. */
      { id: 'erp-items', label: 'ERP 품목', href: '/admin/catalog/erp-items', status: 'ready' },
      { id: 'announcements', label: '상품공지사항 관리', href: '/admin/catalog/announcements', status: 'ready' },
      { id: 'goods-photos', label: '사진 보관함', href: '/admin/catalog/photos', status: 'ready' },
      { id: 'related-goods', label: '연관상품 관리', href: '/admin/catalog/related-goods', status: 'ready' },
      { id: 'goods-attributes', label: '상품속성 관리', href: '/admin/catalog/attributes', status: 'ready', adminOnly: true },
      { id: 'shipping-regions', label: '지역별 추가배송비 관리', href: '/admin/settings/shipping-regions', status: 'ready' },
      { id: 'shipping-carriers', label: '택배사 관리', href: '/admin/settings/carriers', status: 'ready' },
    ],
  },
  {
    id: 'sales',
    label: '판매관리',
    icon: 'bag',
    screens: [
      { id: 'orders', label: ADMIN_VOCABULARY.orderSearch, href: '/admin/sales/orders', status: 'ready' },
      { id: 'gifts', label: '선물 수락 대기', href: '/admin/sales/gifts', status: 'ready' },
      { id: 'subscriptions', label: '정기구매 관리', href: '/admin/sales/subscriptions', status: 'ready' },
      { id: 'unpaid', label: ADMIN_VOCABULARY.unpaidOrders, href: '/admin/sales/unpaid', status: 'ready' },
      { id: 'dispatch', label: ADMIN_VOCABULARY.dispatch, href: '/admin/sales/dispatch', status: 'ready' },
      { id: 'shipping', label: ADMIN_VOCABULARY.shipping, href: '/admin/sales/shipping', status: 'ready' },
      /* 거래확정과 PG 판매대금 지급은 별도 계약이다. */
      { id: 'purchase-restrictions', label: '판매방해 고객관리', href: '/admin/sales/purchase-restrictions', status: 'ready' },
      { id: 'settled', label: `${ADMIN_VOCABULARY.settled} 내역`, href: '/admin/sales/settled', status: 'ready' },
      { id: 'claims-cancels', label: '취소 관리', href: '/admin/sales/claims/cancels', status: 'ready' },
      { id: 'claims-returns', label: '반품 관리', href: '/admin/sales/claims/returns', status: 'ready' },
      { id: 'claims-exchanges', label: '교환 관리', href: '/admin/sales/claims/exchanges', status: 'ready' },
      { id: 'refund-transfers', label: '환불 송금 대기', href: '/admin/sales/claims/refund-transfers', status: 'ready', adminOnly: true },
    ],
  },
  {
    id: 'settlements',
    label: '정산관리',
    icon: 'card',
    screens: [
      { id: 'pg-settlements', label: '정산 내역 (일별/건별)', href: '/admin/settlements', status: 'ready', adminOnly: true },
    ],
  },
  {
    id: 'cs',
    label: '문의/리뷰관리',
    icon: 'chat',
    screens: [
      { id: 'qna', label: ADMIN_VOCABULARY.productInquiry, href: '/admin/cs/qna', status: 'ready' },
      { id: 'inquiries', label: ADMIN_VOCABULARY.customerInquiry, href: '/admin/cs/inquiries', status: 'ready' },
      { id: 'reviews', label: '리뷰 관리', href: '/admin/cs/reviews', status: 'ready' },
      { id: 'review-events', label: '리뷰 이벤트', href: '/admin/cs/review-events', status: 'ready' },
      { id: 'review-insights', label: '리뷰 인사이트', href: '/admin/cs/review-insights', status: 'ready' },
      { id: 'inquiry-chat', label: '상담하기', href: '/admin/cs/chat', status: 'ready' },
      { id: 'faq', label: 'FAQ 관리', href: '/admin/cs/faq', status: 'ready' },
      { id: 'members', label: '회원 관리', href: '/admin/community/members', status: 'ready' },
    ],
  },
  {
    id: 'store',
    label: '스토어관리',
    icon: 'shop',
    screens: [
      { id: 'curations', label: '홈 전시 관리', href: '/admin/display/curations', status: 'ready' },
      { id: 'category-display', label: '카테고리 전시 관리', href: '/admin/display/categories', status: 'ready' },
      { id: 'product-detail-presentation', label: '상품 상세 구성', href: '/admin/display/detail', status: 'ready' },
      { id: 'store-presentation', label: '스토어 전시 설정', href: '/admin/display/settings', status: 'ready' },
      { id: 'shopping-stories', label: '쇼핑스토리', href: '/admin/display/stories', status: 'ready' },
    ],
  },
  {
    id: 'display',
    label: '혜택/마케팅',
    icon: 'star',
    screens: [
      { id: 'coupon-register', label: '혜택 등록', href: '/admin/sales/coupons/new', status: 'ready' },
      { id: 'coupons', label: '혜택 조회/수정', href: '/admin/sales/coupons', status: 'ready' },
      { id: 'benefit-report', label: '혜택 리포트', href: '/admin/sales/benefit-report', status: 'ready' },
      { id: 'marketing-messages', label: '고객 안내 메시지', href: '/admin/marketing/messages', status: 'ready' },
      { id: 'marketing-links', label: '마케팅 링크', href: '/admin/marketing/links', status: 'ready' },
      { id: 'customer-segments', label: '타겟 세그먼트', href: '/admin/marketing/segments', status: 'ready' },
      { id: 'customer-grades', label: '고객등급 관리', href: '/admin/marketing/customer-grades', status: 'ready', adminOnly: true },
      { id: 'store-credit-console', label: '적립금 지급관리', href: '/admin/sales/store-credits', status: 'ready', adminOnly: true },
      { id: 'store-credits', label: '적립금 정책', href: '/admin/settings/store-credits', status: 'ready', adminOnly: true },
      { id: 'notifications', label: '공지 발송', href: '/admin/messaging/notifications', status: 'ready' },
      { id: 'emails', label: '메일 발송 이력', href: '/admin/messaging/emails', status: 'ready' },
    ],
  },
  {
    id: 'stats',
    label: '데이터분석',
    icon: 'trendUp',
    screens: [
      { id: 'stats-traffic', label: '방문·유입 분석', href: '/admin/stats/traffic', status: 'ready' },
      { id: 'stats-marketing', label: '마케팅 링크 성과', href: '/admin/stats/marketing', status: 'ready' },
      { id: 'stats-sales', label: '판매분석', href: '/admin/stats/sales', status: 'ready' },
      { id: 'stats-claims', label: '취소/반품/교환 분석', href: '/admin/stats/claims', status: 'ready' },
      { id: 'stats-customers', label: '고객분석', href: '/admin/stats/customers', status: 'ready' },
    ],
  },
  {
    id: 'promotion',
    label: '프로모션',
    icon: 'star',
    screens: [
      { id: 'campaigns', label: '캠페인 관리', href: '/admin/display/campaigns', status: 'ready' },
    ],
  },
  {
    id: 'seller',
    label: '판매자 정보',
    icon: 'grid',
    screens: [
      { id: 'store-settings', label: '판매자 정보 관리', href: '/admin/settings/store', status: 'ready' },
      { id: 'roles', label: '매니저 관리', href: '/admin/community/roles', status: 'ready', adminOnly: true },
      { id: 'operations-settings', label: '운영 준비', href: '/admin/settings/operations', status: 'ready' },
    ],
  },
  {
    id: 'content',
    label: 'IP·콘텐츠 운영',
    icon: 'spark',
    screens: [
      { id: 'ips', label: 'IP', href: '/admin/catalog/ips', status: 'ready' },
      { id: 'cards', label: '카드', href: '/admin/catalog/cards', status: 'ready' },
      { id: 'pools', label: '카드풀', href: '/admin/catalog/pools', status: 'ready' },
      { id: 'policies', label: '뽑기권 발급 정책', href: '/admin/catalog/policies', status: 'ready' },
      { id: 'grants', label: '카드팩 수동 발급', href: '/admin/catalog/grants', status: 'ready' },
      { id: 'games', label: '게임', href: '/admin/catalog/games', status: 'ready' },
      { id: 'events', label: '이벤트', href: '/admin/catalog/events', status: 'ready' },
      { id: 'ticket-types', label: '티켓 회차', href: '/admin/catalog/ticket-types', status: 'ready' },
      { id: 'moderation', label: '커뮤니티 관리', href: '/admin/community/moderation', status: 'ready' },
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
  {
    id: 'help',
    label: '도움말',
    icon: 'spark',
    screens: [
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
  const path = pathname.split(/[?#]/, 1)[0];
  const normalized = path.length > 1 && path.endsWith('/') ? path.slice(0, -1) : path;

  if (normalized === '/admin/catalog/goods') {
    const query = new URLSearchParams(pathname.split('?')[1]?.split('#')[0]);
    if (query.get('create') === '1') {
      return ADMIN_SCREENS.find((screen) => screen.id === 'goods-create') ?? null;
    }
  }

  // 고객 상세는 회원 목록과 같은 메뉴·권한에 속한다.
  if (normalized.startsWith('/admin/customers/')) {
    return ADMIN_SCREENS.find((screen) => screen.id === 'members') ?? null;
  }

  const exact = ADMIN_SCREENS.find((screen) => screen.href.split(/[?#]/, 1)[0] === normalized);
  if (exact) return exact;

  let best: AdminScreen | null = null;
  for (const screen of ADMIN_SCREENS) {
    const screenPath = screen.href.split(/[?#]/, 1)[0];
    if (screenPath === '/admin') continue;
    if (!normalized.startsWith(`${screenPath}/`)) continue;
    if (!best || screenPath.length > best.href.split(/[?#]/, 1)[0].length) best = screen;
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
  'shopping-stories': '/admin/display/stories',
  'marketing-links': '/admin/marketing/links',
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
export function visibleAdminNavGroups(role: string, operatorAccess?: OperatorAccess): AdminNavGroup[] {
  return ADMIN_NAV_GROUPS
    .map((group) => ({
      ...group,
      screens: group.screens.filter((screen) => operatorAccess
        ? canAccessAdminScreen({ role, operatorAccess }, screen)
        : !screen.adminOnly || role === 'admin'),
    }))
    .filter((group) => group.screens.length > 0);
}
