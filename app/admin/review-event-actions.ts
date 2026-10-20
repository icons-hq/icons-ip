'use server';
import { revalidatePath } from 'next/cache';
import { unstable_rethrow } from 'next/navigation';
import { requireAdminActionAccess } from '@/lib/admin/action-access.server';
import { createClient } from '@/lib/supabase/server';
import { isUuid } from '@/lib/uuid';
import { parseReviewEvent, parseReviewEventSelection, parseReviewEventValues, reviewEventError, REVIEW_EVENTS_ADMIN_PATH, REVIEW_EVENTS_PATH, type ReviewEvent } from '@/lib/review-events';

export type ReviewEventActionResult = { event: ReviewEvent } | { error: string; uncertain?: boolean };
const uncertain = (): ReviewEventActionResult => ({ error: '저장 결과를 확인하지 못했습니다. 입력을 유지한 채 같은 요청으로 다시 확인해주세요.', uncertain: true });
const validRevision = (value: number) => Number.isSafeInteger(value) && value >= 0;
async function execute(name: string, args: Record<string, unknown>, eventId?: string): Promise<ReviewEventActionResult> {
  try {
    const client = await createClient();
    const { data, error } = await client.rpc(name, args);
    if (error) {
      if (['22023', '42501', 'P0002', '23514', '23505', 'PT409', '28000'].includes(error.code ?? '')) return { error: reviewEventError(error.message) };
      return uncertain();
    }
    const result = parseReviewEvent(data);
    if (!result || eventId && result.id !== eventId) return uncertain();
    const readback = await client.rpc('admin_get_review_event', { p_id: result.id, p_page: 1, p_query: '', p_filter: 'all' });
    const saved = parseReviewEvent(readback.data?.event);
    if (readback.error || !saved || saved.revision < result.revision) return uncertain();
    revalidatePath(REVIEW_EVENTS_ADMIN_PATH); revalidatePath(REVIEW_EVENTS_PATH); revalidatePath(`${REVIEW_EVENTS_PATH}/[eventId]`, 'page');
    revalidatePath('/shop/[goodId]', 'page'); revalidatePath('/my/reviews'); revalidatePath('/my/store-credits'); revalidatePath('/admin/sales/store-credits');
    return { event: saved };
  } catch (error) { unstable_rethrow(error); return uncertain(); }
}
export async function saveReviewEventAction(id: string, revision: number, operationId: string, input: unknown): Promise<ReviewEventActionResult> {
  if (!await requireAdminActionAccess(REVIEW_EVENTS_ADMIN_PATH, { capability: 'cs.manage' })) return { error: '리뷰 관리 권한이 필요합니다.' };
  const values = parseReviewEventValues(input);
  if (!isUuid(id) || !isUuid(operationId) || !validRevision(revision) || !values) return { error: '제목·내용·대상·기간·선정수·혜택 금액을 확인해주세요.' };
  return execute('admin_save_review_event', { p_id: id, p_expected_revision: revision, p_operation_id: operationId, p_values: values }, id);
}
export async function archiveReviewEventAction(id: string, revision: number, operationId: string, archived: boolean): Promise<ReviewEventActionResult> {
  if (!await requireAdminActionAccess(REVIEW_EVENTS_ADMIN_PATH, { capability: 'cs.manage' })) return { error: '리뷰 관리 권한이 필요합니다.' };
  if (!isUuid(id) || !isUuid(operationId) || !validRevision(revision) || typeof archived !== 'boolean') return { error: '최신 이벤트를 다시 열어주세요.' };
  return execute('admin_archive_review_event', { p_id: id, p_expected_revision: revision, p_operation_id: operationId, p_archived: archived }, id);
}
export async function selectReviewEventEntriesAction(id: string, revision: number, operationId: string, input: unknown, reason: string): Promise<ReviewEventActionResult> {
  if (!await requireAdminActionAccess(REVIEW_EVENTS_ADMIN_PATH, { capability: 'cs.manage' })) return { error: '리뷰 관리 권한이 필요합니다.' };
  const entries = parseReviewEventSelection(input);
  if (!isUuid(id) || !isUuid(operationId) || !validRevision(revision) || !entries || typeof reason !== 'string' || [...reason.trim()].length < 2 || [...reason.trim()].length > 500) return { error: '선정 대상과 사유(2~500자)를 확인해주세요.' };
  return execute('admin_select_review_event_entries', { p_id: id, p_expected_revision: revision, p_operation_id: operationId, p_entries: entries, p_reason: reason.trim() }, id);
}
export async function publishReviewEventAction(id: string, revision: number, operationId: string): Promise<ReviewEventActionResult> {
  if (!await requireAdminActionAccess(REVIEW_EVENTS_ADMIN_PATH, { capability: 'marketing.manage', adminOnly: true })) return { error: '혜택 지급 권한이 필요합니다.' };
  if (!isUuid(id) || !isUuid(operationId) || !validRevision(revision)) return { error: '최신 이벤트와 선정 현황을 다시 열어주세요.' };
  return execute('admin_publish_review_event', { p_id: id, p_expected_revision: revision, p_operation_id: operationId }, id);
}
export async function revokeReviewEventAwardAction(entryId: string, operationId: string, reason: string): Promise<ReviewEventActionResult> {
  if (!await requireAdminActionAccess(REVIEW_EVENTS_ADMIN_PATH, { capability: 'marketing.manage', adminOnly: true })) return { error: '혜택 회수 권한이 필요합니다.' };
  if (!isUuid(entryId) || !isUuid(operationId) || typeof reason !== 'string' || [...reason.trim()].length < 2 || [...reason.trim()].length > 500) return { error: '회수 대상과 사유(2~500자)를 확인해주세요.' };
  return execute('admin_revoke_review_event_award', { p_entry_id: entryId, p_operation_id: operationId, p_reason: reason.trim() });
}

export async function searchReviewEventTargetsAction(type: 'goods' | 'categories', query = '', page = 1, ids?: string[]) {
  if (!await requireAdminActionAccess(REVIEW_EVENTS_ADMIN_PATH, { capability: 'cs.manage' })) return { error: '리뷰 관리 권한이 필요합니다.' };
  if (!['goods', 'categories'].includes(type) || typeof query !== 'string' || query.length > 100 || !Number.isSafeInteger(page) || page < 1 || page > 100000 || ids && (ids.length > 500 || ids.some(id => typeof id !== 'string'))) return { error: '검색 조건을 확인해주세요.' };
  try {
    const { data, error } = await (await createClient()).rpc('admin_search_review_event_targets', { p_type: type, p_query: query.trim(), p_page: page, p_ids: ids ?? null });
    if (error || !data || !Number.isSafeInteger(data.total) || data.total < 0 || data.page !== page || !Array.isArray(data.rows) || data.rows.some((row: Record<string, unknown>) => !row || typeof row.id !== 'string' || typeof row.label !== 'string' || typeof row.code !== 'string')) return { error: '대상 목록을 불러오지 못했습니다.' };
    return { data: data as { total: number; page: number; rows: import('@/lib/review-events').ReviewEventTarget[] } };
  } catch (error) { unstable_rethrow(error); return { error: '대상 목록을 불러오지 못했습니다.' }; }
}
