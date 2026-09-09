import 'server-only';

import { createClient } from '@/lib/supabase/server';
import type { AdminCategory } from './categories';

/*
 * D-9 분류 로더. 트리는 `admin_list_categories`(스태프 전용 RPC)가 path 순으로 내려주고,
 * 분류별 진열 목록은 `category_goods`(조회 시 파생·진열 기간 반영)가 내려준다 — 순서 규칙을 앱이 다시 구현하지 않는다.
 */

interface RpcResult {
  data: unknown;
  error: { message: string } | null;
}

function rows<Row>(result: RpcResult, what: string): Row[] {
  if (result.error) throw new Error(`Failed to load ${what}: ${result.error.message}`);
  return (result.data ?? []) as Row[];
}

interface CategoryRow {
  id: string;
  kind: string;
  parent_id: string | null;
  name: string;
  description: string | null;
  path: string;
  depth: number;
  sort_position: number;
  status: string;
  is_internal: boolean;
  display_mode: string;
  auto_sort_key: string;
  soldout_last: boolean;
  include_descendants: boolean;
  hero_image_path: string | null;
  seo_title: string | null;
  seo_description: string | null;
  archived_at: string | null;
  goods_count: number;
  descendant_goods_count: number;
  source: string;
  erp_key: string | null;
  erp_synced_at: string | null;
  erp_removed_at: string | null;
}

export async function getAdminCategories(options: { includeArchived?: boolean } = {}): Promise<AdminCategory[]> {
  const supabase = await createClient();
  const result = await supabase.rpc('admin_list_categories', {
    p_include_archived: options.includeArchived ?? false,
  });
  return rows<CategoryRow>(result, 'admin categories').map((row) => ({
    id: row.id,
    kind: row.kind,
    parentId: row.parent_id,
    name: row.name,
    description: row.description,
    path: row.path,
    depth: row.depth,
    position: row.sort_position,
    status: row.status,
    isInternal: row.is_internal,
    displayMode: row.display_mode,
    autoSortKey: row.auto_sort_key,
    soldoutLast: row.soldout_last,
    includeDescendants: row.include_descendants,
    heroImagePath: row.hero_image_path,
    seoTitle: row.seo_title,
    seoDescription: row.seo_description,
    archivedAt: row.archived_at,
    goodsCount: Number(row.goods_count ?? 0),
    descendantGoodsCount: Number(row.descendant_goods_count ?? 0),
    source: row.source ?? 'store',
    erpKey: row.erp_key ?? null,
    erpSyncedAt: row.erp_synced_at ?? null,
    erpRemovedAt: row.erp_removed_at ?? null,
  }));
}

export interface AdminCategoryGoodRow {
  goodId: string;
  goodName: string;
  position: number;
  pinned: boolean;
  saleState: string;
  displayFrom: string | null;
  displayUntil: string | null;
  isPrimary: boolean;
  direct: boolean;
}

/**
 * 분류 하나의 진열 목록. 순서·품절 뒤로·하위 포함은 DB 함수가 정하고, 여기서는 상품 이름과
 * 소속 메타(대표·진열 기간·직속 여부)만 붙인다.
 */
export async function getAdminCategoryGoods(categoryId: string): Promise<AdminCategoryGoodRow[]> {
  const supabase = await createClient();
  const [displayResult, membershipResult] = await Promise.all([
    supabase.rpc('category_goods', { p_category_id: categoryId }),
    supabase
      .from('good_categories')
      .select('good_id,is_primary,display_from,display_until,goods(name)')
      .eq('category_id', categoryId),
  ]);
  const display = rows<{ good_id: string; display_position: number; pinned: boolean; sale_state: string }>(
    displayResult,
    'category goods',
  );
  if (membershipResult.error) {
    throw new Error(`Failed to load category memberships: ${membershipResult.error.message}`);
  }
  /* supabase-js 는 임베드 관계를 배열로 추론한다(1:1 이어도) — 한 건만 쓰므로 첫 행을 편다. */
  type MembershipRow = {
    good_id: string;
    is_primary: boolean;
    display_from: string | null;
    display_until: string | null;
    goods: { name: string } | { name: string }[] | null;
  };
  const goodName = (goods: MembershipRow['goods']) => (
    Array.isArray(goods) ? goods[0]?.name : goods?.name
  );
  const memberships = new Map(
    ((membershipResult.data ?? []) as unknown as MembershipRow[]).map((row) => [row.good_id, row]),
  );

  return display.map((row) => {
    const membership = memberships.get(row.good_id);
    return {
      goodId: row.good_id,
      goodName: (membership ? goodName(membership.goods) : null) ?? row.good_id,
      position: row.display_position,
      pinned: row.pinned,
      saleState: row.sale_state,
      displayFrom: membership?.display_from ?? null,
      displayUntil: membership?.display_until ?? null,
      isPrimary: membership?.is_primary ?? false,
      /* 소속 행이 이 분류에 없으면 하위 분류에서 올라온 상품이다. */
      direct: membership !== undefined,
    };
  });
}

/** 굿즈 하나가 속한 분류(대표 표시 포함). 굿즈 편집 화면의 분류 카드가 쓴다. */
export async function getAdminGoodCategories(goodId: string): Promise<{ categoryId: string; isPrimary: boolean }[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('good_categories')
    .select('category_id,is_primary')
    .eq('good_id', goodId);
  if (error) throw new Error(`Failed to load good categories: ${error.message}`);
  return ((data ?? []) as { category_id: string; is_primary: boolean }[]).map((row) => ({
    categoryId: row.category_id,
    isPrimary: row.is_primary,
  }));
}
