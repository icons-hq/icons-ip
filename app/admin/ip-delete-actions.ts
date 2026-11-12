'use server';

import { revalidatePath } from 'next/cache';
import { redirect, RedirectType, unstable_rethrow } from 'next/navigation';
import { requireAdminActionAccess } from '@/lib/admin/action-access.server';
import { ipDraftDeleteErrorMessage } from '@/lib/admin/ip-delete';
import { IP_INDEX_PATH, ipWorkspaceHref } from '@/lib/admin/ip-workspace';
import { createClient } from '@/lib/supabase/server';

export interface AdminIpDeleteActionState {
  errors?: { form?: string };
}

const INTERNAL_ID_PATTERN = /^[a-z0-9][a-z0-9-]*$/;
const RETRY_ERROR = 'IP를 삭제하지 못했습니다. 잠시 후 다시 시도해주세요.';
const ADMIN_ONLY_ERROR = '미사용 IP 삭제는 통합 매니저·계정 주매니저(권한 전환 전에는 기존 관리자)만 할 수 있습니다.';

/*
 * 미사용 IP 초안 삭제(S36-004 · ADR-0039). 되돌릴 수 없는 물리 삭제라 화면 권한도 legacy admin·platform.manage만 연다.
 * 공개 이력·참조 0건 판정, 행 잠금, 삭제 행 스냅샷 감사, 내부 ID 퇴역은 DB(admin_delete_draft_ip)가 한 transaction에서 한다.
 * 지운 뒤에는 그 IP 상세가 없으므로 IP 목록으로 돌아가 결과를 알린다.
 */
export async function deleteAdminDraftIpAction(
  _state: AdminIpDeleteActionState,
  formData: FormData,
): Promise<AdminIpDeleteActionState> {
  const raw = formData.get('id');
  const id = typeof raw === 'string' ? raw.trim() : '';
  if (!INTERNAL_ID_PATTERN.test(id)) return { errors: { form: 'IP를 확인하지 못했습니다. 새로고침한 뒤 다시 시도해주세요.' } };

  let auth: Awaited<ReturnType<typeof requireAdminActionAccess>>;
  try {
    auth = await requireAdminActionAccess(ipWorkspaceHref(id), { capability: 'platform.manage', adminOnly: true });
  } catch (error) {
    unstable_rethrow(error);
    return { errors: { form: RETRY_ERROR } };
  }
  if (!auth) return { errors: { form: ADMIN_ONLY_ERROR } };

  let error: { code?: unknown; message?: unknown } | null;
  try {
    const supabase = await createClient();
    ({ error } = await supabase.rpc('admin_delete_draft_ip', { target_id: id }));
  } catch (caught) {
    unstable_rethrow(caught);
    return { errors: { form: RETRY_ERROR } };
  }
  if (error) return { errors: { form: ipDraftDeleteErrorMessage(error) } };

  revalidatePath(IP_INDEX_PATH);
  revalidatePath(ipWorkspaceHref(id));
  redirect(`${IP_INDEX_PATH}?${new URLSearchParams({ deleted: id })}`, RedirectType.replace);
}
