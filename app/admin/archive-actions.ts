'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { getCurrentAdminAuthState } from '@/lib/auth/admin';
import { createClient } from '@/lib/supabase/server';

export type AdminCatalogArchiveKind = 'ip' | 'good' | 'card' | 'event';
type AdminCatalogArchiveOperation = 'archive' | 'unarchive';

export interface AdminCatalogArchiveActionState {
  errors?: {
    kind?: string;
    id?: string;
    form?: string;
  };
  message?: string;
  changed?: boolean;
}

const RPC_NAMES: Record<AdminCatalogArchiveOperation, Record<AdminCatalogArchiveKind, string>> = {
  archive: {
    ip: 'admin_archive_ip',
    good: 'admin_archive_good',
    card: 'admin_archive_card',
    event: 'admin_archive_event',
  },
  unarchive: {
    ip: 'admin_unarchive_ip',
    good: 'admin_unarchive_good',
    card: 'admin_unarchive_card',
    event: 'admin_unarchive_event',
  },
};

const ARCHIVE_KINDS = new Set<AdminCatalogArchiveKind>(['ip', 'good', 'card', 'event']);
const CATALOG_ID_PATTERN = /^[a-z0-9][a-z0-9-]*$/;
const CONFIG_ERROR = 'Supabase 환경변수를 설정한 뒤 카탈로그 보관 상태를 변경할 수 있습니다.';
const RETRY_ERROR = '카탈로그 보관 상태를 변경하지 못했습니다. 다시 시도해주세요.';
const STALE_ERROR = '카탈로그 보관 상태를 변경하지 못했습니다. 최신 상태를 확인해주세요.';

const RPC_GUARD_MESSAGES: ReadonlyArray<readonly [string, string]> = [
  ['catalog_not_found', '카탈로그 항목을 찾을 수 없습니다.'],
  ['ip_has_active_children', '운영 중인 하위 굿즈·카드·이벤트를 먼저 보관해주세요.'],
  ['ip_has_active_operations', '진행 중인 카드풀·리워드·게임 운영을 먼저 종료해주세요.'],
  ['good_has_stock', '판매 가능한 재고가 남아 있어 굿즈를 보관할 수 없습니다.'],
  ['good_has_active_policy', '활성 리워드 정책에 연결된 굿즈는 보관할 수 없습니다.'],
  ['card_has_open_pool', '운영 중인 카드풀에 연결된 카드는 보관할 수 없습니다.'],
  ['card_has_open_tickets', '미개봉 카드팩에서 발급될 수 있는 카드는 보관할 수 없습니다.'],
  ['event_has_open_ticketing', '진행 중인 예매가 있는 이벤트는 보관할 수 없습니다.'],
  ['event_has_open_game', '운영 중인 게임에 연결된 이벤트는 보관할 수 없습니다.'],
  ['parent_archived', '상위 IP를 먼저 복원해주세요.'],
];

function loginPath() {
  return `/login?next=${encodeURIComponent('/admin')}`;
}

function normalizeArchiveForm(formData: FormData):
  | { ok: true; kind: AdminCatalogArchiveKind; id: string }
  | { ok: false; errors: NonNullable<AdminCatalogArchiveActionState['errors']> } {
  const errors: NonNullable<AdminCatalogArchiveActionState['errors']> = {};
  const rawKind = formData.get('kind');
  const kind = typeof rawKind === 'string' ? rawKind.trim() : '';
  const rawId = formData.get('id');
  const id = typeof rawId === 'string' ? rawId.trim() : '';

  if (!ARCHIVE_KINDS.has(kind as AdminCatalogArchiveKind)) {
    errors.kind = '지원하지 않는 카탈로그 유형입니다.';
  }
  if (!CATALOG_ID_PATTERN.test(id)) {
    errors.id = '올바른 카탈로그 ID가 필요합니다.';
  }

  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return { ok: true, kind: kind as AdminCatalogArchiveKind, id };
}

function archiveRpcError(error: { code?: unknown; message?: unknown }) {
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

function revalidateCatalogArchiveSurfaces(kind: AdminCatalogArchiveKind, id: string) {
  for (const path of [
    '/',
    '/ip',
    '/shop',
    '/binder',
    '/events',
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
  revalidatePath('/games/[gameId]', 'page');
  if (kind === 'ip') revalidatePath(`/ip/${id}`);
}

async function updateAdminCatalogArchiveState(
  operation: AdminCatalogArchiveOperation,
  formData: FormData,
): Promise<AdminCatalogArchiveActionState> {
  const normalized = normalizeArchiveForm(formData);
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

  let error: { code?: unknown; message?: unknown } | null;
  try {
    const supabase = await createClient();
    ({ error } = await supabase.rpc(RPC_NAMES[operation][normalized.kind], {
      target_id: normalized.id,
    }));
  } catch {
    return { errors: { form: RETRY_ERROR } };
  }
  if (error) return { errors: { form: archiveRpcError(error) } };

  revalidateCatalogArchiveSurfaces(normalized.kind, normalized.id);
  return {
    message: operation === 'archive'
      ? '카탈로그 항목을 보관했습니다.'
      : '카탈로그 항목을 복원했습니다.',
    changed: true,
  };
}

export async function archiveAdminCatalogRecordAction(
  _state: AdminCatalogArchiveActionState,
  formData: FormData,
): Promise<AdminCatalogArchiveActionState> {
  return updateAdminCatalogArchiveState('archive', formData);
}

export async function unarchiveAdminCatalogRecordAction(
  _state: AdminCatalogArchiveActionState,
  formData: FormData,
): Promise<AdminCatalogArchiveActionState> {
  return updateAdminCatalogArchiveState('unarchive', formData);
}

/*
 * 굿즈 무통장 토글(#256).
 *
 * 굿즈 폼(admin_upsert_good)에 넣지 않는다. 그 RPC는 고시정보 7칸을 필수로 받아서,
 * 운영 스위치 하나를 끄려고 상품 정보 전체를 다시 제출하게 만든다 — 한정 드롭
 * 직전에 정작 못 끄는 상황이 생긴다. 보관 토글과 같은 등급의 행 단위 액션이라
 * 여기에 둔다.
 */
export interface AdminGoodBankTransferActionState {
  error?: string;
  message?: string;
}

export async function setGoodBankTransferAction(
  _state: AdminGoodBankTransferActionState,
  formData: FormData,
): Promise<AdminGoodBankTransferActionState> {
  const auth = await getCurrentAdminAuthState();
  if (!auth.isConfigured || !auth.user) redirect('/login?next=%2Fadmin');
  if (!auth.isStaff) return { error: '관리자 권한이 필요합니다.' };

  const id = String(formData.get('id') ?? '').trim();
  if (!id) return { error: '굿즈를 찾을 수 없습니다.' };
  const allowed = String(formData.get('allowed') ?? '') === 'true';

  const supabase = await createClient();
  const { error } = await supabase.rpc('admin_set_good_bank_transfer', {
    target_id: id,
    target_allowed: allowed,
  });
  if (error) {
    return {
      error: error.message.includes('catalog_record_missing')
        ? '굿즈를 찾을 수 없습니다.'
        : '무통장 설정을 바꾸지 못했습니다.',
    };
  }

  revalidatePath('/admin');
  revalidatePath('/shop');
  return {
    message: allowed
      ? '이 굿즈로 무통장 입금 주문을 받습니다.'
      : '이 굿즈는 무통장 입금을 받지 않습니다. 카드 결제만 열립니다.',
  };
}
