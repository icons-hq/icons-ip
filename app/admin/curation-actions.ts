'use server';

import { revalidatePath, updateTag } from 'next/cache';
import { redirect } from 'next/navigation';
import {
  normalizeAdminCurationForm,
  type AdminCurationActionState,
} from '@/lib/admin/curations';
import { getCurrentAdminAuthState } from '@/lib/auth/admin';
import { NOTICE_STRIP_CACHE_TAG } from '@/lib/notice-strip.server';
import { createClient } from '@/lib/supabase/server';

const SAVE_ERROR = '홈 큐레이션을 저장하지 못했습니다. 다시 시도해주세요.';

function loginPath() {
  return `/login?next=${encodeURIComponent('/admin')}`;
}

export async function upsertAdminCurationAction(
  _state: AdminCurationActionState,
  formData: FormData,
): Promise<AdminCurationActionState> {
  const normalized = normalizeAdminCurationForm(formData);
  if (!normalized.ok) return { errors: normalized.errors };

  let auth: Awaited<ReturnType<typeof getCurrentAdminAuthState>>;
  try {
    auth = await getCurrentAdminAuthState();
  } catch {
    return { errors: { form: SAVE_ERROR } };
  }
  if (!auth.isConfigured) return { errors: { form: SAVE_ERROR } };
  if (!auth.user) redirect(loginPath());
  if (!auth.isStaff) return { errors: { form: '관리자 권한이 필요합니다.' } };

  const value = normalized.value;
  let error: unknown;
  try {
    const supabase = await createClient();
    ({ error } = await supabase.rpc('admin_upsert_home_curation', {
      target_operation_id: value.operationId,
      target_curation_id: value.id,
      target_kind: value.kind,
      target_ip_id: value.ipId,
      target_title: value.title,
      target_image_path: value.imagePath,
      target_link_path: value.linkPath,
      target_display_order: value.displayOrder,
      target_active_from: value.activeFrom,
      target_active_to: value.activeTo,
      target_enabled: value.enabled,
      target_slot: value.slot,
      target_payload: value.payload,
    }));
  } catch {
    return { errors: { form: SAVE_ERROR } };
  }
  if (error) return { errors: { form: SAVE_ERROR } };

  revalidatePath('/');
  revalidatePath('/admin');
  /*
   * 공지 스트립은 전역 셸이 unstable_cache 로 읽는다 — 경로 재검증만으로는 늦는다.
   * Next 16 의 revalidateTag 는 cacheLife 프로필을 요구하고 'max' 는 stale-while-
   * revalidate 라 저장한 운영자가 옛 스트립을 한 번 더 본다. 서버 액션 전용
   * updateTag 가 즉시 만료(read-your-own-writes)라서 이쪽을 쓴다.
   */
  updateTag(NOTICE_STRIP_CACHE_TAG);
  return { message: '홈 큐레이션을 저장했습니다.' };
}
