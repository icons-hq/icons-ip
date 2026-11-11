import 'server-only';
import { createClient } from '@/lib/supabase/server';
import type { AdminCategoryNode } from './category';
import { parseCategoryTemplatePage } from './category-templates';

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
