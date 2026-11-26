'use server';
import { revalidatePath } from 'next/cache';
import { revalidateGoodsSurfaces } from '@/lib/admin/revalidate-goods.server';
import { createClient } from '@/lib/supabase/server';
import { requireAdminActionAccess } from '@/lib/admin/action-access.server';
import { GOODS_ATTRIBUTES_PATH, goodsAttributeFieldIssues, goodsAttributeIssuesMessage } from '@/lib/admin/goods-attributes';
import { loadGoodsAttributeWorkspace } from '@/lib/admin/goods-attributes.server';
import { isUuid } from '@/lib/uuid';
import { parseGoodsAttributeFields, parseGoodsAttributeSchema } from '@/lib/goods-attributes';

export async function readGoodsAttributesAction(categoryId: string | null, goodId: string | null = null) {
  if (!await requireAdminActionAccess('/admin/catalog/goods', { capability: 'catalog.read' })) return { error: '상품속성 조회 권한이 없습니다.' };
  if (categoryId !== null && !isUuid(categoryId) || goodId !== null && !/^[a-z0-9][a-z0-9-]*$/.test(goodId)) return { error: '조회할 카테고리와 상품을 확인해주세요.' };
  try { return { data: await loadGoodsAttributeWorkspace(categoryId, goodId) }; }
  catch { return { error: '상품속성을 불러오지 못했습니다. 입력은 유지됩니다. 다시 조회해주세요.' }; }
}
export async function saveGoodsAttributeSchemaAction(categoryId: string, fields: unknown, expectedRevision: number, operationId: string) {
  if (!await requireAdminActionAccess(GOODS_ATTRIBUTES_PATH, { adminOnly: true, capability: 'platform.manage' })) return { error: '상품속성 항목은 최고 관리자만 저장할 수 있습니다.' };
  if (!isUuid(categoryId) || !isUuid(operationId) || !Number.isSafeInteger(expectedRevision) || expectedRevision < 0) return { error: '저장할 카테고리를 확인하지 못했습니다. 화면을 새로고침한 뒤 카테고리를 다시 골라주세요.' };
  /* 어느 항목의 무엇이 문제인지 말한다. 화면이 먼저 같은 검사를 하므로 여기에 걸리는 것은 화면을 거치지 않은 요청이다. */
  if (!parseGoodsAttributeFields(fields)) return { error: goodsAttributeIssuesMessage(goodsAttributeFieldIssues(fields)) ?? '상품속성 항목을 읽지 못했습니다. 이름·유형·단위·선택값을 확인해주세요. 항목은 30개, 선택값은 항목당 100개까지 넣을 수 있습니다.' };
  try {
    const client = await createClient(); const { data, error } = await client.rpc('admin_save_goods_attribute_schema', { p_category_id: categoryId, p_fields: fields, p_expected_revision: expectedRevision, p_operation_id: operationId });
    if (error) return error.code === 'PT409' ? { error: '다른 사람이 먼저 바꿨습니다. [최신 항목 보기]를 눌러 바뀐 내용을 확인해주세요. 입력한 내용은 그대로 있습니다.', conflict: true } : { error: '상품속성 항목을 저장하지 못했습니다. 카테고리와 입력을 확인한 뒤 다시 저장해주세요.' };
    const saved = parseGoodsAttributeSchema(data); if (!saved) throw new Error();
    revalidatePath('/admin/catalog/attributes'); revalidatePath('/admin/catalog/goods'); revalidateGoodsSurfaces();
    return { data: saved };
  } catch { return { error: '저장됐는지 확인하지 못했습니다. [저장됐는지 확인]을 누르면 같은 내용이 두 번 저장되지 않습니다. 입력한 내용은 그대로 있습니다.', uncertain: true }; }
}
