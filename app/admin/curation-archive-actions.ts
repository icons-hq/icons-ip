'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { hasAdminCapability } from '@/lib/admin/access';
import { ARCHIVED_HERO_PAGE_SIZE, parseCurationArchiveRequest, type ArchivedHeroPage } from '@/lib/admin/curation-archive';
import type { AdminCurationActionState } from '@/lib/admin/curations';
import { getCurrentAdminAuthState } from '@/lib/auth/admin';
import { normalizePublicMediaPath } from '@/lib/media';
import { createClient } from '@/lib/supabase/server';

const FORBIDDEN = '현재 스토어 관리 권한을 확인해주세요.';
const FAILED = '배너 요청을 처리하지 못했습니다. 다시 확인해주세요.';

async function authorized() {
  let auth: Awaited<ReturnType<typeof getCurrentAdminAuthState>>;
  try { auth = await getCurrentAdminAuthState(); } catch { return false; }
  if (!auth.isConfigured) return false;
  if (!auth.user) redirect(`/login?next=${encodeURIComponent('/admin/display/curations')}`);
  return auth.isStaff && hasAdminCapability(auth, 'store.manage');
}

export async function readArchivedHeroBannersAction(page: number): Promise<{ page?: ArchivedHeroPage; error?: string }> {
  if (!Number.isSafeInteger(page) || page < 1 || page > 100_000) return { error: '조회할 페이지를 확인해주세요.' };
  if (!await authorized()) return { error: FORBIDDEN };
  try {
    const supabase = await createClient();
    const { data, error, count } = await supabase.from('home_curations')
      .select('id,title,image_path,archived_at,updated_at', { count: 'exact' })
      .eq('kind', 'hero').not('archived_at', 'is', null)
      .order('archived_at', { ascending: false }).order('id', { ascending: false })
      .range((page - 1) * ARCHIVED_HERO_PAGE_SIZE, page * ARCHIVED_HERO_PAGE_SIZE - 1);
    if (error || !Array.isArray(data) || typeof count !== 'number') return { error: '삭제한 배너를 불러오지 못했습니다.' };
    return { page: { page, total: count, rows: data.map(row => ({
      id: row.id, title: row.title, archivedAt: row.archived_at, updatedAt: row.updated_at,
      imageUrl: row.image_path ? supabase.storage.from('public-media').getPublicUrl(normalizePublicMediaPath(row.image_path)).data.publicUrl : null,
    })) } };
  } catch { return { error: '삭제한 배너를 불러오지 못했습니다.' }; }
}

export async function setHeroBannerArchivedAction(form: FormData): Promise<AdminCurationActionState> {
  const value = parseCurationArchiveRequest(form);
  if (!value) return { errors: { form: '배너와 저장본 정보를 확인하지 못했습니다. 최신 목록을 불러와 주세요.' } };
  if (!await authorized()) return { errors: { form: FORBIDDEN } };
  let error: unknown;
  let data: unknown;
  try {
    const supabase = await createClient();
    ({ error, data } = await supabase.rpc('admin_set_home_banner_archived', {
      target_operation_id: value.operationId, target_curation_id: value.id,
      target_expected_updated_at: value.expectedUpdatedAt, archive_requested: value.archive,
    }));
  } catch { return { errors: { form: '처리 결과를 확인하지 못했습니다. 같은 요청 결과를 확인해주세요.' }, uncertain: true }; }
  if (error) {
    const message = typeof error === 'object' && error !== null && 'message' in error ? String(error.message) : '';
    if (/curation_conflict|operation_conflict/.test(message)) return { errors: { form: '다른 변경이 먼저 반영되었습니다. 최신 저장본을 불러와 다시 확인해주세요.' }, conflict: true };
    if (message.includes('home_hero_limit')) return { errors: { form: '등록된 배너가 10개여서 복구할 수 없습니다. 기존 배너를 삭제한 뒤 다시 복구해주세요.' } };
    if (/forbidden|auth_required|operator_/.test(message)) return { errors: { form: FORBIDDEN } };
    if (/invalid_|curation_not_found|curation_archive_state|curation_archive_hero_only/.test(message)) return { errors: { form: FAILED } };
    return { errors: { form: '처리 결과를 확인하지 못했습니다. 같은 요청 결과를 확인해주세요.' }, uncertain: true };
  }
  if (data !== value.id) return { errors: { form: '처리 결과를 확인하지 못했습니다. 같은 요청 결과를 확인해주세요.' }, uncertain: true };
  revalidatePath('/');
  revalidatePath('/admin');
  revalidatePath('/admin/display/curations');
  return { message: value.archive ? '배너 삭제 요청을 처리했습니다. 현재 목록을 확인해주세요.' : '배너 복구 요청을 처리했습니다. 현재 목록과 노출 설정을 확인해주세요.' };
}
