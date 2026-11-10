'use server';
import { revalidatePath } from 'next/cache';
import { unstable_rethrow } from 'next/navigation';
import { requireAdminActionAccess } from '@/lib/admin/action-access.server';
import { createClient } from '@/lib/supabase/server';
import { isUuid } from '@/lib/uuid';
import { parseReviewBestRequest, parseReviewBestSettings, parseReviewBestState, REVIEW_BEST_SETTINGS_PATH, REVIEW_BEST_PROBLEM_LABELS, type ReviewBestProblem, type ReviewBestSettings, type ReviewBestState } from '@/lib/review-best';

type Failure = { error: string; uncertain?: boolean };
export type BestReviewResult = { state: ReviewBestState } | Failure;
export type BestReviewSettingsResult = { settings: ReviewBestSettings } | Failure;
const unknownResult = (): Failure => ({ error: '저장 결과를 확인하지 못했습니다. 같은 요청으로 다시 확인해주세요.', uncertain: true });
function knownError(error: { code?: string; message?: string }): Failure | null {
  if (error.code === 'PT409') return { error: '리뷰 또는 설정이 변경되었습니다. 입력한 사유를 보관하고 새로고침 후 다시 확인해주세요.' };
  if (error.message && Object.hasOwn(REVIEW_BEST_PROBLEM_LABELS, error.message)) return { error: REVIEW_BEST_PROBLEM_LABELS[error.message as ReviewBestProblem] };
  if (['22023', '42501', 'P0002', '23505', '23514'].includes(error.code ?? '')) return { error: '현재 권한과 리뷰, 입력값을 확인해주세요.' };
  return null;
}
export async function setBestReviewAction(input: unknown): Promise<BestReviewResult> {
  try {
    if (!await requireAdminActionAccess('/admin/cs/reviews', { capability: 'cs.manage' })) return { error: '리뷰 관리 권한이 필요합니다.' };
    const request = parseReviewBestRequest(input);
    if (!request) return { error: '선정 사유와 저장 기준을 확인해주세요.' };
    const { data, error } = await (await createClient()).rpc('admin_set_review_best', { p_review_id: request.reviewId, p_selected: request.selected,
      p_reason: request.reason, p_expected_revision: request.expectedRevision, p_review_fingerprint: request.reviewFingerprint, p_operation_id: request.operationId });
    if (error) return knownError(error) ?? unknownResult();
    const state = parseReviewBestState(data);
    if (!state || state.reviewId !== request.reviewId || state.selected !== request.selected || state.revision !== request.expectedRevision + 1 || state.reviewFingerprint !== request.reviewFingerprint || state.reason !== request.reason) return unknownResult();
    revalidatePath('/admin/cs/reviews'); revalidatePath('/shop/[goodId]', 'page');
    return { state };
  } catch (error) { unstable_rethrow(error); return unknownResult(); }
}
export async function saveBestReviewSettingsAction(enabled: boolean, expectedRevision: number, operationId: string): Promise<BestReviewSettingsResult> {
  try {
    if (!await requireAdminActionAccess(REVIEW_BEST_SETTINGS_PATH, { capability: 'store.manage' })) return { error: '스토어 관리 권한이 필요합니다.' };
    if (typeof enabled !== 'boolean' || !Number.isSafeInteger(expectedRevision) || expectedRevision < 0 || !isUuid(operationId)) return { error: '설정과 저장 기준을 확인해주세요.' };
    const { data, error } = await (await createClient()).rpc('admin_save_review_best_settings', { p_enabled: enabled, p_expected_revision: expectedRevision, p_operation_id: operationId });
    if (error) return knownError(error) ?? unknownResult();
    const settings = parseReviewBestSettings(data);
    if (!settings || settings.enabled !== enabled || settings.revision !== expectedRevision + 1) return unknownResult();
    revalidatePath(REVIEW_BEST_SETTINGS_PATH); revalidatePath('/shop/[goodId]', 'page');
    return { settings };
  } catch (error) { unstable_rethrow(error); return unknownResult(); }
}
