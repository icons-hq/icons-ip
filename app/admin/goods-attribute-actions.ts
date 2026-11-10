'use server';
import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { requireAdminActionAccess } from '@/lib/admin/action-access.server';
import { GOODS_ATTRIBUTES_PATH } from '@/lib/admin/goods-attributes';
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
  if (!await requireAdminActionAccess(GOODS_ATTRIBUTES_PATH, { adminOnly: true, capability: 'platform.manage' })) return { error: '속성 정의는 관리자만 저장할 수 있습니다.' };
  if (!isUuid(categoryId) || !isUuid(operationId) || !parseGoodsAttributeFields(fields) || !Number.isSafeInteger(expectedRevision) || expectedRevision < 0) return { error: '항목명·유형·단위·선택값을 확인해주세요. 항목은 최대 30개, 선택값은 항목당 최대 100개입니다.' };
  try {
    const client = await createClient(); const { data, error } = await client.rpc('admin_save_goods_attribute_schema', { p_category_id: categoryId, p_fields: fields, p_expected_revision: expectedRevision, p_operation_id: operationId });
    if (error) return error.code === 'PT409' ? { error: '다른 관리자가 정의를 변경했습니다. 내 입력을 보관한 채 최신 정의를 조회해 비교해주세요.', conflict: true } : { error: '속성 정의를 저장하지 못했습니다. 카테고리와 입력을 확인해주세요.' };
    const saved = parseGoodsAttributeSchema(data); if (!saved) throw new Error();
    revalidatePath('/admin/catalog/attributes'); revalidatePath('/admin/catalog/goods'); revalidatePath('/shop', 'layout');
    return { data: saved };
  } catch { return { error: '저장 결과를 확인하지 못했습니다. 최신 정의를 조회해주세요. 입력은 유지됩니다.' }; }
}
