import { couponDisplayState, type UserCouponSummary } from './coupons';
import type { Good, Ip } from './data';
import type { OrderListItem, VisibleOrderStatus } from './orders';
import type { StoreCreditHistory } from './store-credits';
import type { WishlistEntry } from './wishlist.server';

/* 마이페이지 대시보드(/my · LFS 패리티 2차 L6 · MY-02·MY-04, 10/14 S16)의 읽기 모델.
 *
 * 데스크톱과 모바일(LD-1a)은 같은 데이터를 다른 배치로 그린다. 블록마다 기존 서버 조회를 그대로 쓰고
 * (주문 목록·위시·쿠폰함·적립금 내역·카탈로그), 팔로우한 IP 만 새 조회다(my-follows.server).
 * 블록은 서로 독립이다 — 한 조회가 실패하면 그 블록만 null 로 접혀 "확인하지 못했어요"가 되고,
 * 나머지 블록과 마이페이지 자체는 그대로 열린다. 이 모듈은 조립만 하는 순수 함수라 단위 테스트한다. */

/** 주문 상세 사다리와 같은 다섯 단계(결제 대기·취소는 진행 단계가 아니라 세지 않는다). */
export const DASHBOARD_ORDER_STEPS = ['paid', 'confirmed', 'shipping', 'delivered', 'done'] as const satisfies readonly VisibleOrderStatus[];
export type DashboardOrderStep = (typeof DASHBOARD_ORDER_STEPS)[number];

/** 대시보드 굿즈·IP 줄에 싣는 최대 개수 — 데스크톱 한 줄 5칸, 모바일 가로 스크롤은 그 두 배까지. */
export const DASHBOARD_SHELF_LIMIT = 10;
/** 최근 주문 줄 수. */
export const DASHBOARD_RECENT_ORDERS = 3;

export interface MypageOrderSummary {
  counts: Record<DashboardOrderStep, number>;
  recent: OrderListItem[];
}

/** 대시보드 굿즈 줄 한 칸 — 카드의 브랜드 줄(IP 이름)을 함께 싣는다. */
export interface MypageShelfGood {
  good: Good;
  brand: string | null;
}

export interface MypageDashboard {
  orders: MypageOrderSummary | null;
  /** count 는 찜 기록 전체(판매 종료 포함 — 위시 화면 '총 N개'와 같은 수), goods 는 지금 공개된 굿즈만. */
  wishlist: { count: number; goods: MypageShelfGood[] } | null;
  /** 공개 중인 IP 만 센다 — 비공개 IP 는 화면에 세울 수 없다. */
  follows: { count: number; ips: Ip[] } | null;
  coupons: { usable: number } | null;
  storeCredit: { available: number } | null;
}

export interface MypageDashboardSources {
  orders: OrderListItem[] | null;
  wishEntries: WishlistEntry[] | null;
  followedIpIds: string[] | null;
  coupons: UserCouponSummary[] | null;
  storeCredit: Pick<StoreCreditHistory, 'available'> | null;
  catalog: { goods: Good[]; ips: Ip[] } | null;
  now?: number;
}

export function summarizeOrders(orders: readonly OrderListItem[]): MypageOrderSummary {
  const counts = Object.fromEntries(DASHBOARD_ORDER_STEPS.map((step) => [step, 0])) as Record<DashboardOrderStep, number>;
  for (const order of orders) {
    if ((DASHBOARD_ORDER_STEPS as readonly string[]).includes(order.status)) counts[order.status as DashboardOrderStep] += 1;
  }
  /* 목록 로더가 최신순으로 정렬해 준다(loadOrders). 결제 대기 주문은 기본 목록에 없고 취소 주문은 줄에 남긴다 —
     주문 화면과 같은 줄을 보여야 '더보기'로 이어 볼 때 순서가 어긋나지 않는다. */
  return { counts, recent: orders.slice(0, DASHBOARD_RECENT_ORDERS) };
}

export function buildMypageDashboard(sources: MypageDashboardSources): MypageDashboard {
  const now = sources.now ?? Date.now();
  const goodsById = sources.catalog ? new Map(sources.catalog.goods.map((good) => [good.id, good])) : null;
  const ipsById = sources.catalog ? new Map(sources.catalog.ips.map((ip) => [ip.id, ip])) : null;

  const wishlist = sources.wishEntries && goodsById
    ? {
      count: sources.wishEntries.length,
      goods: sources.wishEntries
        .flatMap((entry) => {
          const good = goodsById.get(entry.goodId);
          return good ? [{ good, brand: ipsById?.get(good.ip)?.title ?? null }] : [];
        })
        .slice(0, DASHBOARD_SHELF_LIMIT),
    }
    : null;

  const followedIps = sources.followedIpIds && ipsById
    ? sources.followedIpIds.flatMap((id) => ipsById.get(id) ?? [])
    : null;

  return {
    orders: sources.orders ? summarizeOrders(sources.orders) : null,
    wishlist,
    follows: followedIps ? { count: followedIps.length, ips: followedIps.slice(0, DASHBOARD_SHELF_LIMIT) } : null,
    coupons: sources.coupons
      ? { usable: sources.coupons.filter((held) => couponDisplayState(held, now) === 'usable').length }
      : null,
    storeCredit: sources.storeCredit ? { available: sources.storeCredit.available } : null,
  };
}
