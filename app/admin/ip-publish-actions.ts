'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { getCurrentAdminAuthState } from '@/lib/auth/admin';
import { createClient } from '@/lib/supabase/server';

/*
 * IP 게시 상태 토글 — 폼 옆의 "공개로 전환 / 초안으로 되돌리기" (20260907130000).
 *
 * 폼 저장(admin_upsert_ip 의 target_publish)과 달리 필드를 다시 보내지 않고 상태만 바꾼다.
 * archive-actions.ts 와 같은 모양이다: 입력 정규화 → staff 확인 → audited RPC → 공개
 * 표면 revalidate. RPC 가 staff 를 다시 검사하고 보관된 IP 는 거절한다.
 */

export interface AdminIpPublishActionState {
  errors?: {
    id?: string;
    form?: string;
  };
  message?: string;
  changed?: boolean;
}

const CATALOG_ID_PATTERN = /^[a-z0-9][a-z0-9-]*$/;
const CONFIG_ERROR = 'Supabase 환경변수를 설정한 뒤 IP 게시 상태를 변경할 수 있습니다.';
const RETRY_ERROR = 'IP 게시 상태를 변경하지 못했습니다. 다시 시도해주세요.';
const STALE_ERROR = 'IP 게시 상태를 변경하지 못했습니다. 최신 상태를 확인해주세요.';

const RPC_GUARD_MESSAGES: ReadonlyArray<readonly [string, string]> = [
  ['catalog_not_found', 'IP를 찾을 수 없습니다. 목록을 새로고침한 뒤 다시 시도해주세요.'],
  ['catalog_item_archived', '보관된 IP는 게시 상태를 바꿀 수 없습니다. 먼저 복원해주세요.'],
  ['ip_publish_incomplete', 'IP 이름을 채운 뒤 공개해주세요.'],
];

function loginPath() {
  return `/login?next=${encodeURIComponent('/admin')}`;
}

function normalizePublishForm(formData: FormData):
  | { ok: true; id: string }
  | { ok: false; errors: NonNullable<AdminIpPublishActionState['errors']> } {
  const rawId = formData.get('id');
  const id = typeof rawId === 'string' ? rawId.trim() : '';

  if (!CATALOG_ID_PATTERN.test(id)) {
    return { ok: false, errors: { id: '올바른 IP ID가 필요합니다.' } };
  }
  return { ok: true, id };
}

function publishRpcError(error: { code?: unknown; message?: unknown }) {
  const code = typeof error.code === 'string' ? error.code.toLowerCase() : '';
  const message = typeof error.message === 'string' ? error.message.toLowerCase() : '';
  const descriptor = `${code} ${message}`;

  for (const [token, userMessage] of RPC_GUARD_MESSAGES) {
    if (descriptor.includes(token)) return userMessage;
  }
  if (
    code === '42501'
    || code === '28000'
    || descriptor.includes('forbidden')
    || descriptor.includes('auth_required')
    || descriptor.includes('account_suspended')
  ) {
    return '관리자 권한이 필요합니다.';
  }
  return STALE_ERROR;
}

/* 게시 전환은 보관과 같은 공개 표면을 바꾼다 — archive-actions 의 IP 경로와 같은 목록. */
function revalidateIpPublishSurfaces(id: string) {
  for (const path of [
    '/',
    '/ip',
    '/shop',
    '/binder',
    '/events',
    '/offline-popups',
    '/search',
    '/cart',
    '/checkout',
    '/packs',
    '/admin',
  ]) {
    revalidatePath(path);
  }
  revalidatePath('/ip/[id]', 'page');
  revalidatePath('/events/[eventId]', 'page');
  revalidatePath('/offline-popups/[eventId]', 'page');
  revalidatePath('/games/[gameId]', 'page');
  revalidatePath(`/ip/${id}`);
}

async function updateAdminIpPublishState(
  published: boolean,
  formData: FormData,
): Promise<AdminIpPublishActionState> {
  const normalized = normalizePublishForm(formData);
  if (!normalized.ok) return { errors: normalized.errors };

  let auth: Awaited<ReturnType<typeof getCurrentAdminAuthState>>;
  try {
    auth = await getCurrentAdminAuthState();
  } catch {
    return { errors: { form: RETRY_ERROR } };
  }
  if (!auth.isConfigured) return { errors: { form: CONFIG_ERROR } };
  if (!auth.user) redirect(loginPath());
  if (!auth.isStaff) return { errors: { form: '관리자 권한이 필요합니다.' } };

  let data: unknown;
  let error: { code?: unknown; message?: unknown } | null;
  try {
    const supabase = await createClient();
    ({ data, error } = await supabase.rpc('admin_set_ip_published', {
      target_id: normalized.id,
      target_published: published,
    }));
  } catch {
    return { errors: { form: RETRY_ERROR } };
  }
  if (error) return { errors: { form: publishRpcError(error) } };

  revalidateIpPublishSurfaces(normalized.id);
  return {
    message: published
      ? 'IP를 공개로 전환했습니다.'
      : 'IP를 초안으로 되돌렸습니다.',
    changed: data === true,
  };
}

export async function publishAdminIpAction(
  _state: AdminIpPublishActionState,
  formData: FormData,
): Promise<AdminIpPublishActionState> {
  return updateAdminIpPublishState(true, formData);
}

export async function unpublishAdminIpAction(
  _state: AdminIpPublishActionState,
  formData: FormData,
): Promise<AdminIpPublishActionState> {
  if (formData.get('confirmUnpublish') !== 'yes') {
    return { errors: { form: '초안 전환의 영향을 확인한 뒤 다시 시도해주세요.' } };
  }
  return updateAdminIpPublishState(false, formData);
}
