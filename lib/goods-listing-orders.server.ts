import 'server-only';
import { createServerClient } from '@supabase/ssr';
import { unstable_cache } from 'next/cache';
import type { HomeSalesPeriod } from './home-ranking';
import {
  parseListingSortOrders,
  parseSalesRankingIds,
  type ListingSortOrders,
} from './listing-sorts';
import { getSupabaseConfig } from './supabase/config';

/*
 * 목록 정렬 순서·BEST 기간 순위 읽기 (스펙 C §2.12). `get_goods_listing_orders()`·`get_goods_sales_ranking(period, limit)` 는
 * 사람마다 같은 값이라 쿠키 없는 anon 클라이언트 + `unstable_cache` 120초로 읽는다(`lib/collection-banners.server.ts` 와 같은 모양).
 * RPC 는 정렬된 굿즈 id 배열만 돌려준다 — 판매·위시 원수치는 어디에도 오지 않는다. 성인·초안·보관 굿즈는 DB 에서 이미 빠진다.
 *
 * 실패한 읽기는 캐시하지 않는다 — 캐시 함수가 던지고 바깥이 null 로 받는다. 목록은 막지 않는다:
 * 정렬 순서가 null 이면 호출부(`selectShopGoods`)가 그 정렬을 스코프 순서로 떨어뜨리고, 순위가 null 이면 BEST 가 실패 안내를 그린다.
 * 정상으로 돌아온 빈 배열은 그대로 캐시한다.
 */

/** 두 읽기가 함께 쓰는 캐시 태그 — 판매·리뷰 지표를 무효화해야 할 때 `revalidateTag` 한 번으로 만료시킨다. */
export const LISTING_SORT_ORDERS_CACHE_TAG = 'listing-sort-orders';
const CACHE_SECONDS = 120;
/** BEST 화면이 읽는 순위 길이 — 한 번에 100개(RPC 상한 200 안). 한 페이지가 20개라 5페이지 몫이다. */
export const SALES_RANKING_LIMIT = 100;

class ListingOrdersReadError extends Error {
  readonly code: string | null;

  constructor(what: string, code: string | null, detail: string) {
    super(`${what} read failed: ${code ?? 'unknown'} ${detail.slice(0, 200)}`);
    this.name = 'ListingOrdersReadError';
    this.code = code;
  }
}

function anonClient() {
  const { url, key, isConfigured } = getSupabaseConfig();
  if (!isConfigured || !url || !key) return null;
  return createServerClient(url, key, { cookies: { getAll: () => [], setAll: () => {} } });
}

async function readListingSortOrders(): Promise<ListingSortOrders | null> {
  const client = anonClient();
  /* Supabase 가 설정되지 않은 환경(mock 카탈로그)은 정렬 지표가 없다 — 실패가 아니라 "없음"이라 던지지 않는다. */
  if (!client) return null;
  const { data, error } = await client.rpc('get_goods_listing_orders');
  if (error) throw new ListingOrdersReadError('get_goods_listing_orders', error.code ?? null, error.message);
  const orders = parseListingSortOrders(data);
  if (!orders) throw new ListingOrdersReadError('get_goods_listing_orders', null, 'invalid response');
  return orders;
}

async function readSalesRanking(period: HomeSalesPeriod): Promise<string[]> {
  const client = anonClient();
  /* 설정 없는 환경은 집계할 주문이 없다 — 빈 순위(= "집계된 굿즈가 없어요")이지 읽기 실패가 아니다. */
  if (!client) return [];
  const { data, error } = await client.rpc('get_goods_sales_ranking', { p_period: period, p_limit: SALES_RANKING_LIMIT });
  if (error) throw new ListingOrdersReadError('get_goods_sales_ranking', error.code ?? null, error.message);
  const ids = parseSalesRankingIds(data);
  if (!ids) throw new ListingOrdersReadError('get_goods_sales_ranking', null, 'invalid response');
  return ids;
}

const getCachedListingSortOrders = unstable_cache(
  readListingSortOrders,
  ['goods-listing-orders'],
  { revalidate: CACHE_SECONDS, tags: [LISTING_SORT_ORDERS_CACHE_TAG] },
);

const getCachedSalesRanking = unstable_cache(
  readSalesRanking,
  ['goods-sales-ranking'],
  { revalidate: CACHE_SECONDS, tags: [LISTING_SORT_ORDERS_CACHE_TAG] },
);

/** 인기도·판매량·리뷰 많은순의 정렬된 굿즈 id 배열. 읽지 못했으면 null — 그 정렬은 스코프 순서로 떨어지고 목록은 그대로 보인다. */
export async function loadListingSortOrders(): Promise<ListingSortOrders | null> {
  try {
    return await getCachedListingSortOrders();
  } catch (error) {
    console.error('[storefront/listing-orders] read failed', {
      code: error instanceof ListingOrdersReadError ? error.code : null,
      message: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

/** BEST 한 기간의 판매 랭킹 굿즈 id(1위부터). 읽지 못했으면 null — BEST 는 "순위를 불러오지 못했어요" 안내를 그린다(빈 기간과 다르다). */
export async function loadSalesRanking(period: HomeSalesPeriod): Promise<string[] | null> {
  try {
    return await getCachedSalesRanking(period);
  } catch (error) {
    console.error('[storefront/listing-orders] ranking read failed', {
      period,
      code: error instanceof ListingOrdersReadError ? error.code : null,
      message: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}
