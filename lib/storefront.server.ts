import 'server-only';

import { createServerClient } from '@supabase/ssr';
import { unstable_cache } from 'next/cache';
import { toCard, toEvent, toGood, toIp, type CardRow, type EventRow, type GoodRow, type IpRow } from './catalog';
import type { Card, FandomEvent, Good, Ip, Vertical } from './data';
import { GOOD_TYPES } from './goods-taxonomy';
import { normalizePublicMediaPath, PUBLIC_MEDIA_BUCKET } from './media';
import type { ShopFacetOption, ShopListQuery, ShopListResult, ShopView } from './shop-catalog';
import { STOREFRONT_GOODS_CACHE_TAG, STOREFRONT_PAGE_SIZE } from './storefront';
import { getSupabaseConfig } from './supabase/config';
import { createClient } from './supabase/server';

/*
 * 스토어프론트 읽기 (규모 ⑤).
 *
 * 지금까지 상점·IP 디렉토리는 `getCatalogSnapshot()` 으로 **카탈로그 전량**을 읽고 메모리에서
 * 걸렀다. limit 없는 select 는 PostgREST 상한 1,000 에서 조용히 잘리므로, 굿즈가 1,000개를
 * 넘으면 1,001번째부터는 「느린 상품」이 아니라 **없는 상품**이 된다.
 *
 * 그래서 셋으로 나눠 읽는다 — ① IP 목록 ② 컬렉션 한 페이지 + 집계 ③ id 배열.
 * 페이지·집계는 DB 가 계산한다. 화면은 받은 것만 그린다.
 */

export {
  STOREFRONT_GOODS_CACHE_TAG,
  STOREFRONT_IPS_CACHE_TAG,
  STOREFRONT_PAGE_SIZE,
} from './storefront';

interface GoodsPageRow extends GoodRow {
  filtered_total: number | string;
}

interface IpsPageRow extends IpRow {
  total_count: number | string;
}

interface FacetRow {
  kind: string;
  value: string;
  count: number | string;
}

function toCount(value: number | string | null | undefined): number {
  const parsed = typeof value === 'string' ? Number(value) : value;
  return Number.isFinite(parsed) ? Number(parsed) : 0;
}

type Supabase = Awaited<ReturnType<typeof createClient>>;

function imageResolver(supabase: Supabase) {
  return (path: string) =>
    supabase.storage.from(PUBLIC_MEDIA_BUCKET).getPublicUrl(normalizePublicMediaPath(path)).data.publicUrl;
}

function anonClient() {
  const { url, key, isConfigured } = getSupabaseConfig();
  if (!isConfigured || !url || !key) throw new Error('Supabase is not configured');
  return createServerClient(url, key, {
    cookies: {
      getAll() {
        return [];
      },
      setAll() {
        // 공개 집계 읽기 전용 — 세션 쿠키를 다루지 않는다.
      },
    },
  });
}

function rows<T>(result: { data: unknown; error: { message: string } | null }, label: string): T[] {
  if (result.error) throw new Error(`Failed to load ${label}: ${result.error.message}`);
  return Array.isArray(result.data) ? (result.data as T[]) : [];
}

export interface StorefrontGoodsPage {
  goods: Good[];
  filteredTotal: number;
}

/** 컬렉션 한 페이지. `filteredTotal` 은 필터를 적용한 **전체** 건수라 「더 보기」가 이걸 본다. */
export async function getStorefrontGoodsPage(
  query: ShopListQuery,
  page: { limit?: number; offset?: number } = {},
): Promise<StorefrontGoodsPage> {
  const supabase = await createClient();
  const result = await supabase.rpc('storefront_goods_page', {
    p_view: query.view === 'new' ? 'new' : 'all',
    p_ip_ids: query.ips.length ? query.ips : null,
    p_types: query.types.length ? query.types : null,
    p_price_min: query.priceMin,
    p_price_max: query.priceMax,
    p_sort: query.sort,
    p_limit: page.limit ?? STOREFRONT_PAGE_SIZE,
    p_offset: page.offset ?? 0,
  });

  const data = rows<GoodsPageRow>(result, 'storefront goods page');
  const toImage = imageResolver(supabase);
  return {
    goods: data.map((row) => toGood(row, toImage)),
    /* 빈 페이지는 윈도 count 도 없다 — 0 이 맞다(마지막 페이지 뒤를 요청한 경우 포함). */
    filteredTotal: data.length ? toCount(data[0].filtered_total) : 0,
  };
}

/** id 로만 찾는다. 순서는 부르는 쪽이 정한다(담은 순서·큐레이션 순서). */
export async function getStorefrontGoodsByIds(ids: readonly string[]): Promise<Good[]> {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return [];

  const supabase = await createClient();
  const result = await supabase.rpc('storefront_goods_by_ids', { p_ids: unique });
  const toImage = imageResolver(supabase);
  return rows<GoodRow>(result, 'storefront goods by ids').map((row) => toGood(row, toImage));
}

export interface StorefrontIpsPage {
  ips: Ip[];
  total: number;
}

export async function getStorefrontIpsPage(
  page: { limit?: number; offset?: number } = {},
): Promise<StorefrontIpsPage> {
  const supabase = await createClient();
  const [ipsResult, verticalsResult] = await Promise.all([
    supabase.rpc('storefront_ips_page', {
      p_limit: page.limit ?? STOREFRONT_PAGE_SIZE,
      p_offset: page.offset ?? 0,
    }),
    supabase.from('verticals').select('key,label,color').order('key'),
  ]);

  const data = rows<IpsPageRow>(ipsResult, 'storefront ips page');
  const verticals = rows<Vertical>(verticalsResult, 'storefront verticals');
  const byKey = new Map(verticals.map((vertical) => [vertical.key, vertical]));
  const toImage = imageResolver(supabase);
  return {
    ips: data.map((row) => toIp(row, byKey, toImage)),
    total: data.length ? toCount(data[0].total_count) : 0,
  };
}

interface StorefrontScope {
  total: number;
  priceCeil: number;
  ipCounts: { id: string; count: number }[];
  typeCounts: { type: string; count: number }[];
}

/*
 * 컬렉션 집계는 질의와 무관하다(필터 전 스코프 기준) — 그래서 캐시한다. 필터를 걸 때마다
 * 다시 세면 체크박스 개수가 필터에 따라 흔들려 되돌릴 수 없게 되고, 비용도 페이지마다 든다.
 */
async function loadStorefrontScope(view: ShopView): Promise<StorefrontScope> {
  /* `unstable_cache` 안에서는 `cookies()` 를 만질 수 없다 — 캐시된 값은 특정 방문자의 것이
     아니기 때문이다. 집계는 로그인과 무관한 공개 수치라 쿠키 없는 anon 클라이언트로 읽는다
     (공지 스트립과 같은 규율). */
  const supabase = anonClient();
  const scopeView = view === 'new' ? 'new' : 'all';
  const [scopeResult, facetResult] = await Promise.all([
    supabase.rpc('storefront_goods_scope', { p_view: scopeView }),
    supabase.rpc('storefront_goods_facets', { p_view: scopeView }),
  ]);

  const scopeRows = rows<{ total: number | string; price_ceil: number | string }>(
    scopeResult,
    'storefront goods scope',
  );
  const facets = rows<FacetRow>(facetResult, 'storefront goods facets');

  return {
    total: scopeRows.length ? toCount(scopeRows[0].total) : 0,
    priceCeil: scopeRows.length ? toCount(scopeRows[0].price_ceil) : 0,
    ipCounts: facets
      .filter((facet) => facet.kind === 'ip')
      .map((facet) => ({ id: facet.value, count: toCount(facet.count) })),
    typeCounts: facets
      .filter((facet) => facet.kind === 'type')
      .map((facet) => ({ type: facet.value, count: toCount(facet.count) })),
  };
}

const cachedScope = unstable_cache(
  async (view: ShopView) => loadStorefrontScope(view),
  ['storefront-goods-scope'],
  { revalidate: 300, tags: [STOREFRONT_GOODS_CACHE_TAG] },
);

/**
 * 상점 화면 한 판 — 페이지 + 집계.
 *
 * `ipFacets` 의 이름은 IP 표에서 채운다. facet 은 상한(50)이 있으므로 이름 조회도 그만큼이다.
 */
export async function getStorefrontShopResult(
  query: ShopListQuery,
  page: { limit?: number; offset?: number } = {},
): Promise<ShopListResult> {
  const [pageResult, scope] = await Promise.all([
    getStorefrontGoodsPage(query, page),
    cachedScope(query.view),
  ]);

  const ipFacets = await resolveIpFacets(scope.ipCounts);
  return {
    goods: pageResult.goods,
    filteredTotal: pageResult.filteredTotal,
    total: scope.total,
    priceCeil: scope.priceCeil,
    ipFacets,
    typeFacets: GOOD_TYPES.filter((type) => scope.typeCounts.some((entry) => entry.type === type)).map(
      (type) => ({
        value: type,
        label: type,
        count: scope.typeCounts.find((entry) => entry.type === type)?.count ?? 0,
      }),
    ),
  };
}

async function resolveIpFacets(
  counts: readonly { id: string; count: number }[],
): Promise<ShopFacetOption[]> {
  if (counts.length === 0) return [];

  const supabase = await createClient();
  const result = await supabase
    .from('ips')
    .select('id,title')
    .in('id', counts.map((entry) => entry.id));
  const titles = new Map(
    rows<{ id: string; title: string }>(result, 'storefront facet ips').map((row) => [row.id, row.title]),
  );

  /* 이름을 못 찾은 IP 는 빼지 않고 id 로 보여 준다 — 개수는 맞는데 칸이 사라지면 더 헷갈린다. */
  return counts.map((entry) => ({
    value: entry.id,
    label: titles.get(entry.id) ?? entry.id,
    count: entry.count,
  }));
}

/** id 로 IP 를 찾는다 — 위시·장바구니처럼 「이 상품들의 IP」만 필요할 때. */
export async function getStorefrontIpsByIds(ids: readonly string[]): Promise<Ip[]> {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return [];

  const supabase = await createClient();
  const [ipsResult, verticalsResult] = await Promise.all([
    supabase
      .from('ips')
      .select('id,title,sub,vertical_key,tagline,synopsis,glyph,bg,image_path,featured,fans_count,goods_count,cards_count')
      .in('id', unique),
    supabase.from('verticals').select('key,label,color').order('key'),
  ]);

  const verticals = rows<Vertical>(verticalsResult, 'storefront verticals');
  const byKey = new Map(verticals.map((vertical) => [vertical.key, vertical]));
  const toImage = imageResolver(supabase);
  return rows<IpRow>(ipsResult, 'storefront ips by ids').map((row) => toIp(row, byKey, toImage));
}

/**
 * 준 id 중 **공개 카탈로그에 살아 있는** 것만 돌려준다.
 *
 * 폼 검증이 「전부 읽고 대조」하지 않게 하려는 것이다 — 채널 하나를 확인하자고 IP 전량을
 * 읽으면 카탈로그가 커질수록 글쓰기가 느려지고, 1,000개를 넘는 순간 **그 뒤의 IP 는 고를 수
 * 없는 채널**이 된다(있는데 없다고 답한다).
 *
 * 조회량은 준 id 수만큼이다. 보관된 IP 는 빠진다 — 새 글의 채널로 고를 수 없어야 한다.
 */
/** 이벤트 목록 한 판. 칩으로 거르는 화면이라 한 페이지가 곧 전부다 — 잘리는 자리를 우리가 정한다. */
export const STOREFRONT_EVENT_PAGE_SIZE = 200;

export async function getActiveIpIds(ids: readonly string[]): Promise<Set<string>> {
  const unique = [...new Set(ids)].filter(Boolean);
  if (unique.length === 0) return new Set();

  const supabase = await createClient();
  const result = await supabase
    .from('ips')
    .select('id')
    .is('archived_at', null)
    .in('id', unique);

  return new Set(rows<{ id: string }>(result, 'active ip ids').map((row) => row.id));
}

/**
 * 이벤트 목록 한 페이지 (규모 후속).
 *
 * `excludeMode` 는 **서버에서** 거른다 — 페이지를 자른 뒤 화면에서 거르면 한 페이지가
 * 통째로 비어 보인다. 정렬(진행중 → 예매중 → 예정)도 서버가 한다: 자르는 쪽과 순서를
 * 정하는 쪽이 다르면 1페이지에 예정만 담긴다.
 *
 * IP 는 이 페이지에 실제로 실린 이벤트의 것만 읽는다.
 */
export async function getStorefrontEventsPage(
  options: { excludeMode?: string | null; limit?: number; offset?: number } = {},
): Promise<{ events: FandomEvent[]; ips: Ip[]; total: number }> {
  const supabase = await createClient();
  const result = await supabase.rpc('storefront_events_page', {
    p_exclude_mode: options.excludeMode ?? null,
    p_limit: options.limit ?? STOREFRONT_EVENT_PAGE_SIZE,
    p_offset: options.offset ?? 0,
  });

  const data = rows<EventRow & { total_count: number | string }>(result, 'storefront events page');
  const ips = await getStorefrontIpsByIds(
    data.map((row) => row.ip_id).filter((id): id is string => Boolean(id)),
  );
  const ipsById = new Map(ips.map((ip) => [ip.id, ip]));
  const toImage = imageResolver(supabase);
  return {
    events: data.map((row) => toEvent(row, ipsById, toImage)),
    ips,
    total: data.length ? toCount(data[0].total_count) : 0,
  };
}

/** id 로 이벤트 — 상세와 옛 링크 브리지가 쓴다. 하나를 열자고 전부 읽지 않는다. */
export async function getStorefrontEventsByIds(
  ids: readonly string[],
): Promise<{ events: FandomEvent[]; ips: Ip[] }> {
  const unique = [...new Set(ids)].filter(Boolean);
  if (unique.length === 0) return { events: [], ips: [] };

  const supabase = await createClient();
  const result = await supabase.rpc('storefront_events_by_ids', { p_ids: unique });
  const data = rows<EventRow>(result, 'storefront events by ids');
  const ips = await getStorefrontIpsByIds(
    data.map((row) => row.ip_id).filter((id): id is string => Boolean(id)),
  );
  const ipsById = new Map(ips.map((ip) => [ip.id, ip]));
  const toImage = imageResolver(supabase);
  return { events: data.map((row) => toEvent(row, ipsById, toImage)), ips };
}

/** 도감 한 페이지 크기. 화면이 「더 보기」로 다음 페이지를 연다. */
export const STOREFRONT_CARD_PAGE_SIZE = 120;

export interface StorefrontCardsPage {
  cards: Card[];
  ips: Ip[];
  total: number;
}

/**
 * 도감 카드 한 페이지 (규모 후속).
 *
 * 순서는 서버가 낸다(IP → 카드 자연 순서). IP 는 이 페이지에 실린 카드의 것만 읽는다.
 * 보유 여부는 여기서 칠하지 않는다 — 보유 id 는 부르는 쪽이 따로 가져와 겹친다.
 */
export async function getStorefrontCardsPage(
  options: { ipIds?: readonly string[] | null; rarity?: string | null; limit?: number; offset?: number } = {},
): Promise<StorefrontCardsPage> {
  const supabase = await createClient();
  const result = await supabase.rpc('storefront_cards_page', {
    p_ip_ids: options.ipIds?.length ? [...options.ipIds] : null,
    p_rarity: options.rarity ?? null,
    p_limit: options.limit ?? STOREFRONT_CARD_PAGE_SIZE,
    p_offset: options.offset ?? 0,
  });

  const data = rows<CardRow & { total_count: number | string }>(result, 'storefront cards page');
  const ips = await getStorefrontIpsByIds(data.map((row) => row.ip_id));
  const toImage = imageResolver(supabase);
  return {
    cards: data.map((row) => toCard(row, toImage)),
    ips,
    total: data.length ? toCount(data[0].total_count) : 0,
  };
}

/**
 * id 로 카드 — 카드팩 라인업·보유 카드처럼 「이 카드들」만 필요할 때.
 * 보관된 카드도 돌아온다: 보유 행·라인업이 가리키는 칸이 비면 안 된다.
 */
export async function getStorefrontCardsByIds(ids: readonly string[]): Promise<{ cards: Card[]; ips: Ip[] }> {
  const unique = [...new Set(ids)].filter(Boolean);
  if (unique.length === 0) return { cards: [], ips: [] };

  const supabase = await createClient();
  const result = await supabase.rpc('storefront_cards_by_ids', { p_ids: unique });
  const data = rows<CardRow>(result, 'storefront cards by ids');
  const ips = await getStorefrontIpsByIds(data.map((row) => row.ip_id));
  const toImage = imageResolver(supabase);
  return { cards: data.map((row) => toCard(row, toImage)), ips };
}

export interface BinderOverview {
  totalCards: number;
  ownedCards: number;
  totalIps: number;
  ownedIps: number;
  holoCards: number;
  holoOwned: number;
  ssrCards: number;
  signedIn: boolean;
}

/** 바인더 머리의 수치. 전량을 세는 일은 서버가 한다 — 페이지만 세면 첫 페이지 숫자가 된다. */
export async function getBinderOverview(): Promise<BinderOverview> {
  const supabase = await createClient();
  const result = await supabase.rpc('storefront_binder_overview');
  const row = rows<Record<string, number | string | boolean>>(result, 'storefront binder overview')[0];
  const n = (key: string) => toCount((row?.[key] ?? 0) as number | string);
  return {
    totalCards: n('total_cards'),
    ownedCards: n('owned_cards'),
    totalIps: n('total_ips'),
    ownedIps: n('owned_ips'),
    holoCards: n('holo_cards'),
    holoOwned: n('holo_owned'),
    ssrCards: n('ssr_cards'),
    signedIn: row?.signed_in === true,
  };
}

/** IP 별 「보유/전체」. 카드 상세가 「3/12」 를 적는 데 쓴다. */
export async function getBinderIpProgress(
  ipIds: readonly string[],
): Promise<Map<string, { total: number; owned: number }>> {
  const unique = [...new Set(ipIds)].filter(Boolean);
  if (unique.length === 0) return new Map();

  const supabase = await createClient();
  const result = await supabase.rpc('storefront_binder_ip_progress', { p_ip_ids: unique });
  return new Map(
    rows<{ ip_id: string; total_cards: number | string; owned_cards: number | string }>(
      result,
      'storefront binder ip progress',
    ).map((row) => [row.ip_id, { total: toCount(row.total_cards), owned: toCount(row.owned_cards) }]),
  );
}

/**
 * 굿즈 검색 한 페이지 (규모 후속).
 *
 * 순위(이름 → IP 이름 → 유형·배지)와 자르기를 서버가 한다. 전에는 굿즈 전량을 메모리에서
 * 훑어 매겼다 — 검색 한 번에 카탈로그 전부를 나르는 셈이고, 1,000개를 넘으면 그 뒤의
 * 상품은 검색되지 않는 상품이 된다.
 */
export async function searchStorefrontGoods(
  query: string,
  page: { limit: number; offset: number },
): Promise<{ goods: Good[]; ips: Ip[]; total: number }> {
  const trimmed = query.trim();
  if (!trimmed) return { goods: [], ips: [], total: 0 };

  const supabase = await createClient();
  const result = await supabase.rpc('storefront_goods_search', {
    p_query: trimmed,
    p_limit: page.limit,
    p_offset: page.offset,
  });
  const data = rows<GoodRow & { filtered_total: number | string }>(result, 'storefront goods search');
  const ips = await getStorefrontIpsByIds(data.map((row) => row.ip_id));
  const toImage = imageResolver(supabase);
  return {
    goods: data.map((row) => toGood(row, toImage)),
    ips,
    total: data.length ? toCount(data[0].filtered_total) : 0,
  };
}
