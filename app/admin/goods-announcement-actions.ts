'use server';
import { revalidatePath } from 'next/cache';
import { revalidateGoodsSurfaces } from '@/lib/admin/revalidate-goods.server';
import { unstable_rethrow } from 'next/navigation';
import { requireAdminActionAccess } from '@/lib/admin/action-access.server';
import { createClient } from '@/lib/supabase/server';
import { isUuid } from '@/lib/uuid';
import { GOODS_ANNOUNCEMENT_CHECK_LABEL, GOODS_ANNOUNCEMENT_RETRY_LABEL, GOODS_ANNOUNCEMENT_UNKNOWN_MESSAGE, GOODS_ANNOUNCEMENTS_PATH, parseGoodsAnnouncementInput, type GoodsAnnouncement, type GoodsAnnouncementCandidates } from '@/lib/admin/goods-announcements';
import { loadGoodsAnnouncement, searchGoodsForAnnouncement } from '@/lib/admin/goods-announcements.server';

/* 저장은 됐는데 저장된 내용을 다시 읽지 못했을 때. 화면의 링크 이름 그대로 적는다. */
const REOPEN_SAVED = '저장됐지만 저장된 내용을 불러오지 못했습니다. [저장된 공지 다시 열기]를 눌러 주세요.';
/* 저장됐는지 다시 물었는데 확인하지 못했을 때(연결·권한). 앞서 저장하려던 내용은 화면에 그대로 있다. */
const CHECK_FAILED = `저장됐는지 확인하지 못했습니다. 잠시 뒤 [${GOODS_ANNOUNCEMENT_CHECK_LABEL}]을 다시 눌러 주세요.`;
export interface GoodsAnnouncementActionState { errors?: Record<string, string>; message?: string; saved?: GoodsAnnouncement; savedId?: string; outcome?: 'saved' | 'rejected' | 'unknown'; reloadRequired?: boolean }
async function readSavedAnnouncement(previous: GoodsAnnouncementActionState, id: string, result: unknown): Promise<GoodsAnnouncementActionState> {
  if (!result || typeof result !== 'object' || !('id' in result) || result.id !== id || !('revision' in result)
    || !Number.isSafeInteger(result.revision) || Number(result.revision) < 1) return { saved: previous.saved, outcome: 'unknown', errors: { form: GOODS_ANNOUNCEMENT_UNKNOWN_MESSAGE } };
  revalidatePath(GOODS_ANNOUNCEMENTS_PATH); revalidateGoodsSurfaces();
  const saved = await loadGoodsAnnouncement(id);
  if (!saved) return { saved: previous.saved, savedId: id, outcome: 'saved', reloadRequired: true, message: REOPEN_SAVED };
  return { saved, savedId: id, outcome: 'saved', message: saved.revision === result.revision
    ? '공지를 저장했습니다.' : '공지를 저장했습니다. 그 뒤에 바뀐 내용까지 불러왔습니다.' };
}
export async function saveGoodsAnnouncementAction(previous: GoodsAnnouncementActionState, form: FormData): Promise<GoodsAnnouncementActionState> {
  const fail = (errors: Record<string, string>, outcome: 'rejected' | 'unknown' = 'rejected'): GoodsAnnouncementActionState => ({ errors, saved: previous.saved, outcome });
  const access = await requireAdminActionAccess(GOODS_ANNOUNCEMENTS_PATH);
  if (!access) return fail({ form: '관리자 권한이 필요합니다.' });
  if (form.get('accountId') !== access.user.id) return fail({ form: '로그인 계정이 바뀌어 저장하지 않았습니다. 적은 내용을 복사해 두고 화면을 새로고침한 뒤 다시 저장해 주세요.' });
  const operationId = form.get('operationId');
  if (!isUuid(operationId)) return fail({ form: '저장할 내용을 읽지 못했습니다. 적은 내용을 복사해 두고 화면을 새로고침한 뒤 다시 저장해 주세요.' });
  const parsed = parseGoodsAnnouncementInput(form);
  if (!parsed.ok) return fail(parsed.errors);
  let confirmed = false;
  try {
    const client = await createClient(); const { data, error } = await client.rpc('admin_save_goods_announcement_v2', {
      p_operation_id: operationId, p_id: parsed.id, p_expected_revision: parsed.revision, p_values: parsed.value,
      p_popup_intent: parsed.popupIntent, p_expected_popup_revision: parsed.popupRevision,
    });
    if (error) {
      /* 거절이 확실한 오류만 '저장하지 못했습니다'라고 말한다. 그 밖(연결 끊김·시간 초과)은 저장됐을 수도 있어 결과를 모르는 상태로 둔다. */
      const rejected = ['22023', '23514', '23503', '23505', 'P0002', 'PT409', '42501', '28000'].includes(error.code ?? '')
        || ['goods_announcement_changed', 'goods_announcement_popup_changed', 'invalid_goods_announcement_goods', 'forbidden', 'unauthorized', 'operator_capability_required'].includes(error.message);
      if (!rejected) return fail({ form: GOODS_ANNOUNCEMENT_UNKNOWN_MESSAGE }, 'unknown');
      return fail({ form: error.message === 'goods_announcement_changed' ? '다른 사람이 먼저 바꿨습니다. 적은 내용을 복사해 두고 공지를 다시 연 뒤 고쳐 주세요.'
        : error.message === 'goods_announcement_popup_changed' ? '다른 사람이 홈 팝업을 먼저 바꿨습니다. 적은 내용을 복사해 두고 공지를 다시 연 뒤 저장해 주세요.'
        : error.message === 'invalid_goods_announcement_goods' ? '방금 고른 상품 가운데 지워진 상품이 있습니다. 새로 고른 상품을 뺀 뒤 [상품 고르기]에서 다시 골라 주세요.'
        : error.code === '28000' || error.message === 'unauthorized' ? '로그인이 풀려 저장하지 못했습니다. 적은 내용을 복사해 두고 다시 로그인한 뒤 저장해 주세요.'
        : error.code === '42501' || ['forbidden', 'operator_capability_required'].includes(error.message) ? '공지를 저장할 권한이 없습니다. 판매자 정보 > 매니저 관리 담당자에게 권한을 요청해 주세요.'
          : '공지를 저장하지 못했습니다. 적은 내용은 그대로 있습니다. 칸마다 내용을 확인한 뒤 다시 저장해 주세요.' });
    }
    confirmed = Boolean(data && data.id === parsed.id && Number.isSafeInteger(data.revision) && data.revision > 0);
    return await readSavedAnnouncement(previous, parsed.id, data);
  } catch (error) {
    unstable_rethrow(error);
    if (confirmed) return { saved: previous.saved, savedId: parsed.id, outcome: 'saved', reloadRequired: true, message: REOPEN_SAVED };
    return fail({ form: GOODS_ANNOUNCEMENT_UNKNOWN_MESSAGE }, 'unknown');
  }
}
export async function resolveGoodsAnnouncementSaveAction(previous: GoodsAnnouncementActionState, operationId: string, id: string, accountId: string): Promise<GoodsAnnouncementActionState> {
  const unknown = (message: string): GoodsAnnouncementActionState => ({ saved: previous.saved, outcome: 'unknown', errors: { form: message } });
  const access = await requireAdminActionAccess(GOODS_ANNOUNCEMENTS_PATH);
  if (!access) return unknown(`관리자 권한을 확인하지 못했습니다. 잠시 뒤 [${GOODS_ANNOUNCEMENT_CHECK_LABEL}]을 다시 눌러 주세요.`);
  if (accountId !== access.user.id) return unknown('로그인 계정이 바뀌어 확인할 수 없습니다. 저장을 누른 계정으로 로그인해 목록에서 공지를 확인해 주세요.');
  if (!isUuid(operationId) || !isUuid(id)) return unknown('앞서 저장하려던 내용을 읽지 못했습니다. 화면을 새로고침한 뒤 목록에서 공지를 확인해 주세요.');
  let confirmed = false;
  try {
    const client = await createClient();
    const { data, error } = await client.rpc('admin_get_goods_announcement_save_result', { p_operation_id: operationId });
    if (error) return unknown(CHECK_FAILED);
    if (data === null) return unknown(`아직 저장되지 않았습니다. [${GOODS_ANNOUNCEMENT_RETRY_LABEL}]을 눌러 주세요.`);
    confirmed = Boolean(data && data.id === id && Number.isSafeInteger(data.revision) && data.revision > 0);
    return await readSavedAnnouncement(previous, id, data);
  } catch (error) {
    unstable_rethrow(error);
    if (confirmed) return { saved: previous.saved, savedId: id, outcome: 'saved', reloadRequired: true, message: REOPEN_SAVED };
    return unknown(CHECK_FAILED);
  }
}
export async function findGoodsForAnnouncementAction(query: string, page: number): Promise<{ data: GoodsAnnouncementCandidates } | { error: string }> {
  if (!await requireAdminActionAccess(GOODS_ANNOUNCEMENTS_PATH)) return { error: '관리자 권한이 필요합니다.' };
  if (typeof query !== 'string' || query.length > 100 || !Number.isSafeInteger(page) || page < 1 || page > 100000) return { error: '검색어를 100자 안으로 줄여 다시 찾아 주세요.' };
  try { return { data: await searchGoodsForAnnouncement(query.trim(), page) }; }
  catch (error) { unstable_rethrow(error); return { error: '상품을 불러오지 못했습니다. 잠시 뒤 다시 찾아 주세요.' }; }
}
