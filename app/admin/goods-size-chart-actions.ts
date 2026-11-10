'use server';

import { revalidatePath } from 'next/cache';
import { requireAdminActionAccess } from '@/lib/admin/action-access.server';
import { createClient } from '@/lib/supabase/server';
import { isUuid } from '@/lib/uuid';
import {
  GOODS_SIZE_LIMITS, GOODS_SIZE_TEMPLATES_PATH, goodsSizeChartError, parseGoodsSizeChart, parseGoodsSizeChartSnapshot,
  parseGoodsSizeChartValues, parseGoodsSizeName, parseGoodsSizeTemplate, parseGoodsSizeTemplatePage,
  type GoodsSizeChart, type GoodsSizeChartSnapshot, type GoodsSizeChartValues, type GoodsSizeTemplate, type GoodsSizeTemplatePage,
} from '@/lib/goods-size-chart';

export type GoodsSizeResult<T> = { ok: true; value: T } | { ok: false; error: string; uncertain?: boolean; conflict?: boolean };
const unread = <T,>(): GoodsSizeResult<T> => ({ ok: false, error: '저장된 사이즈 안내를 불러오지 못했습니다. 다시 조회해주세요.' });
const unknown = <T,>(): GoodsSizeResult<T> => ({ ok: false, error: '저장 결과를 확인하지 못했습니다. 같은 요청 결과를 확인해주세요.', uncertain: true });
const validGoodId = (value: unknown): value is string => typeof value === 'string' && /^[a-z0-9][a-z0-9-]{0,199}$/.test(value);
const validRevision = (revision: number) => Number.isInteger(revision) && revision >= 0 && revision < 2147483647;
const knownFailure = (code?: string) => ['PT409', '23505', '23514', '22023', '42501', 'P0002'].includes(code ?? '');
const noAccess = <T,>(): GoodsSizeResult<T> => ({ ok: false, error: '상품 관리 권한이 필요합니다.' });

export async function loadGoodsSizeChartAction(goodId: string): Promise<GoodsSizeResult<GoodsSizeChartSnapshot>> {
  if (!await requireAdminActionAccess('/admin/catalog/goods', { capability: 'catalog.manage' })) return noAccess();
  if (!validGoodId(goodId)) return unread();
  try {
    const client = await createClient(), { data, error } = await client.rpc('admin_get_goods_size_chart', { p_good_id: goodId });
    const value = error ? null : parseGoodsSizeChartSnapshot(data);
    return value?.goodId === goodId ? { ok: true, value } : unread();
  } catch { return unread(); }
}

export async function saveGoodsSizeChartAction(goodId: string, values: GoodsSizeChartValues, revision: number, operationId: string): Promise<GoodsSizeResult<GoodsSizeChartSnapshot>> {
  if (!await requireAdminActionAccess('/admin/catalog/goods', { capability: 'catalog.manage' })) return noAccess();
  const parsed = parseGoodsSizeChartValues(values);
  if (!validGoodId(goodId) || !parsed || !validRevision(revision) || !isUuid(operationId)) return { ok: false, error: goodsSizeChartError() };
  try {
    const client = await createClient(), { data, error } = await client.rpc('admin_save_goods_size_chart', { p_good_id: goodId, p_values: parsed, p_expected_revision: revision, p_operation_id: operationId });
    if (error) return knownFailure(error.code) ? { ok: false, error: goodsSizeChartError(error.message), conflict: error.code === 'PT409' || error.code === '23505' } : unknown();
    const value = parseGoodsSizeChartSnapshot(data);
    if (!value || value.goodId !== goodId || value.revision !== revision + 1 || JSON.stringify(value.values) !== JSON.stringify(parsed)) return unknown();
    revalidatePath(`/shop/${goodId}`);
    revalidatePath('/admin/catalog/goods');
    return { ok: true, value };
  } catch { return unknown(); }
}

export async function listGoodsSizeTemplatesAction(query: string, archived: boolean, page: number): Promise<GoodsSizeResult<GoodsSizeTemplatePage>> {
  if (!await requireAdminActionAccess('/admin/catalog/goods', { capability: 'catalog.manage' })) return noAccess();
  if (typeof query !== 'string' || Array.from(query).length > 100 || typeof archived !== 'boolean' || !Number.isInteger(page) || page < 1 || page > 100000) return unread();
  try {
    const client = await createClient(), { data, error } = await client.rpc('admin_list_goods_size_templates', { p_query: query, p_archived: archived, p_page: page });
    const value = error ? null : parseGoodsSizeTemplatePage(data);
    return value?.page === page ? { ok: true, value } : unread();
  } catch { return unread(); }
}

export async function saveGoodsSizeTemplateAction(id: string, name: string, chart: GoodsSizeChart, archived: boolean, revision: number, operationId: string): Promise<GoodsSizeResult<GoodsSizeTemplate>> {
  if (!await requireAdminActionAccess('/admin/catalog/goods', { capability: 'catalog.manage' })) return noAccess();
  const parsed = parseGoodsSizeChart(chart), normalizedName = parseGoodsSizeName(name, GOODS_SIZE_LIMITS.templateName);
  if (!isUuid(id) || !isUuid(operationId) || !normalizedName || !parsed || typeof archived !== 'boolean' || !validRevision(revision)) return { ok: false, error: '템플릿 이름(50자 이내)과 모든 치수를 확인해주세요.' };
  try {
    const client = await createClient(), { data, error } = await client.rpc('admin_save_goods_size_template', { p_id: id, p_name: normalizedName, p_chart: parsed, p_archived: archived, p_expected_revision: revision, p_operation_id: operationId });
    if (error) return knownFailure(error.code) ? { ok: false, error: goodsSizeChartError(error.message), conflict: error.code === 'PT409' || error.code === '23505' } : unknown();
    const value = parseGoodsSizeTemplate(data);
    if (!value || value.id !== id || value.revision !== revision + 1 || value.archived !== archived || value.name !== normalizedName || JSON.stringify(value.chart) !== JSON.stringify(parsed)) return unknown();
    revalidatePath(GOODS_SIZE_TEMPLATES_PATH);
    return { ok: true, value };
  } catch { return unknown(); }
}
