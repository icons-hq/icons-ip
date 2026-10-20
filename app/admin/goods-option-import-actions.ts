'use server';

import { unstable_rethrow } from 'next/navigation';
import { requireAdminActionAccess } from '@/lib/admin/action-access.server';
import { GOODS_OPTION_IMPORT_PATH, parseGoodsOptionImportFilters, validOptionImportGoodId, type GoodsOptionImportPage, type GoodsOptionImportSource } from '@/lib/admin/goods-option-import';
import { readGoodsOptionImportSource, searchGoodsOptionImportSources } from '@/lib/admin/goods-option-import.server';

function errorMessage(error: unknown): string {
  return error instanceof Error && /^(상품과 옵션을|옵션을 불러올 상품이|이 상품에는)/.test(error.message) ? error.message : '상품과 옵션을 불러오지 못했습니다. 현재 입력은 유지됩니다.';
}
export async function searchGoodsOptionImportAction(input: unknown): Promise<{ ok: true; accountId: string; data: GoodsOptionImportPage } | { ok: false; error: string }> {
  const auth = await requireAdminActionAccess(GOODS_OPTION_IMPORT_PATH);
  if (!auth?.user) return { ok: false, error: '상품을 편집할 권한이 필요합니다.' };
  const filters = parseGoodsOptionImportFilters(input);
  if (!filters) return { ok: false, error: '상품 검색 조건을 확인해주세요.' };
  try { return { ok: true, accountId: auth.user.id, data: await searchGoodsOptionImportSources(filters) }; }
  catch (error) { unstable_rethrow(error); return { ok: false, error: errorMessage(error) }; }
}
export async function readGoodsOptionImportAction(input: unknown): Promise<{ ok: true; accountId: string; source: GoodsOptionImportSource; targetVersion: string } | { ok: false; error: string }> {
  const auth = await requireAdminActionAccess(GOODS_OPTION_IMPORT_PATH);
  if (!auth?.user) return { ok: false, error: '상품을 편집할 권한이 필요합니다.' };
  if (!input || typeof input !== 'object' || Array.isArray(input)) return { ok: false, error: '불러올 상품을 선택해주세요.' };
  const { sourceId, targetId } = input as { sourceId?: unknown; targetId?: unknown };
  if (!validOptionImportGoodId(sourceId) || targetId !== null && !validOptionImportGoodId(targetId) || sourceId === targetId) return { ok: false, error: '현재 상품과 다른 상품을 선택해주세요.' };
  try { return { ok: true, accountId: auth.user.id, ...await readGoodsOptionImportSource(sourceId, targetId as string | null) }; }
  catch (error) { unstable_rethrow(error); return { ok: false, error: errorMessage(error) }; }
}
