'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import {
  normalizeAdminCurationForm,
  type AdminCurationActionState,
} from '@/lib/admin/curations';
import { getCurrentAdminAuthState } from '@/lib/auth/admin';
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
    }));
  } catch {
    return { errors: { form: SAVE_ERROR } };
  }
  if (error) return { errors: { form: SAVE_ERROR } };

  revalidatePath('/');
  revalidatePath('/admin');
  return { message: '홈 큐레이션을 저장했습니다.' };
}
