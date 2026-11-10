'use server';
import { revalidatePath } from 'next/cache';
import { unstable_rethrow } from 'next/navigation';
import { requireAdminActionAccess } from '@/lib/admin/action-access.server';
import { createClient } from '@/lib/supabase/server';
import { isUuid } from '@/lib/uuid';
import { GOODS_ANNOUNCEMENTS_PATH, parseGoodsAnnouncementInput, type GoodsAnnouncement, type GoodsAnnouncementCandidates } from '@/lib/admin/goods-announcements';
import { loadGoodsAnnouncement, searchGoodsForAnnouncement } from '@/lib/admin/goods-announcements.server';

export interface GoodsAnnouncementActionState { errors?: Record<string, string>; message?: string; saved?: GoodsAnnouncement; savedId?: string; outcome?: 'saved' | 'rejected' | 'unknown'; reloadRequired?: boolean }
async function readSavedAnnouncement(previous: GoodsAnnouncementActionState, id: string, result: unknown): Promise<GoodsAnnouncementActionState> {
  if (!result || typeof result !== 'object' || !('id' in result) || result.id !== id || !('revision' in result)
    || !Number.isSafeInteger(result.revision) || Number(result.revision) < 1) return { saved: previous.saved, outcome: 'unknown', errors: { form: '저장 결과를 확인하지 못했습니다. 같은 요청의 결과를 다시 확인해주세요.' } };
  revalidatePath(GOODS_ANNOUNCEMENTS_PATH); revalidatePath('/shop/[goodId]', 'page'); revalidatePath('/');
  const saved = await loadGoodsAnnouncement(id);
  if (!saved) return { saved: previous.saved, savedId: id, outcome: 'saved', reloadRequired: true, message: '저장이 확인됐습니다. 최신 공지를 다시 열어주세요.' };
  return { saved, savedId: id, outcome: 'saved', message: saved.revision === result.revision
    ? '상품 공지를 저장하고 저장된 내용을 다시 확인했습니다.' : '저장이 확인됐습니다. 이후 변경된 최신 내용을 불러왔습니다.' };
}
export async function saveGoodsAnnouncementAction(previous: GoodsAnnouncementActionState, form: FormData): Promise<GoodsAnnouncementActionState> {
  const fail = (errors: Record<string, string>, outcome: 'rejected' | 'unknown' = 'rejected'): GoodsAnnouncementActionState => ({ errors, saved: previous.saved, outcome });
  const access = await requireAdminActionAccess(GOODS_ANNOUNCEMENTS_PATH);
  if (!access) return fail({ form: '관리자 권한이 필요합니다.' });
  if (form.get('accountId') !== access.user.id) return fail({ form: '로그인 계정이 바뀌었습니다. 현재 계정으로 공지 화면을 다시 열어주세요.' });
  const operationId = form.get('operationId');
  if (!isUuid(operationId)) return fail({ form: '저장 요청을 다시 준비해주세요.' });
  const parsed = parseGoodsAnnouncementInput(form);
  if (!parsed.ok) return fail(parsed.errors);
  let confirmed = false;
  try {
    const client = await createClient(); const { data, error } = await client.rpc('admin_save_goods_announcement_v2', {
      p_operation_id: operationId, p_id: parsed.id, p_expected_revision: parsed.revision, p_values: parsed.value,
      p_popup_intent: parsed.popupIntent, p_expected_popup_revision: parsed.popupRevision,
    });
    if (error) return fail({ form: error.message === 'goods_announcement_changed'
      ? '다른 저장 결과가 있습니다. 입력을 복사한 뒤 최신 공지를 다시 열어주세요.'
      : error.message === 'goods_announcement_popup_changed' ? '다른 홈 팝업 설정이 먼저 저장됐습니다. 입력을 보관하고 최신 공지를 다시 열어주세요.'
      : error.message === 'invalid_goods_announcement_goods' ? '연결 상품을 확인해주세요. 삭제되었거나 잘못된 상품이 포함되어 있습니다.'
        : '상품 공지를 저장하지 못했습니다. 입력 내용을 유지합니다. 잠시 후 다시 시도해주세요.' },
    (['22023', '23514', '23503', '23505', 'P0002', 'PT409', '42501', '28000'].includes(error.code ?? '') || ['goods_announcement_changed', 'goods_announcement_popup_changed', 'invalid_goods_announcement_goods', 'forbidden', 'unauthorized', 'operator_capability_required'].includes(error.message)) ? 'rejected' : 'unknown');
    confirmed = Boolean(data && data.id === parsed.id && Number.isSafeInteger(data.revision) && data.revision > 0);
    return await readSavedAnnouncement(previous, parsed.id, data);
  } catch (error) {
    unstable_rethrow(error);
    if (confirmed) return { saved: previous.saved, savedId: parsed.id, outcome: 'saved', reloadRequired: true, message: '저장이 확인됐지만 최신 내용을 불러오지 못했습니다. 저장된 공지를 다시 열어주세요.' };
    return fail({ form: '저장 결과가 아직 확인되지 않았습니다. 입력을 고정한 채 같은 요청의 결과를 확인해주세요.' }, 'unknown');
  }
}
export async function resolveGoodsAnnouncementSaveAction(previous: GoodsAnnouncementActionState, operationId: string, id: string, accountId: string): Promise<GoodsAnnouncementActionState> {
  const unknown = (message: string): GoodsAnnouncementActionState => ({ saved: previous.saved, outcome: 'unknown', errors: { form: message } });
  const access = await requireAdminActionAccess(GOODS_ANNOUNCEMENTS_PATH);
  if (!access) return unknown('관리자 권한을 확인하지 못했습니다. 원래 저장 요청을 유지합니다.');
  if (accountId !== access.user.id) return unknown('로그인 계정이 바뀌었습니다. 원래 저장 요청을 현재 계정으로 조회하지 않습니다.');
  if (!isUuid(operationId) || !isUuid(id)) return unknown('원래 저장 요청을 확인할 수 없습니다.');
  let confirmed = false;
  try {
    const client = await createClient();
    const { data, error } = await client.rpc('admin_get_goods_announcement_save_result', { p_operation_id: operationId });
    if (error) return unknown('결과 조회에 실패했습니다. 원래 저장 요청을 유지합니다.');
    if (data === null) return unknown('현재 등록된 결과가 없습니다. 같은 요청 다시 저장으로 재시도해주세요.');
    confirmed = Boolean(data && data.id === id && Number.isSafeInteger(data.revision) && data.revision > 0);
    return await readSavedAnnouncement(previous, id, data);
  } catch (error) {
    unstable_rethrow(error);
    if (confirmed) return { saved: previous.saved, savedId: id, outcome: 'saved', reloadRequired: true, message: '저장이 확인됐지만 최신 내용을 불러오지 못했습니다. 공지를 다시 열어주세요.' };
    return unknown('결과 조회에 실패했습니다. 원래 저장 요청을 유지합니다.');
  }
}
export async function findGoodsForAnnouncementAction(query: string, page: number): Promise<{ data: GoodsAnnouncementCandidates } | { error: string }> {
  if (!await requireAdminActionAccess(GOODS_ANNOUNCEMENTS_PATH)) return { error: '관리자 권한이 필요합니다.' };
  if (typeof query !== 'string' || query.length > 100 || !Number.isSafeInteger(page) || page < 1 || page > 100000) return { error: '검색 조건을 확인해주세요.' };
  try { return { data: await searchGoodsForAnnouncement(query.trim(), page) }; }
  catch (error) { unstable_rethrow(error); return { error: '상품을 불러오지 못했습니다. 잠시 후 다시 시도해주세요.' }; }
}
