'use server';
import { unstable_rethrow } from 'next/navigation';
import { requireAdminActionAccess } from '@/lib/admin/action-access.server';
import { createClient } from '@/lib/supabase/server';
import { GOODS_DRAFT_PATH, goodsDraftError, parseGoodsDraft, parseGoodsDraftPage, parseGoodsDraftSummary, validGoodsDraftIdentity, validateGoodsDraftValues, type GoodsDraftIdentity } from '@/lib/admin/goods-drafts';

export async function findGoodsDraftsAction(query: string, archived: boolean, page: number) {
  if (!await requireAdminActionAccess(GOODS_DRAFT_PATH)) return { error: '관리자 권한이 필요합니다.' };
  if (typeof query !== 'string' || query.length > 100 || typeof archived !== 'boolean' || !Number.isSafeInteger(page) || page < 1 || page > 100000) return { error: '검색 조건을 확인해주세요.' };
  try {
    const client = await createClient();
    const { data, error } = await client.rpc('admin_list_goods_drafts', { p_query: query.trim(), p_archived: archived, p_page: page });
    const parsed = parseGoodsDraftPage(data);
    return !error && parsed ? { data: parsed } : { error: goodsDraftError(error?.message) };
  } catch (error) { unstable_rethrow(error); return { error: goodsDraftError() }; }
}
export async function getGoodsDraftAction(id: string) {
  if (!await requireAdminActionAccess(GOODS_DRAFT_PATH)) return { error: '관리자 권한이 필요합니다.' };
  if (!validGoodsDraftIdentity({ id, revision: 1 })) return { error: '임시저장을 다시 선택해주세요.' };
  try {
    const client = await createClient();
    const { data, error } = await client.rpc('admin_get_goods_draft', { p_id: id });
    const parsed = parseGoodsDraft(data);
    if (error || !parsed || parsed.id !== id) return { error: goodsDraftError(error?.message) };
    if (parsed.archived || parsed.completedGoodId) return { error: '삭제했거나 상품으로 등록한 임시저장입니다. 목록을 다시 조회해주세요.' };
    return { data: parsed };
  } catch (error) { unstable_rethrow(error); return { error: goodsDraftError() }; }
}
export async function saveGoodsDraftAction(identity: GoodsDraftIdentity, values: Record<string, string>) {
  if (!await requireAdminActionAccess(GOODS_DRAFT_PATH)) return { error: '관리자 권한이 필요합니다.' };
  if (!validGoodsDraftIdentity(identity, true) || !validateGoodsDraftValues(values)) return { error: '상품명을 1~100자로 입력하고 등록 중인 상품의 입력 크기(512KB)와 이미지 업로드 상태를 확인해주세요.' };
  try {
    const client = await createClient();
    const { data, error } = await client.rpc('admin_save_goods_draft', { p_id: identity.id, p_values: values, p_expected_revision: identity.revision });
    const parsed = parseGoodsDraftSummary(data);
    return !error && parsed && parsed.id === identity.id ? { data: parsed } : { error: goodsDraftError(error?.message) };
  } catch (error) { unstable_rethrow(error); return { error: goodsDraftError() }; }
}
export async function setGoodsDraftArchivedAction(identity: GoodsDraftIdentity, archived: boolean) {
  if (!await requireAdminActionAccess(GOODS_DRAFT_PATH)) return { error: '관리자 권한이 필요합니다.' };
  if (!validGoodsDraftIdentity(identity) || typeof archived !== 'boolean') return { error: '임시저장을 다시 선택해주세요.' };
  try {
    const client = await createClient();
    const { data, error } = await client.rpc('admin_set_goods_draft_archived', { p_id: identity.id, p_expected_revision: identity.revision, p_archived: archived });
    const parsed = parseGoodsDraftSummary(data);
    return !error && parsed && parsed.id === identity.id && parsed.archived === archived ? { data: parsed } : { error: goodsDraftError(error?.message) };
  } catch (error) { unstable_rethrow(error); return { error: goodsDraftError() }; }
}
