'use server';

import { adminGoodsCopy } from '@/lib/admin/vocabulary';
import { revalidateGoodsSurfaces } from '@/lib/admin/revalidate-goods.server';
import { revalidatePath } from 'next/cache';
import { unstable_rethrow } from 'next/navigation';
import { requireAdminActionAccess } from '@/lib/admin/action-access.server';
import { createClient } from '@/lib/supabase/server';

/* 카드 보관은 2026-11-24 일반 쇼핑몰 전환으로 카드 화면과 함께 지웠다(ADR-0052, DB 함수는 보존). */
export type AdminCatalogArchiveKind = 'ip' | 'good' | 'event';
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
    event: 'admin_archive_event',
  },
  unarchive: {
    ip: 'admin_unarchive_ip',
    good: 'admin_unarchive_good',
    event: 'admin_unarchive_event',
  },
};

const ARCHIVE_KINDS = new Set<AdminCatalogArchiveKind>(['ip', 'good', 'event']);
const CATALOG_ID_PATTERN = /^[a-z0-9][a-z0-9-]*$/;
const RETRY_ERROR = '카탈로그 보관 상태를 변경하지 못했습니다. 다시 시도해주세요.';
const STALE_ERROR = '카탈로그 보관 상태를 변경하지 못했습니다. 최신 상태를 확인해주세요.';

const RPC_GUARD_MESSAGES: ReadonlyArray<readonly [string, string]> = [
  ['catalog_not_found', '카탈로그 항목을 찾을 수 없습니다.'],
  ['ip_has_active_children', adminGoodsCopy('운영 중인 하위 굿즈·이벤트를 먼저 보관해주세요. 그래도 보관되지 않으면 예전 카드 기록이 남아 있는 것이니 개발팀에 정리를 요청해주세요.')],
  ['ip_has_active_operations', '예전 카드풀·카드팩 발급 정책·게임 기록이 아직 운영 중으로 남아 있습니다. 개발팀에 정리를 요청해주세요.'],
  ['good_has_stock', adminGoodsCopy('판매 가능한 재고가 남아 있어 굿즈를 보관할 수 없습니다.')],
  ['good_has_active_policy', adminGoodsCopy('예전 카드팩 발급 정책에 연결된 굿즈는 보관할 수 없습니다. 개발팀에 정책 정리를 요청해주세요.')],
  ['event_has_open_ticketing', '진행 중인 예매가 있는 이벤트는 보관할 수 없습니다.'],
  ['event_has_open_game', '예전 게임 기록이 아직 운영 중으로 연결된 이벤트는 보관할 수 없습니다. 개발팀에 정리를 요청해주세요.'],
  ['parent_archived', '상위 IP를 먼저 복원해주세요.'],
];

function normalizeArchiveForm(formData: FormData):
  | { ok: true; kind: AdminCatalogArchiveKind; id: string }
  | { ok: false; errors: NonNullable<AdminCatalogArchiveActionState['errors']> } {
  const errors: NonNullable<AdminCatalogArchiveActionState['errors']> = {};
  const rawKind = formData.get('kind');
  const kind = typeof rawKind === 'string' ? rawKind.trim() : '';
  const rawId = formData.get('id');
  const id = typeof rawId === 'string' ? rawId.trim() : '';

  if (!ARCHIVE_KINDS.has(kind as AdminCatalogArchiveKind)) {
    errors.kind = '보관할 항목의 종류를 확인하지 못했습니다. 목록을 새로고침한 뒤 다시 시도해주세요.';
  }
  if (!CATALOG_ID_PATTERN.test(id)) {
    errors.id = '보관할 항목을 확인하지 못했습니다. 목록을 새로고침한 뒤 다시 시도해주세요.';
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
  revalidateGoodsSurfaces();
  for (const path of ['/events', '/offline-popups']) revalidatePath(path);
  revalidatePath('/offline-popups/[eventId]', 'page');
  if (kind === 'ip') {
    revalidatePath(`/ip/${id}`);
    revalidatePath('/admin/catalog/ips');
    revalidatePath(`/admin/catalog/ips/${id}`);
  }
}

async function updateAdminCatalogArchiveState(
  operation: AdminCatalogArchiveOperation,
  formData: FormData,
): Promise<AdminCatalogArchiveActionState> {
  const normalized = normalizeArchiveForm(formData);
  if (!normalized.ok) return { errors: normalized.errors };

  let access: Awaited<ReturnType<typeof requireAdminActionAccess>>;
  try {
    access = await requireAdminActionAccess('/admin', { capability: normalized.kind === 'good' ? 'catalog.manage' : 'platform.manage' });
  } catch (error) {
    unstable_rethrow(error);
    return { errors: { form: RETRY_ERROR } };
  }
  if (!access) return { errors: { form: '관리자 권한이 필요합니다.' } };

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
