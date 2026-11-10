import 'server-only';
import { createClient } from '@/lib/supabase/server';
import { parseCategoryDisplayDirectory, parseCategoryDisplaySnapshot, type CategoryDisplayDirectory, type CategoryDisplaySnapshot } from '@/lib/category-display';

export async function loadAdminCategoryDisplays(): Promise<CategoryDisplayDirectory> {
  const client = await createClient(), { data, error } = await client.rpc('admin_list_category_displays');
  const directory = parseCategoryDisplayDirectory(data);
  if (error || !directory) throw new Error('전시분류 목록을 확인하지 못했습니다.');
  return directory;
}
export async function loadAdminCategoryDisplay(categoryId: string): Promise<CategoryDisplaySnapshot | null> {
  const client = await createClient(), { data, error } = await client.rpc('admin_get_category_display', { p_category_id: categoryId });
  if (error) throw new Error('전시 설정을 불러오지 못했습니다. 다시 시도해주세요.');
  if (data === null) return null;
  const snapshot = parseCategoryDisplaySnapshot(data);
  if (!snapshot || snapshot.category.id !== categoryId) throw new Error('저장된 전시 설정을 확인하지 못했습니다.');
  return snapshot;
}
