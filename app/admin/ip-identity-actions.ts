'use server';

import { revalidatePath } from 'next/cache';
import { redirect, unstable_rethrow } from 'next/navigation';
import { getCurrentAdminAuthState } from '@/lib/auth/admin';
import {
  withPreservedFormValues,
  type AdminFormValuesState,
} from '@/lib/admin/form-state';
import { ipWorkspaceHref } from '@/lib/admin/ip-workspace';
import { normalizeIpPublicSlug, validateIpPublicSlug } from '@/lib/ip-identity';
import { createClient } from '@/lib/supabase/server';

export interface AdminIpIdentityActionState extends AdminFormValuesState {
  errors?: {
    id?: string;
    publicSlug?: string;
    form?: string;
  };
  message?: string;
  changed?: boolean;
}

const INTERNAL_ID_PATTERN = /^[a-z0-9][a-z0-9-]*$/;
const CONFIG_ERROR = 'Supabase 환경변수를 설정한 뒤 IP 공개 URL을 변경할 수 있습니다.';
const RETRY_ERROR = 'IP 공개 URL을 저장하지 못했습니다. 다시 시도해주세요.';
const STALE_ERROR = '다른 운영자가 IP 공개 URL을 변경했습니다. 최신 내용을 확인한 뒤 다시 시도해주세요.';

function loginPath(id: string) {
  return `/login?next=${encodeURIComponent(ipWorkspaceHref(id))}`;
}

function fail(
  state: AdminIpIdentityActionState | null | undefined,
  formData: FormData,
  errors: NonNullable<AdminIpIdentityActionState['errors']>,
) {
  return withPreservedFormValues({ errors }, state, formData);
}

function normalizeIdentityForm(formData: FormData):
  | { ok: true; id: string; publicSlug: string; expectedPublicSlug: string }
  | { ok: false; errors: NonNullable<AdminIpIdentityActionState['errors']> } {
  const id = typeof formData.get('id') === 'string' ? String(formData.get('id')).trim() : '';
  const publicSlug = normalizeIpPublicSlug(formData.get('publicSlug'));
  const expectedPublicSlug = normalizeIpPublicSlug(formData.get('expectedPublicSlug'));
  const errors: NonNullable<AdminIpIdentityActionState['errors']> = {};

  if (!INTERNAL_ID_PATTERN.test(id)) errors.id = '올바른 내부 IP ID가 필요합니다.';
  const slugError = validateIpPublicSlug(publicSlug);
  if (slugError === 'required') errors.publicSlug = '공개 URL을 입력해주세요.';
  if (slugError === 'format') errors.publicSlug = '공개 URL은 영문 소문자·숫자·하이픈만 사용할 수 있습니다.';
  if (slugError === 'reserved') errors.publicSlug = '이 공개 URL은 시스템 경로로 예약되어 있습니다.';
  /* expectedPublicSlug is a concurrency token, not a newly chosen slug. Keep
     legacy values (long, trailing-hyphen, or now-reserved) usable so an old
     IP can still be renamed to a valid current slug. */
  if (!expectedPublicSlug) errors.form = '현재 공개 URL을 확인하지 못했습니다. 새로고침 후 다시 시도해주세요.';

  return Object.keys(errors).length
    ? { ok: false, errors }
    : { ok: true, id, publicSlug, expectedPublicSlug };
}

function identityRpcError(error: { code?: unknown; message?: unknown }) {
  const code = typeof error.code === 'string' ? error.code.toLowerCase() : '';
  const message = typeof error.message === 'string' ? error.message.toLowerCase() : '';
  const descriptor = `${code} ${message}`;

  if (descriptor.includes('ip_public_slug_taken') || descriptor.includes('public_slug_taken')) {
    return '이미 사용 중인 공개 URL입니다. 다른 슬러그를 입력해주세요.';
  }
  if (descriptor.includes('ip_public_slug_conflict') || descriptor.includes('public_slug_conflict')) return STALE_ERROR;
  if (descriptor.includes('catalog_not_found') || descriptor.includes('ip_not_found')) {
    return 'IP를 찾을 수 없습니다. 목록을 새로고침한 뒤 다시 시도해주세요.';
  }
  if (
    code === '42501'
    || code === '28000'
    || descriptor.includes('forbidden')
    || descriptor.includes('auth_required')
    || descriptor.includes('account_suspended')
  ) return '관리자 권한이 필요합니다.';
  return STALE_ERROR;
}

function revalidateIpIdentitySurfaces(id: string, previousSlug: string, nextSlug: string) {
  for (const path of ['/', '/ip', '/shop', '/search', '/admin', '/admin/catalog/ips']) revalidatePath(path);
  revalidatePath('/ip/[id]', 'page');
  revalidatePath(`/ip/${id}`);
  if (previousSlug) revalidatePath(`/ip/${previousSlug}`);
  if (nextSlug) revalidatePath(`/ip/${nextSlug}`);
  revalidatePath(ipWorkspaceHref(id));
}

export async function updateAdminIpIdentityAction(
  state: AdminIpIdentityActionState,
  formData: FormData,
): Promise<AdminIpIdentityActionState> {
  const normalized = normalizeIdentityForm(formData);
  if (!normalized.ok) return fail(state, formData, normalized.errors);

  let auth: Awaited<ReturnType<typeof getCurrentAdminAuthState>>;
  try {
    auth = await getCurrentAdminAuthState();
  } catch (error) {
    unstable_rethrow(error);
    return fail(state, formData, { form: RETRY_ERROR });
  }
  if (!auth.isConfigured) return fail(state, formData, { form: CONFIG_ERROR });
  if (!auth.user) redirect(loginPath(normalized.id));
  if (!auth.isStaff) return fail(state, formData, { form: '관리자 권한이 필요합니다.' });

  let data: unknown;
  let error: { code?: unknown; message?: unknown } | null;
  try {
    const supabase = await createClient();
    ({ data, error } = await supabase.rpc('admin_update_ip_identity', {
      target_id: normalized.id,
      target_public_slug: normalized.publicSlug,
      target_expected_public_slug: normalized.expectedPublicSlug,
    }));
  } catch (caught) {
    unstable_rethrow(caught);
    return fail(state, formData, { form: RETRY_ERROR });
  }

  if (error) return fail(state, formData, { form: identityRpcError(error) });

  revalidateIpIdentitySurfaces(normalized.id, normalized.expectedPublicSlug, normalized.publicSlug);
  return {
    message: 'IP 공개 URL을 저장했습니다. 이전 URL은 별칭으로 유지됩니다.',
    changed: data !== false,
  };
}
