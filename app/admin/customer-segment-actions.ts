'use server';
import { revalidatePath } from 'next/cache';
import { unstable_rethrow } from 'next/navigation';
import { requireAdminActionAccess } from '@/lib/admin/action-access.server';
import { CUSTOMER_SEGMENTS_PATH, isCount, isRecord, normalizeSegmentRule, parseSegmentEstimate, type SegmentActionResult, type SegmentEstimate, type SegmentOptionKind, type SegmentOptions, type SegmentRule } from '@/lib/admin/customer-segments';
import { loadCustomerSegmentOptions } from '@/lib/admin/customer-segments.server';
import { createClient } from '@/lib/supabase/server';
import { isUuid } from '@/lib/uuid';
function uncertain<T>(): SegmentActionResult<T> { return { error: '처리 결과를 확인하지 못했습니다. 입력을 유지한 채 같은 요청으로 다시 확인해주세요.', uncertain: true }; }
function rpcFailure<T>(error: { code?: string; message?: string }): SegmentActionResult<T> {
  const messages: Record<string,string> = { operator_capability_required: '타겟 세그먼트 관리 권한이 없습니다.', customer_segment_changed: '다른 운영자가 변경했습니다. 저장 내용을 다시 불러온 뒤 수정해주세요.', customer_segment_operation_conflict: '이 요청의 내용이 달라졌습니다. 저장 내용을 다시 확인해주세요.', customer_segment_estimate_required: '같은 조건의 고객수를 다시 확인해주세요. 확인 결과는 15분 동안 저장에 사용할 수 있습니다.', customer_segment_target_unavailable: '선택 대상 또는 회원 분석 수집 설정을 사용할 수 없습니다. 대상과 수집 설정을 확인해주세요.', customer_segment_favorite_limit: '즐겨찾기는 최대 3개입니다. 기존 즐겨찾기를 해제한 뒤 추가해주세요.', customer_segment_preset_readonly: '기본 세그먼트는 복사해서 새로운 세그먼트로 저장해주세요.', customer_segment_not_found: '삭제되었거나 찾을 수 없는 세그먼트입니다.', customer_segment_limit: '저장 가능한 세그먼트 수를 초과했습니다. 사용하지 않는 세그먼트를 정리해주세요.' };
  if (error.message && messages[error.message]) return { error: messages[error.message] };
  return ['22023','23514','42501','P0002','55000','PT409'].includes(error.code ?? '') ? { error: '조건과 현재 권한을 확인한 뒤 다시 시도해주세요.' } : uncertain<T>();
}
async function access() { return requireAdminActionAccess(CUSTOMER_SEGMENTS_PATH, { capability: 'marketing.manage' }); }
export async function estimateCustomerSegmentAction(input: SegmentRule, operationId: string): Promise<SegmentActionResult<SegmentEstimate>> {
  try {
    if (!await access()) return { error: '타겟 세그먼트 관리 권한이 없습니다.' };
    const rule = normalizeSegmentRule(input); if (!rule || !isUuid(operationId)) return { error: '대상 조건을 확인해주세요.' };
    const client = await createClient(); const { data, error } = await client.rpc('admin_estimate_customer_segment', { p_rule: rule, p_operation_id: operationId });
    if (error) return rpcFailure(error); const estimate = parseSegmentEstimate(data); if (!estimate || estimate.id !== operationId) return uncertain();
    revalidatePath(CUSTOMER_SEGMENTS_PATH); return { data: estimate };
  } catch (error) { unstable_rethrow(error); return uncertain(); }
}
export async function saveCustomerSegmentAction(input: { id: string; revision: number; operationId: string; name: string; rule: SegmentRule; estimateId: string }): Promise<SegmentActionResult<{ id: string; revision: number }>> {
  try {
    if (!await access()) return { error: '타겟 세그먼트 관리 권한이 없습니다.' };
    const rule = normalizeSegmentRule(input?.rule), name = typeof input?.name === 'string' ? input.name.trim() : '';
    if (!rule || !isUuid(input.id) || !isUuid(input.operationId) || !isUuid(input.estimateId) || !isCount(input.revision) || input.revision > 1_000_000_000 || !name || [...name].length > 50 || /[\u0000-\u001f\u007f]/.test(name)) return { error: '세그먼트명과 조건을 확인해주세요.' };
    const client = await createClient(); const { data, error } = await client.rpc('admin_save_customer_segment', { p_id: input.id, p_expected_revision: input.revision, p_operation_id: input.operationId, p_name: name, p_rule: rule, p_estimate_id: input.estimateId });
    if (error) return rpcFailure(error); if (!isRecord(data) || data.id !== input.id || !isCount(data.revision) || data.revision !== input.revision + 1) return uncertain();
    revalidatePath(CUSTOMER_SEGMENTS_PATH); revalidatePath(`${CUSTOMER_SEGMENTS_PATH}/${input.id}`); return { data: { id: input.id, revision: data.revision } };
  } catch (error) { unstable_rethrow(error); return uncertain(); }
}
export async function archiveCustomerSegmentsAction(entries: { id: string; revision: number }[], operationId: string): Promise<SegmentActionResult<{ archivedCount: number }>> {
  try {
    if (!await access()) return { error: '타겟 세그먼트 관리 권한이 없습니다.' };
    if (!isUuid(operationId) || !Array.isArray(entries) || !entries.length || entries.length > 100 || new Set(entries.map(x => x.id)).size !== entries.length || entries.some(x => !isUuid(x.id) || !isCount(x.revision) || x.revision < 1)) return { error: '삭제할 세그먼트를 선택해주세요.' };
    const client = await createClient(); const { data, error } = await client.rpc('admin_archive_customer_segments', { p_entries: entries, p_operation_id: operationId });
    if (error) return rpcFailure(error); if (!isRecord(data) || data.archivedCount !== entries.length) return uncertain();
    revalidatePath(CUSTOMER_SEGMENTS_PATH); for (const entry of entries) revalidatePath(`${CUSTOMER_SEGMENTS_PATH}/${entry.id}`);
    return { data: { archivedCount: entries.length } };
  } catch (error) { unstable_rethrow(error); return uncertain(); }
}
export async function favoriteCustomerSegmentAction(id: string, favorite: boolean): Promise<SegmentActionResult<boolean>> {
  try { if (!await access()) return { error: '타겟 세그먼트 관리 권한이 없습니다.' }; if (!isUuid(id) || typeof favorite !== 'boolean') return { error: '세그먼트를 확인해주세요.' };
    const client = await createClient(); const { data, error } = await client.rpc('admin_set_customer_segment_favorite', { p_segment_id: id, p_favorite: favorite });
    if (error) return rpcFailure(error); if (data !== favorite) return uncertain(); revalidatePath(CUSTOMER_SEGMENTS_PATH); revalidatePath(`${CUSTOMER_SEGMENTS_PATH}/${id}`); return { data };
  } catch (error) { unstable_rethrow(error); return uncertain(); }
}
export async function searchCustomerSegmentOptionsAction(kind: SegmentOptionKind, query: string, page: number): Promise<SegmentActionResult<SegmentOptions>> {
  try { if (!await access()) return { error: '타겟 세그먼트 관리 권한이 없습니다.' };
    if (!['good','category','ip','coupon'].includes(kind) || typeof query !== 'string' || query.trim().length > 100 || !Number.isSafeInteger(page) || page < 1 || page > 1_000_000) return { error: '검색 조건을 확인해주세요.' };
    return { data: await loadCustomerSegmentOptions(kind, query.trim(), page) };
  } catch (error) { unstable_rethrow(error); return { error: '선택 대상을 불러오지 못했습니다. 다시 조회해주세요.' }; }
}
