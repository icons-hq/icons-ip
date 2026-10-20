'use server';
import { revalidatePath } from 'next/cache';
import { requireAdminActionAccess } from '@/lib/admin/action-access.server';
import { createClient } from '@/lib/supabase/server';
import { isUuid } from '@/lib/uuid';
import { GOODS_EVENT_TEMPLATES_PATH, goodsBenefitsError, parseGoodsBenefitSnapshot, parseGoodsBenefitValues, parseGoodsEventTemplate, parseGoodsEventTemplatePage, type GoodsBenefitSnapshot, type GoodsBenefitValues, type GoodsEventTemplate, type GoodsEventTemplatePage } from '@/lib/goods-benefits';

export type GoodsBenefitsResult<T> = { ok: true; value: T } | { ok: false; error: string; uncertain?: boolean; conflict?: boolean };
const unread = <T,>(): GoodsBenefitsResult<T> => ({ ok: false, error: '저장된 내용을 불러오지 못했습니다. 다시 조회해주세요.' });
const unknown = <T,>(): GoodsBenefitsResult<T> => ({ ok: false, error: '저장 결과를 확인하지 못했습니다. 같은 요청의 결과부터 확인해주세요.', uncertain: true });
const validGoodId = (value: unknown): value is string => typeof value === 'string' && /^[a-z0-9][a-z0-9-]{0,199}$/.test(value);
export async function loadGoodsBenefitsAction(goodId: string): Promise<GoodsBenefitsResult<GoodsBenefitSnapshot>> {
  if (!await requireAdminActionAccess('/admin/catalog/goods', { capability: 'catalog.manage' })) return { ok: false, error: '상품 관리 권한이 필요합니다.' };
  if (!validGoodId(goodId)) return unread();
  try {
    const client = await createClient(), { data, error } = await client.rpc('admin_get_goods_benefit_content', { p_good_id: goodId });
    const value = error ? null : parseGoodsBenefitSnapshot(data);
    return value?.goodId === goodId ? { ok: true, value } : unread();
  } catch { return unread(); }
}
export async function saveGoodsBenefitsAction(goodId: string, values: GoodsBenefitValues, revision: number, operationId: string): Promise<GoodsBenefitsResult<GoodsBenefitSnapshot>> {
  if (!await requireAdminActionAccess('/admin/catalog/goods', { capability: 'catalog.manage' })) return { ok: false, error: '상품 관리 권한이 필요합니다.' };
  const parsed = parseGoodsBenefitValues(values);
  if (!validGoodId(goodId) || !parsed || !isUuid(operationId) || !Number.isSafeInteger(revision) || revision < 0) return { ok: false, error: '이벤트 40자·사은품 설명 100자·서로 다른 사진 3장까지 입력해주세요. 사진에는 설명이 필요합니다.' };
  try {
    const client = await createClient(), { data, error } = await client.rpc('admin_save_goods_benefit_content', { p_good_id: goodId, p_values: parsed, p_expected_revision: revision, p_operation_id: operationId });
    if (error) return ['PT409', '23505', '23514', '22023', '42501', 'P0002'].includes(error.code ?? '') ? { ok: false, error: goodsBenefitsError(error.message), conflict: error.code === 'PT409' || error.code === '23505' } : unknown();
    const value = parseGoodsBenefitSnapshot(data);
    if (!value || value.goodId !== goodId || value.revision !== revision + 1 || value.eventText !== parsed.eventText || value.giftText !== parsed.giftText || JSON.stringify(value.giftImagePaths) !== JSON.stringify(parsed.giftImagePaths)) return unknown();
    revalidatePath(`/shop/${goodId}`); revalidatePath('/admin/catalog/goods');
    return { ok: true, value };
  } catch { return unknown(); }
}
export async function listGoodsEventTemplatesAction(query: string, archived: boolean, page: number): Promise<GoodsBenefitsResult<GoodsEventTemplatePage>> {
  if (!await requireAdminActionAccess('/admin/catalog/goods', { capability: 'catalog.manage' })) return { ok: false, error: '상품 관리 권한이 필요합니다.' };
  if (typeof query !== 'string' || query.length > 100 || typeof archived !== 'boolean' || !Number.isSafeInteger(page) || page < 1 || page > 100000) return unread();
  try {
    const client = await createClient(), { data, error } = await client.rpc('admin_list_goods_event_templates', { p_query: query.trim(), p_archived: archived, p_page: page });
    const value = error ? null : parseGoodsEventTemplatePage(data);
    return value && value.page === page ? { ok: true, value } : unread();
  } catch { return unread(); }
}
export async function saveGoodsEventTemplateAction(id: string, eventText: string, archived: boolean, revision: number, operationId: string): Promise<GoodsBenefitsResult<GoodsEventTemplate>> {
  if (!await requireAdminActionAccess('/admin/catalog/goods', { capability: 'catalog.manage' })) return { ok: false, error: '상품 관리 권한이 필요합니다.' };
  const parsed = parseGoodsBenefitValues({ eventText, giftText: '', giftImagePaths: [] });
  if (!isUuid(id) || !isUuid(operationId) || !parsed?.eventText || typeof archived !== 'boolean' || !Number.isSafeInteger(revision) || revision < 0) return { ok: false, error: '이벤트 문구를 1~40자로 입력해주세요.' };
  try {
    const client = await createClient(), { data, error } = await client.rpc('admin_save_goods_event_template', { p_id: id, p_event_text: parsed.eventText, p_archived: archived, p_expected_revision: revision, p_operation_id: operationId });
    if (error) return ['PT409', '23505', '23514', '22023', '42501'].includes(error.code ?? '') ? { ok: false, error: goodsBenefitsError(error.message), conflict: error.code === 'PT409' || error.code === '23505' } : unknown();
    const value = parseGoodsEventTemplate(data); if (!value || value.id !== id || value.revision !== revision + 1 || value.eventText !== parsed.eventText || value.archived !== archived) return unknown();
    revalidatePath(GOODS_EVENT_TEMPLATES_PATH);
    return { ok: true, value };
  } catch { return unknown(); }
}
