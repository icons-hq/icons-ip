import 'server-only';

import type { AdminCurationTargetRecord } from '@/lib/admin/curation-targets';
import type { Vertical } from '@/lib/data';
import { createClient } from '@/lib/supabase/server';
import {
  adminIpStatus,
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
    p_sort: filters.sort === 'stockQty' ? 'stock_qty' : (filters.sort ?? 'id'),
    p_dir: filters.sort ? filters.dir : 'asc',
    p_limit: filters.size,
    p_offset: (filters.page - 1) * filters.size,
  };
}

/** 탭 건수는 검색·필터만 적용하고 탭은 빼서 센다 — 칩이 "이 검색 안에서" 몇 건인지 보여준다. */
export function adminGoodCountArgs(filters: AdminGoodListFilters) {
  const { p_field, p_query, p_ip_id, p_type, p_stock } = adminGoodSearchArgs(filters);
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
