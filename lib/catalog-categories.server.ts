import 'server-only';
import { createClient } from '@/lib/supabase/server';
import { categoryAncestorIds, orderedCatalogCategories, type CatalogCategory } from './catalog-categories';

export async function loadPublicCatalogCategories(): Promise<CatalogCategory[]> {
  const client = await createClient();
  const rows: CatalogCategory[] = [];
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await client.rpc('get_catalog_categories').order('id').range(offset, offset + 999);
    if (error) throw new Error('카테고리를 불러오지 못했습니다. 잠시 후 다시 시도해주세요.');
    for (const row of data ?? []) {
      if (typeof row.id !== 'string' || typeof row.code !== 'string' || typeof row.name !== 'string'
        || (row.parent_id !== null && typeof row.parent_id !== 'string')
        || !Number.isInteger(row.depth) || row.depth < 1 || row.depth > 4 || !Number.isInteger(row.sort_order)) {
        throw new Error('카테고리 정보를 확인하지 못했습니다.');
      }
      rows.push({ id: row.id, code: row.code, name: row.name, parentId: row.parent_id, depth: row.depth, sortOrder: row.sort_order });
    }
    if ((data?.length ?? 0) < 1000) break;
  }
  return orderedCatalogCategories(rows.filter((row) => categoryAncestorIds(rows, row.id).length === row.depth));
}
