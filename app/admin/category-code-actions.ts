'use server';

import { requireAdminActionAccess } from '@/lib/admin/action-access.server';
import { loadGoodsCategoryOptions } from '@/lib/admin/category.server';
import type { AdminCategoryNode } from '@/lib/admin/category';

export async function loadCategoryCodesAction(): Promise<{ ok: true; categories: AdminCategoryNode[] } | { ok: false; error: string }> {
  if (!await requireAdminActionAccess('/admin/catalog/goods/import', { capability: 'catalog.manage' })) return { ok: false, error: '상품 관리 권한이 필요합니다.' };
  try { return { ok: true, categories: await loadGoodsCategoryOptions() }; }
  catch { return { ok: false, error: '카테고리 코드를 불러오지 못했습니다. 다시 조회해주세요.' }; }
}
