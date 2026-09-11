import 'server-only';

import { createClient } from '@/lib/supabase/server';
import {
  categoryPath,
  type AdminCategoryActivation,
  type AdminCategoryNode,
  type AdminCategoryWorkspaceData,
  type CategoryEvidence,
} from './category';

interface CategoryRow {
  id: string;
  code: string;
  name: string;
  parent_id: string | null;
  depth: number;
  sort_order: number;
  archived_at: string | null;
  updated_at: string;
}

interface MappingRow {
  category_id: string;
  erp_code: string;
  erp_name: string;
  source: string;
  verified_at: string | null;
  verified_by: string | null;
}

interface MigrationRow {
  type: string;
  category_id: string | null;
  status: 'suggested' | 'confirmed' | 'rejected';
  note: string | null;
  updated_at: string;
}

interface ActivationRow {
  id: string;
  customer_enabled: boolean;
  erp_enabled: boolean;
  evidence: unknown;
  updated_at: string | null;
}

interface GoodCategoryRow {
  id: string;
  category_id: string | null;
}

interface PagedResult<Row> {
  data: Row[] | null;
  error: { message?: string } | null;
}

interface PagedQuery<Row> {
  range(from: number, to: number): PromiseLike<PagedResult<Row>>;
}

const CATEGORY_PAGE_SIZE = 1_000;

async function readAllRows<Row>(query: PagedQuery<Row>): Promise<{ data: Row[]; error: { message?: string } | null }> {
  const rows: Row[] = [];
  for (let from = 0; ; from += CATEGORY_PAGE_SIZE) {
    const page = await query.range(from, from + CATEGORY_PAGE_SIZE - 1);
    if (page.error) return { data: rows, error: page.error };
    const values = page.data ?? [];
    rows.push(...values);
    if (values.length < CATEGORY_PAGE_SIZE) return { data: rows, error: null };
  }
}

const EMPTY_ACTIVATION: AdminCategoryActivation = {
  customerEnabled: false,
  erpEnabled: false,
  customerEvidence: null,
  erpEvidence: null,
  updatedAt: null,
};

function evidence(value: unknown): CategoryEvidence | null {
  if (!value || typeof value !== 'object') return null;
  const row = value as Record<string, unknown>;
  if (typeof row.source !== 'string' || typeof row.reference !== 'string' || typeof row.verifiedAt !== 'string') return null;
  return {
    source: row.source,
    reference: row.reference,
    verifiedAt: row.verifiedAt,
    ...(typeof row.verifiedBy === 'string' ? { verifiedBy: row.verifiedBy } : {}),
  };
}

function activation(row: ActivationRow | null): AdminCategoryActivation {
  if (!row) return EMPTY_ACTIVATION;
  const raw = row.evidence && typeof row.evidence === 'object' ? row.evidence as Record<string, unknown> : {};
  return {
    customerEnabled: Boolean(row.customer_enabled),
    erpEnabled: Boolean(row.erp_enabled),
    customerEvidence: evidence(raw.customer),
    erpEvidence: evidence(raw.erp),
    updatedAt: row.updated_at,
  };
}

function toNode(row: CategoryRow, childCount: number, assignedGoodCount: number): AdminCategoryNode {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    parentId: row.parent_id,
    depth: row.depth,
    sortOrder: row.sort_order,
    archivedAt: row.archived_at,
    updatedAt: row.updated_at,
    childCount,
    assignedGoodCount,
  };
}

export async function loadAdminCategoryWorkspace(): Promise<AdminCategoryWorkspaceData> {
  const supabase = await createClient();
  const [categoriesResult, mappingsResult, migrationsResult, activationResult, goodsResult] = await Promise.all([
    readAllRows<CategoryRow>(supabase.from('catalog_categories').select('id,code,name,parent_id,depth,sort_order,archived_at,updated_at').order('sort_order').order('code')),
    readAllRows<MappingRow>(supabase.from('catalog_category_erp_mappings').select('category_id,erp_code,erp_name,source,verified_at,verified_by').order('category_id')),
    readAllRows<MigrationRow>(supabase.from('goods_type_category_migrations').select('type,category_id,status,note,updated_at').order('type')),
    supabase.from('category_activation_control').select('id,customer_enabled,erp_enabled,evidence,updated_at').eq('id', 'catalog').maybeSingle(),
    readAllRows<GoodCategoryRow>(supabase.from('goods').select('id,category_id')),
  ]);
  if (categoriesResult.error || mappingsResult.error || migrationsResult.error || activationResult.error || goodsResult.error) {
    throw new Error('고객 카테고리 정보를 불러오지 못했습니다. 잠시 후 다시 시도해주세요.');
  }

  const categoryRows = categoriesResult.data;
  const goods = goodsResult.data;
  const childCounts = new Map<string, number>();
  for (const row of categoryRows) if (row.parent_id) childCounts.set(row.parent_id, (childCounts.get(row.parent_id) ?? 0) + 1);
  const assignedCounts = new Map<string, number>();
  for (const good of goods) if (good.category_id) assignedCounts.set(good.category_id, (assignedCounts.get(good.category_id) ?? 0) + 1);

  return {
    categories: categoryRows.map((row) => toNode(row, childCounts.get(row.id) ?? 0, assignedCounts.get(row.id) ?? 0)),
    mappings: mappingsResult.data.map((row) => ({
      categoryId: row.category_id,
      erpCode: row.erp_code,
      erpName: row.erp_name,
      source: row.source,
      verifiedAt: row.verified_at,
      verifiedBy: row.verified_by,
    })),
    migrations: migrationsResult.data.map((row) => ({
      type: row.type,
      categoryId: row.category_id,
      status: row.status,
      note: row.note,
      updatedAt: row.updated_at,
    })),
    activation: activation((activationResult.data as ActivationRow | null) ?? null),
  };
}

export async function loadAdminCategoryExportRows() {
  const workspace = await loadAdminCategoryWorkspace();
  const mappings = new Map(workspace.mappings.map((mapping) => [mapping.categoryId, mapping]));
  return workspace.categories.map((category) => {
    const mapping = mappings.get(category.id);
    return {
      code: category.code,
      name: category.name,
      path: categoryPath(workspace.categories, category.id).join(' > '),
      depth: category.depth,
      status: category.archivedAt ? '보관' : '사용',
      assignedGoods: category.assignedGoodCount,
      erpCode: mapping?.erpCode ?? '미설정',
      erpName: mapping?.erpName ?? '미설정',
      erpSource: mapping?.source ?? '미설정',
      erpVerifiedAt: mapping?.verifiedAt ?? '미설정',
    };
  });
}

export async function loadAdminCategoryAssignmentOptions() {
  const workspace = await loadAdminCategoryWorkspace();
  return workspace.categories
    .filter((category) => !category.archivedAt && category.childCount === 0)
    .sort((left, right) => left.depth - right.depth || left.sortOrder - right.sortOrder || left.name.localeCompare(right.name, 'ko'));
}
