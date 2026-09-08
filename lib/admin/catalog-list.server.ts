import 'server-only';

import type { AdminCurationTargetRecord } from '@/lib/admin/curation-targets';
import type { Vertical } from '@/lib/data';
import { createClient } from '@/lib/supabase/server';
import {
  adminCardStatus,
  adminIpStatus,
  type AdminCardList,
  type AdminCardListFilters,
  type AdminGoodList,
  type AdminGoodListFilters,
  type AdminGoodStatus,
  type AdminIpList,
  type AdminIpListFilters,
} from './catalog-list';
import {
  ADMIN_GOOD_SELECT,
  ADMIN_IP_SELECT,
  createAdminMediaResolver,
  toAdminGoodRecord,
  toAdminIpRecord,
  type AdminCardRecord,
  type AdminGoodRecord,
  type AdminGoodRow,
  type AdminIpRecord,
  type AdminIpRow,
} from './catalog.server';

/*
 * 굿즈·IP 목록 로더 — 서버가 자른다.
 *
 * 전량 로더(`getAdminCatalogRecords`)는 limit 없는 select 라 PostgREST `max_rows`(1,000)에서
 * 1,001번째 행부터 조용히 잘린다. 목록 화면은 URL 계약(`catalog-list.ts`)을 인자 그대로
 * RPC(`admin_search_goods` 등)에 넘기고 한 페이지만 받는다. 응답은 기존 `AdminGoodList`·
 * `AdminIpList` 모양 그대로라 콘솔 부품은 바뀌지 않는다. 메모리 구현(`buildAdminGoodList`)은
 * 같은 규칙의 참조 구현으로 남아 있다(정렬 키·상태 판정·탭 건수가 1:1).
 */

/** 선택기가 한 번에 받는 IP 수. 그 밖의 IP 는 검색으로 찾는다. */
export const ADMIN_IP_PICK_LIMIT = 50;

type GoodSearchRow = AdminGoodRow & {
  ip_title: string;
  list_status: AdminGoodStatus;
  sale_state: string;
  updated_at: string;
  total_count: number;
};

interface GoodCountsRow {
  all_count: number;
  selling_count: number;
  low_count: number;
  soldout_count: number;
  archived_count: number;
}

type IpSearchRow = AdminIpRow & {
  vertical_label: string;
  goods_count: number;
  active_goods_count: number;
  total_count: number;
};

interface CardSearchRow {
  id: string;
  archived_at: string | null;
  ip_id: string;
  ip_title: string;
  pool_id: string | null;
  pool_name: string | null;
  name: string;
  no: string | null;
  rarity: string;
  bg: string | null;
  image_path: string | null;
  total_count: number;
}

interface IpCountsRow {
  all_count: number;
  active_count: number;
  archived_count: number;
}

interface IpPickRow {
  id: string;
  title: string;
  vertical_key: string;
  archived_at: string | null;
  fans_count: number;
  rank: number;
}

interface RpcResult {
  data: unknown;
  error: { message: string } | null;
}

/** URL 필터 → `admin_search_goods` 인자. 정렬이 없으면 id 오름차순(전량 로더가 내려주던 순서). */
export function adminGoodSearchArgs(filters: AdminGoodListFilters) {
  return {
    p_tab: filters.tab,
    p_field: filters.field,
    p_query: filters.query || null,
    p_ip_id: filters.ip || null,
    p_type: filters.type || null,
    p_stock: filters.stock,
    p_sale_state: filters.saleState,
    p_sort: filters.sort === 'stockQty' ? 'stock_qty' : (filters.sort ?? 'id'),
    p_dir: filters.sort ? filters.dir : 'asc',
    p_limit: filters.size,
    p_offset: (filters.page - 1) * filters.size,
  };
}

/** 탭 건수는 검색·필터만 적용하고 탭은 빼서 센다 — 칩이 "이 검색 안에서" 몇 건인지 보여준다. */
export function adminGoodCountArgs(filters: AdminGoodListFilters) {
  const { p_field, p_query, p_ip_id, p_type, p_stock } = adminGoodSearchArgs(filters);
  /* 탭 건수는 판매 상태 필터도 함께 반영한다 — 칩이 「이 조건 안에서」 몇 건인지 보여야 한다. */
  return { p_field, p_query, p_ip_id, p_type, p_stock };
}

export function adminIpSearchArgs(filters: AdminIpListFilters) {
  return {
    p_tab: filters.tab,
    p_query: filters.query || null,
    p_vertical: filters.vertical || null,
    p_sort: filters.sort ?? 'id',
    p_dir: filters.sort ? filters.dir : 'asc',
    p_limit: filters.size,
    p_offset: (filters.page - 1) * filters.size,
  };
}

export function adminIpCountArgs(filters: AdminIpListFilters) {
  const { p_query, p_vertical } = adminIpSearchArgs(filters);
  return { p_query, p_vertical };
}

/** 총 건수 밖의 페이지를 열면 마지막 페이지로 당긴다 — 메모리 구현 `paginate`와 같은 규칙. */
export function clampAdminListPage(page: number, total: number, size: number) {
  return Math.min(page, Math.max(1, Math.ceil(total / size)));
}

function rpcRows<Row>(result: RpcResult, what: string): Row[] {
  if (result.error) throw new Error(`Failed to load ${what}: ${result.error.message}`);
  return (result.data ?? []) as Row[];
}

export async function getAdminGoodList(filters: AdminGoodListFilters): Promise<AdminGoodList> {
  const supabase = await createClient();
  const media = createAdminMediaResolver(supabase);
  const [searchResult, countsResult] = await Promise.all([
    supabase.rpc('admin_search_goods', adminGoodSearchArgs(filters)),
    supabase.rpc('admin_goods_tab_counts', adminGoodCountArgs(filters)),
  ]);
  const countsRow = rpcRows<GoodCountsRow>(countsResult, 'admin goods counts')[0];
  const counts = {
    all: countsRow?.all_count ?? 0,
    selling: countsRow?.selling_count ?? 0,
    low: countsRow?.low_count ?? 0,
    soldout: countsRow?.soldout_count ?? 0,
    archived: countsRow?.archived_count ?? 0,
  };
  const total = counts[filters.tab];

  let page = filters.page;
  let rows = rpcRows<GoodSearchRow>(searchResult, 'admin goods');
  const lastPage = clampAdminListPage(filters.page, total, filters.size);
  /* 건수 밖의 페이지 → 마지막 페이지로 당긴다. 결과가 아예 없으면 1페이지이고 다시 읽지 않는다. */
  if (rows.length === 0 && lastPage < filters.page) {
    page = lastPage;
    if (total > 0) {
      rows = rpcRows<GoodSearchRow>(
        await supabase.rpc('admin_search_goods', adminGoodSearchArgs({ ...filters, page })),
        'admin goods',
      );
    }
  }

  return {
    rows: rows.map((row) => ({
      good: toAdminGoodRecord(row, media),
      ipTitle: row.ip_title,
      tab: row.list_status,
    })),
    total,
    counts,
    page,
    size: filters.size,
  };
}

export async function getAdminIpList(filters: AdminIpListFilters): Promise<AdminIpList> {
  const supabase = await createClient();
  const media = createAdminMediaResolver(supabase);
  const [searchResult, countsResult] = await Promise.all([
    supabase.rpc('admin_search_ips', adminIpSearchArgs(filters)),
    supabase.rpc('admin_ips_tab_counts', adminIpCountArgs(filters)),
  ]);
  const countsRow = rpcRows<IpCountsRow>(countsResult, 'admin ips counts')[0];
  const counts = {
    all: countsRow?.all_count ?? 0,
    active: countsRow?.active_count ?? 0,
    archived: countsRow?.archived_count ?? 0,
  };
  const total = counts[filters.tab];

  let page = filters.page;
  let rows = rpcRows<IpSearchRow>(searchResult, 'admin ips');
  const lastPage = clampAdminListPage(filters.page, total, filters.size);
  /* 건수 밖의 페이지 → 마지막 페이지로 당긴다. 결과가 아예 없으면 1페이지이고 다시 읽지 않는다. */
  if (rows.length === 0 && lastPage < filters.page) {
    page = lastPage;
    if (total > 0) {
      rows = rpcRows<IpSearchRow>(
        await supabase.rpc('admin_search_ips', adminIpSearchArgs({ ...filters, page })),
        'admin ips',
      );
    }
  }

  return {
    rows: rows.map((row) => {
      const ip = toAdminIpRecord(row, media);
      return {
        ip,
        tab: adminIpStatus(ip),
        verticalLabel: row.vertical_label,
        goodsCount: row.goods_count,
        activeGoodsCount: row.active_goods_count,
      };
    }),
    total,
    counts,
    page,
    size: filters.size,
  };
}

/**
 * IP 선택지. 팬 많은 순 상위 `ADMIN_IP_PICK_LIMIT`개에 `selectedId`를 항상 끼워 넣는다 —
 * 그 IP 가 보관됐거나 상위 밖이어도 이미 그 값을 가진 레코드의 선택지가 사라지면 저장이 막힌다.
 */
export async function getAdminIpOptions(
  options: { selectedId?: string | null; query?: string | null } = {},
): Promise<AdminCurationTargetRecord[]> {
  const supabase = await createClient();
  const result = await supabase.rpc('admin_pick_ips', {
    p_query: options.query || null,
    p_selected_id: options.selectedId || null,
    p_limit: ADMIN_IP_PICK_LIMIT,
  });
  return rpcRows<IpPickRow>(result, 'admin ip options').map((row) => ({
    id: row.id,
    title: row.title,
    archivedAt: row.archived_at,
  }));
}

/** 굿즈 선택지. IP 선택기와 같은 모양으로 돌려준다 — 선택기 구현은 하나다. */
export const ADMIN_GOOD_PICK_LIMIT = 50;

interface GoodPickRow {
  id: string;
  name: string;
  ip_title: string | null;
  archived_at: string | null;
}

/*
 * 굿즈 선택지 (현업 슬라이스 4 — 「이 상품을 산 고객만」 쿠폰).
 *
 * `admin_search_goods` 에는 `p_selected_id` 가 없다. 그래서 지금 값이 검색어에 안 걸리면
 * 목록에서 사라지고, 저장할 때 그 값을 되살릴 수 없다 — IP 선택기가 selectedId 를 항상
 * 끼워 넣는 이유와 같은 함정이다. 여기서는 빠졌을 때만 한 건 더 읽어 맨 앞에 붙인다.
 */
export async function getAdminGoodOptions(
  options: { selectedId?: string | null; query?: string | null; ipId?: string | null } = {},
): Promise<AdminCurationTargetRecord[]> {
  const supabase = await createClient();
  const result = await supabase.rpc('admin_search_goods', {
    p_tab: 'all',
    p_field: 'all',
    p_query: options.query || null,
    /* 발급 정책처럼 「이 IP 의 굿즈」만 골라야 하는 자리가 있다. */
    p_ip_id: options.ipId || null,
    p_sort: 'id',
    p_dir: 'asc',
    p_limit: ADMIN_GOOD_PICK_LIMIT,
    p_offset: 0,
  });
  const rows = rpcRows<GoodPickRow>(result, 'admin good options');
  const picked = rows.map((row) => ({
    id: row.id,
    title: row.ip_title ? `${row.name} · ${row.ip_title}` : row.name,
    archivedAt: row.archived_at,
  }));

  const selectedId = options.selectedId || null;
  if (!selectedId || picked.some((option) => option.id === selectedId)) return picked;

  const { data } = await supabase
    .from('goods')
    .select('id,name,archived_at')
    .eq('id', selectedId)
    .maybeSingle();
  if (!data) return picked;

  const row = data as { id: string; name: string; archived_at: string | null };
  return [{ id: row.id, title: row.name, archivedAt: row.archived_at }, ...picked];
}

/*
 * 다음 굿즈 id 제안 (현업 슬라이스 5).
 *
 * **강제가 아니라 제안이다** — 운영자가 고쳐 쓸 수 있어야 이관 데이터의 기존 코드와
 * 충돌하지 않는다. 실패하면 제안 없이 빈 칸으로 둔다: 제안 하나 때문에 등록 화면이
 * 열리지 않으면 그게 더 큰 손해다.
 */
export async function getAdminSuggestedGoodId(): Promise<string | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('admin_suggest_good_id');
  if (error) return null;
  return typeof data === 'string' && data ? data : null;
}

export async function getAdminGoodRecord(id: string): Promise<AdminGoodRecord | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.from('goods').select(ADMIN_GOOD_SELECT).eq('id', id).maybeSingle();
  if (error) throw new Error(`Failed to load admin good ${id}: ${error.message}`);
  return data ? toAdminGoodRecord(data as AdminGoodRow, createAdminMediaResolver(supabase)) : null;
}

export async function getAdminIpRecord(id: string): Promise<AdminIpRecord | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.from('ips').select(ADMIN_IP_SELECT).eq('id', id).maybeSingle();
  if (error) throw new Error(`Failed to load admin ip ${id}: ${error.message}`);
  return data ? toAdminIpRecord(data as AdminIpRow, createAdminMediaResolver(supabase)) : null;
}

export async function getAdminVerticals(): Promise<Vertical[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.from('verticals').select('key,label,color').order('key');
  if (error) throw new Error(`Failed to load admin verticals: ${error.message}`);
  return (data ?? []) as Vertical[];
}

/*
 * 카드 목록·레코드·풀별 로스터 (규모 후속).
 *
 * 카드 화면은 카드·IP 전량을 읽었다 — 1,000행에서 말없이 잘리는 자리다. 목록은 RPC 가 한
 * 페이지만 자르고, 편집은 그 레코드 하나만 읽고, 카드풀 화면의 로스터는 **그 풀의 카드**만
 * 읽는다(전량을 받아 화면에서 풀로 거르던 자리).
 */
export function adminCardSearchArgs(filters: AdminCardListFilters) {
  return {
    p_tab: filters.tab,
    p_query: filters.query || null,
    p_ip_id: filters.ip || null,
    p_pool_id: filters.pool || null,
    p_rarity: filters.rarity || null,
    p_sort: filters.sort ?? 'id',
    p_dir: filters.sort ? filters.dir : 'asc',
    p_limit: filters.size,
    p_offset: (filters.page - 1) * filters.size,
  };
}

export function adminCardCountArgs(filters: AdminCardListFilters) {
  const { p_query, p_ip_id, p_pool_id, p_rarity } = adminCardSearchArgs(filters);
  return { p_query, p_ip_id, p_pool_id, p_rarity };
}

function toCardRecordFromSearch(row: CardSearchRow, media: ReturnType<typeof createAdminMediaResolver>): AdminCardRecord {
  return {
    id: row.id,
    archivedAt: row.archived_at,
    ipId: row.ip_id,
    poolId: row.pool_id,
    name: row.name,
    no: row.no,
    rarity: (['N', 'R', 'SR', 'SSR', 'HOLO'] as const).includes(row.rarity as 'N') ? (row.rarity as AdminCardRecord['rarity']) : 'N',
    bg: row.bg,
    imagePath: row.image_path,
    imageUrl: media.previewUrlFor({ image_path: row.image_path, bg: row.bg }),
  };
}

export async function getAdminCardList(filters: AdminCardListFilters): Promise<AdminCardList> {
  const supabase = await createClient();
  const media = createAdminMediaResolver(supabase);
  const [searchResult, countsResult] = await Promise.all([
    supabase.rpc('admin_search_cards', adminCardSearchArgs(filters)),
    supabase.rpc('admin_cards_tab_counts', adminCardCountArgs(filters)),
  ]);
  const countsRow = rpcRows<IpCountsRow>(countsResult, 'admin cards counts')[0];
  const counts = {
    all: countsRow?.all_count ?? 0,
    active: countsRow?.active_count ?? 0,
    archived: countsRow?.archived_count ?? 0,
  };
  const total = counts[filters.tab];

  let page = filters.page;
  let rows = rpcRows<CardSearchRow>(searchResult, 'admin cards');
  const lastPage = clampAdminListPage(filters.page, total, filters.size);
  if (rows.length === 0 && lastPage < filters.page) {
    page = lastPage;
    if (total > 0) {
      rows = rpcRows<CardSearchRow>(
        await supabase.rpc('admin_search_cards', adminCardSearchArgs({ ...filters, page })),
        'admin cards',
      );
    }
  }

  return {
    rows: rows.map((row) => {
      const card = toCardRecordFromSearch(row, media);
      return { card, tab: adminCardStatus(card), ipTitle: row.ip_title, poolName: row.pool_name };
    }),
    total,
    counts,
    page,
    size: filters.size,
  };
}

const ADMIN_CARD_SELECT = 'id,archived_at,ip_id,pool_id,name,no,rarity,bg,image_path';

function toCardRecordFromRow(
  row: { id: string; archived_at: string | null; ip_id: string; pool_id: string | null; name: string; no: string | null; rarity: string; bg: string | null; image_path: string | null },
  media: ReturnType<typeof createAdminMediaResolver>,
): AdminCardRecord {
  return toCardRecordFromSearch({ ...row, ip_title: row.ip_id, pool_name: null, total_count: 0 }, media);
}

export async function getAdminCardRecord(id: string): Promise<AdminCardRecord | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.from('cards').select(ADMIN_CARD_SELECT).eq('id', id).maybeSingle();
  if (error) throw new Error(`Failed to load admin card ${id}: ${error.message}`);
  return data ? toCardRecordFromRow(data as Parameters<typeof toCardRecordFromRow>[0], createAdminMediaResolver(supabase)) : null;
}

/** 한 카드풀의 로스터. 풀 하나의 카드 수는 라인업 크기(수십)로 묶여 있다. */
export async function getAdminCardsByPool(poolId: string): Promise<AdminCardRecord[]> {
  if (!poolId) return [];
  const supabase = await createClient();
  const { data, error } = await supabase.from('cards').select(ADMIN_CARD_SELECT).eq('pool_id', poolId).order('id');
  if (error) throw new Error(`Failed to load admin pool cards ${poolId}: ${error.message}`);
  const media = createAdminMediaResolver(supabase);
  return ((data ?? []) as Parameters<typeof toCardRecordFromRow>[0][]).map((row) => toCardRecordFromRow(row, media));
}

/** 여러 풀의 로스터 — 카드풀 화면. 풀 수 × 라인업 크기로 묶인다(카드 전량이 아니다). */
export async function getAdminCardsByPools(poolIds: readonly string[]): Promise<AdminCardRecord[]> {
  const unique = [...new Set(poolIds)].filter(Boolean);
  if (unique.length === 0) return [];
  const supabase = await createClient();
  const { data, error } = await supabase.from('cards').select(ADMIN_CARD_SELECT).in('pool_id', unique).order('id');
  if (error) throw new Error(`Failed to load admin pool cards: ${error.message}`);
  const media = createAdminMediaResolver(supabase);
  return ((data ?? []) as Parameters<typeof toCardRecordFromRow>[0][]).map((row) => toCardRecordFromRow(row, media));
}

/**
 * id 로 IP 선택지. 화면에 오른 레코드(카드풀·이벤트·정책)가 참조하는 IP 는 상위 N 밖이어도
 * 선택지에 있어야 한다 — 없으면 이름이 id 로 보이고, 저장할 때 그 값을 다시 만들 수 없다.
 * 조회량은 준 id 수만큼이다.
 */
export async function getAdminIpOptionsByIds(ids: readonly string[]): Promise<AdminCurationTargetRecord[]> {
  const unique = [...new Set(ids)].filter(Boolean);
  if (unique.length === 0) return [];
  const supabase = await createClient();
  const { data, error } = await supabase.from('ips').select('id,title,archived_at').in('id', unique).order('id');
  if (error) throw new Error(`Failed to load admin ip options by ids: ${error.message}`);
  return ((data ?? []) as { id: string; title: string; archived_at: string | null }[])
    .map((row) => ({ id: row.id, title: row.title, archivedAt: row.archived_at }));
}

/** 상위 N 선택지에 「화면이 참조하는 IP」를 합친다. 같은 id 는 한 번만 — 선택된 것이 먼저다. */
export async function getAdminIpOptionsWith(referencedIds: readonly string[]): Promise<AdminCurationTargetRecord[]> {
  const [top, referenced] = await Promise.all([getAdminIpOptions(), getAdminIpOptionsByIds(referencedIds)]);
  const seen = new Set<string>();
  const merged: AdminCurationTargetRecord[] = [];
  for (const option of [...referenced, ...top]) {
    if (seen.has(option.id)) continue;
    seen.add(option.id);
    merged.push(option);
  }
  return merged;
}

/** id 로 굿즈 레코드 — 정책·큐레이션이 참조하는 굿즈의 이름·IP 만 필요할 때. 조회량은 준 id 수만큼이다. */
export async function getAdminGoodsByIds(ids: readonly string[]): Promise<AdminGoodRecord[]> {
  const unique = [...new Set(ids)].filter(Boolean);
  if (unique.length === 0) return [];
  const supabase = await createClient();
  const { data, error } = await supabase.from('goods').select(ADMIN_GOOD_SELECT).in('id', unique).order('id');
  if (error) throw new Error(`Failed to load admin goods by ids: ${error.message}`);
  const media = createAdminMediaResolver(supabase);
  return ((data ?? []) as AdminGoodRow[]).map((row) => toAdminGoodRecord(row, media));
}
