import { HOME_SALES_PERIODS, isHomeSalesPeriod, type HomeSalesPeriod } from './home-ranking';

/* NEW·BEST·카테고리(전체 굿즈) 목록이 함께 쓰는 정렬 어휘와, DB 정렬 RPC 응답의 파서(스펙 C §2.5, §4.1).
   순수 모듈이다 — 서버 로더(`lib/goods-listing-orders.server.ts`)와 화면이 같은 계약을 import 한다.

   정렬 7종은 하나로 통일한다. 이름순 2종·오래된순은 화면에서 빼고 URL 호환만 남긴다(`lib/shop-catalog.ts`).
   인기도·판매량·리뷰 많은순의 순서는 DB 가 정한다: `get_goods_listing_orders()`가 정렬된 굿즈 id 배열만 돌려주고
   (판매·위시 원수치는 공개하지 않는다), BEST 순위는 `get_goods_sales_ranking(period, limit)`의 id 배열이다. */

export const LISTING_SORTS = ['recommended', 'popular', 'newest', 'sales', 'price_asc', 'price_desc', 'reviews'] as const;
export type ListingSort = typeof LISTING_SORTS[number];

/** NEW 의 탭 6종 — 탭 줄 자체가 정렬이라 '추천순'(스코프 순서)은 두지 않는다. 기본은 최신 등록순(`newest`). */
export const NEW_SORT_TABS = ['popular', 'newest', 'sales', 'price_asc', 'price_desc', 'reviews'] as const satisfies readonly ListingSort[];
export type NewSortTab = typeof NEW_SORT_TABS[number];
export const NEW_DEFAULT_SORT: NewSortTab = 'newest';

export const LISTING_SORT_LABELS: Record<ListingSort, string> = {
  recommended: '추천순',
  popular: '인기도순',
  newest: '최신 등록순',
  sales: '판매량순',
  price_asc: '낮은 가격순',
  price_desc: '높은 가격순',
  reviews: '리뷰 많은순',
};

export function isListingSort(value: unknown): value is ListingSort {
  return typeof value === 'string' && (LISTING_SORTS as readonly string[]).includes(value);
}

/** BEST 기간 탭 — 홈 판매 BEST 와 같은 기간 정의·라벨(`HOME_SALES_PERIOD_LABELS`)을 쓴다. */
export const SALES_RANKING_PERIODS = HOME_SALES_PERIODS;
export const SALES_RANKING_DEFAULT_PERIOD: HomeSalesPeriod = 'realtime';

/** `?period=` 값을 기간으로 읽는다. 없거나 잘못된 값, 반복된 값의 첫 항목이 잘못된 경우는 실시간이다. */
export function parseSalesRankingPeriod(value: unknown): HomeSalesPeriod {
  const candidate = Array.isArray(value) ? value[0] : value;
  return isHomeSalesPeriod(candidate) ? candidate : SALES_RANKING_DEFAULT_PERIOD;
}

/** `get_goods_listing_orders()` 응답 — 정렬 키마다 대상 굿즈 전부가 정렬된 id 배열. */
export type ListingSortOrders = { popular: string[]; sales: string[]; reviews: string[] };

/* 굿즈 id 는 DB 가 모양을 제한하지 않는다(홈 후보 RPC 의 입력 정규식은 호출 쪽 규칙일 뿐이다). 비어 있지 않은 문자열이면 받고,
   과도하게 긴 값만 응답이 어긋난 것으로 본다. */
const GOOD_ID_MAX_LENGTH = 200;

function readIdArray(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  const ids: string[] = [];
  for (const entry of value) {
    if (typeof entry !== 'string' || entry.length < 1 || entry.length > GOOD_ID_MAX_LENGTH) return null;
    ids.push(entry);
  }
  return ids;
}

/** RPC 응답이 세 키의 id 문자열 배열이 아니면 null — 호출 쪽은 정렬을 스코프 순서로 떨어뜨리고 목록은 그대로 보여 준다. */
export function parseListingSortOrders(value: unknown): ListingSortOrders | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const popular = readIdArray(record.popular);
  const sales = readIdArray(record.sales);
  const reviews = readIdArray(record.reviews);
  return popular && sales && reviews ? { popular, sales, reviews } : null;
}

/** `get_goods_sales_ranking()` 응답(기간 순위 id 배열). 배열이 아니거나 id 가 아닌 값이 섞이면 null. */
export function parseSalesRankingIds(value: unknown): string[] | null {
  return readIdArray(value);
}
