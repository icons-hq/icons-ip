import 'server-only';
import { createClient } from '@/lib/supabase/server';
import type { AdminCategoryNode } from './category';
import { parseCategoryTemplatePage, type CategoryTemplate } from './category-templates';

const TEMPLATE_PAGE_SIZE = 20;
/**
 * 한 번에 읽는 자주 쓰는 카테고리의 최대 개수(사용 중·보관 각각). 조회 함수가 20개씩만 주고 한 쪽을 읽을 때마다 전체를 다시 훑어서,
 * 많아지면 읽는 비용이 빠르게 커진다. 넘으면 읽지 않는다 — 그 규모에서는 조회 함수에 조건(쓸 수 있는 것만·번호만)을 더하는 편이 맞다.
 */
export const CATEGORY_TEMPLATE_READ_LIMIT = 400;

type TemplateClient = Awaited<ReturnType<typeof createClient>>;
export type CategoryTemplateRead = { ok: true; rows: CategoryTemplate[] } | { ok: false; reason: 'too_many' | 'failed' };

async function readTemplatePage(client: TemplateClient, archived: boolean, page: number) {
  const { data, error } = await client.rpc('admin_list_catalog_category_templates', { p_query: '', p_archived: archived, p_page: page });
  const value = error ? null : parseCategoryTemplatePage(data);
  return value?.page === page && value.rows.every(row => row.archived === archived) ? value : null;
}

/**
 * 자주 쓰는 카테고리를 상태별로 전부 읽는다(고르는 창과 등록 창이 목록을 한 번에 가져다 쓴다).
 * 조회 함수는 20개씩이라 첫 쪽의 전체 개수로 쪽 수를 정하고 나머지를 함께 읽는다. 읽다가 한 쪽이라도 실패하면 일부만 쓰지 않고 실패로 돌려준다.
 */
export async function readCategoryTemplates(archived: boolean): Promise<CategoryTemplateRead> {
  try {
    const client = await createClient();
    const first = await readTemplatePage(client, archived, 1);
    if (!first) return { ok: false, reason: 'failed' };
    if (first.total > CATEGORY_TEMPLATE_READ_LIMIT) return { ok: false, reason: 'too_many' };
    const pages = Math.max(1, Math.ceil(first.total / TEMPLATE_PAGE_SIZE));
    const rest = await Promise.all(Array.from({ length: pages - 1 }, (_, index) => readTemplatePage(client, archived, index + 2)));
    if (rest.some(page => !page)) return { ok: false, reason: 'failed' };
    /* 읽는 사이에 등록이 늘어 쪽이 밀리면 같은 줄이 두 번 올 수 있다. 처음 온 줄만 둔다. */
    const seen = new Set<string>(), rows: CategoryTemplate[] = [];
    for (const page of [first, ...rest]) for (const row of page?.rows ?? []) if (!seen.has(row.categoryId)) { seen.add(row.categoryId); rows.push(row); }
    return { ok: true, rows };
  } catch {
    return { ok: false, reason: 'failed' };
  }
}

/** The picker needs only the tree, without ERP, goods counts or activation settings. */
export async function loadCategoryTemplateTree(): Promise<AdminCategoryNode[]> {
  const client = await createClient();
  const categories: AdminCategoryNode[] = [];
  for (let start = 0; ; start += 1000) {
    const { data, error } = await client.from('catalog_categories').select('id,code,name,parent_id,depth,sort_order,archived_at,updated_at').order('id').range(start, start + 999);
    if (error || !data) throw new Error('카테고리를 불러오지 못했습니다. 다시 조회해주세요.');
    categories.push(...data.map(row => ({ id: row.id, code: row.code, name: row.name, parentId: row.parent_id, depth: row.depth, sortOrder: row.sort_order, archivedAt: row.archived_at, updatedAt: row.updated_at, childCount: 0, assignedGoodCount: 0 })));
    if (data.length < 1000) break;
  }
  const childCounts = new Map<string, number>();
  for (const row of categories) if (row.parentId && !row.archivedAt) childCounts.set(row.parentId, (childCounts.get(row.parentId) ?? 0) + 1);
  for (const row of categories) row.childCount = childCounts.get(row.id) ?? 0;
  return categories.sort((a, b) => a.sortOrder - b.sortOrder || a.code.localeCompare(b.code));
}

/**
 * 상품 화면에 `자주 쓰는 카테고리` 버튼을 보일지 정한다. 없어도 검색으로 고를 수 있으니 조회 실패·권한 없음은 없음으로 친다(화면을 깨지 않는다).
 * 첫 쪽(20개)이 모두 지금 고를 수 없는 항목이어도 뒤쪽에 있을 수 있어 그때는 보인다.
 */
export async function hasUsableCategoryTemplates(): Promise<boolean> {
  try {
    const client = await createClient();
    const { data, error } = await client.rpc('admin_list_catalog_category_templates', { p_query: '', p_archived: false, p_page: 1 });
    const page = error ? null : parseCategoryTemplatePage(data);
    return Boolean(page && (page.rows.some((row) => row.usable) || page.total > page.rows.length));
  } catch {
    return false;
  }
}
