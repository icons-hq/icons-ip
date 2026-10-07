import 'server-only';

import { createClient } from '@/lib/supabase/server';
import { loadAdminCategoryWorkspace } from './category.server';
import type { AdminCategoryErpMapping, AdminCategoryNode } from './category';
import {
  ERP_ITEMS_PAGE_SIZE,
  parseErpCategoryMappingRow,
  parseErpItemListPage,
  type ErpCategoryMappingRow,
  type ErpItemFilters,
  type ErpItemListPage,
} from './erp-items';

export interface ErpItemsWorkspaceData {
  filters: ErpItemFilters;
  page: ErpItemListPage;
  erpCategories: ErpCategoryMappingRow[];
  categories: AdminCategoryNode[];
  /** 고객 카테고리 화면에 저장된 말단별 ERP 분류 매핑. 같은 이름 제안에 함께 쓴다. */
  categoryErpMappings: AdminCategoryErpMapping[];
}

const LOAD_ERROR = 'ERP 품목을 불러오지 못했습니다. 잠시 후 다시 시도해주세요.';
/* PostgREST max_rows(1000) 아래로 나눠 읽는다. 분류가 이보다 많으면 반입 열을 다시 확인할 일이다. */
const CATEGORY_PAGE_SIZE = 1_000;
const CATEGORY_PAGE_LIMIT = 5;

async function loadErpItemPage(filters: ErpItemFilters): Promise<{ filters: ErpItemFilters; page: ErpItemListPage }> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('admin_list_erp_items', {
    p_query: filters.query || null,
    p_offset: (filters.page - 1) * ERP_ITEMS_PAGE_SIZE,
    p_limit: ERP_ITEMS_PAGE_SIZE,
  });
  const page = error ? null : parseErpItemListPage(data);
  if (!page) throw new Error(LOAD_ERROR);
  const lastPage = Math.max(1, Math.ceil(page.total / ERP_ITEMS_PAGE_SIZE));
  if (filters.page > lastPage) return loadErpItemPage({ ...filters, page: lastPage });
  return { filters, page };
}

async function loadErpCategories(): Promise<ErpCategoryMappingRow[]> {
  const supabase = await createClient();
  const rows: ErpCategoryMappingRow[] = [];
  for (let index = 0; index < CATEGORY_PAGE_LIMIT; index += 1) {
    const from = index * CATEGORY_PAGE_SIZE;
    const { data, error } = await supabase.rpc('admin_list_erp_categories').range(from, from + CATEGORY_PAGE_SIZE - 1);
    if (error || !Array.isArray(data)) throw new Error(LOAD_ERROR);
    for (const raw of data) {
      const row = parseErpCategoryMappingRow(raw);
      if (!row) throw new Error(LOAD_ERROR);
      rows.push(row);
    }
    if (data.length < CATEGORY_PAGE_SIZE) break;
  }
  return rows;
}

export async function loadErpItemsWorkspace(filters: ErpItemFilters): Promise<ErpItemsWorkspaceData> {
  const [list, erpCategories, categoryWorkspace] = await Promise.all([
    loadErpItemPage(filters),
    loadErpCategories(),
    loadAdminCategoryWorkspace(),
  ]);
  return {
    filters: list.filters,
    page: list.page,
    erpCategories,
    categories: categoryWorkspace.categories,
    categoryErpMappings: categoryWorkspace.mappings,
  };
}
