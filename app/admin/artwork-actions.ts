'use server';

import { redirect } from 'next/navigation';
import {
  buildAdminArtworkPath,
  normalizeAdminArtworkMetadata,
  parseAdminArtworkPath,
} from '@/lib/admin/artwork';
import {
  cancelAdminArtworkUpload,
  cleanupExpiredAdminArtworkUploads,
  createAdminArtworkUploadClaim,
  rejectAdminArtworkUpload,
  verifyAndPromoteAdminArtwork,
} from '@/lib/admin/artwork.server';
import { hasAdminCapability } from '@/lib/admin/access';
import { getCurrentAdminAuthState } from '@/lib/auth/admin';

export interface PrepareAdminArtworkUploadInput {
  kind: unknown;
  mimeType: unknown;
  size: unknown;
  /** Optional for existing callers; bound workflows must keep the starting actor. */
  expectedActorId?: unknown;
}

export type PrepareAdminArtworkUploadResult =
  | { ok: true; path: string }
  | { ok: false; error: string };

export interface VerifyAdminArtworkUploadInput extends PrepareAdminArtworkUploadInput {
  path: unknown;
}

export interface CancelAdminArtworkUploadInput {
  path: unknown;
}

export type VerifyAdminArtworkUploadResult =
  | { ok: true; imagePath: string }
  | { ok: false; error: string };

const ADMIN_PERMISSION_ERROR = '관리자 권한이 필요합니다.';
const ADMIN_ARTWORK_ACTOR_CHANGED_ERROR =
  '로그인 계정이 변경되었습니다. 현재 계정에서 다시 시도해주세요.';
const ADMIN_ARTWORK_PREPARE_ERROR =
  '이미지 업로드를 준비하지 못했습니다. 다시 시도해주세요.';
const ADMIN_ARTWORK_VERIFY_ERROR =
  '이미지 파일을 확인하지 못했습니다. 다시 업로드해주세요.';

function adminLoginPath() {
  return `/login?next=${encodeURIComponent('/admin')}`;
}

export async function cancelAdminArtworkUploadAction(
  input: CancelAdminArtworkUploadInput,
): Promise<void> {
  const parsedPath = parseAdminArtworkPath(input.path);
  if (!parsedPath) return;

  let auth: Awaited<ReturnType<typeof getCurrentAdminAuthState>>;
  try {
    auth = await getCurrentAdminAuthState();
  } catch {
    return;
  }

  if (!auth.user) return;
  await cancelAdminArtworkUpload({
    actorId: auth.user.id,
    path: parsedPath.path,
  });
}

export async function prepareAdminArtworkUploadAction(
  input: PrepareAdminArtworkUploadInput,
): Promise<PrepareAdminArtworkUploadResult> {
  const metadata = normalizeAdminArtworkMetadata(input);
  if (!metadata.ok) return metadata;

  let auth: Awaited<ReturnType<typeof getCurrentAdminAuthState>>;
  try {
    auth = await getCurrentAdminAuthState();
  } catch {
    return { ok: false, error: ADMIN_ARTWORK_PREPARE_ERROR };
  }

  if (input.expectedActorId !== undefined && input.expectedActorId !== auth.user?.id) {
    return { ok: false, error: ADMIN_ARTWORK_ACTOR_CHANGED_ERROR };
  }
  if (!auth.user) redirect(adminLoginPath());
  if (!auth.isStaff || !hasAdminCapability(auth, metadata.value.kind === 'good' ? 'catalog.manage' : metadata.value.kind === 'curation' ? 'store.manage' : 'platform.manage')) return { ok: false, error: ADMIN_PERMISSION_ERROR };

  let claimedPath: string | null = null;
  try {
    const path = buildAdminArtworkPath({
      kind: metadata.value.kind,
      mimeType: metadata.value.mimeType,
      nonce: crypto.randomUUID(),
    });
    const claimed = await createAdminArtworkUploadClaim({
      actorId: auth.user.id,
      kind: metadata.value.kind,
      mimeType: metadata.value.mimeType,
      path,
      size: metadata.value.size,
    });
    if (!claimed) return { ok: false, error: ADMIN_ARTWORK_PREPARE_ERROR };
    claimedPath = path;
    await cleanupExpiredAdminArtworkUploads(5);
    return { ok: true, path };
  } catch {
    if (claimedPath) {
      await rejectAdminArtworkUpload({ actorId: auth.user.id, path: claimedPath });
    }
    return { ok: false, error: ADMIN_ARTWORK_PREPARE_ERROR };
  }
}

export async function verifyAdminArtworkUploadAction(
  input: VerifyAdminArtworkUploadInput,
): Promise<VerifyAdminArtworkUploadResult> {
  const metadata = normalizeAdminArtworkMetadata(input);
  const parsedPath = parseAdminArtworkPath(input.path);
  if (
    !metadata.ok
    || !parsedPath
    || parsedPath.kind !== metadata.value.kind
    || parsedPath.mimeType !== metadata.value.mimeType
  ) {
    return { ok: false, error: ADMIN_ARTWORK_VERIFY_ERROR };
  }

  let auth: Awaited<ReturnType<typeof getCurrentAdminAuthState>>;
  try {
    auth = await getCurrentAdminAuthState();
  } catch {
    return { ok: false, error: ADMIN_ARTWORK_VERIFY_ERROR };
  }

  if (input.expectedActorId !== undefined && input.expectedActorId !== auth.user?.id) {
    return { ok: false, error: ADMIN_ARTWORK_ACTOR_CHANGED_ERROR };
  }
  if (!auth.user) redirect(adminLoginPath());
  if (!auth.isStaff || !hasAdminCapability(auth, metadata.value.kind === 'good' ? 'catalog.manage' : metadata.value.kind === 'curation' ? 'store.manage' : 'platform.manage')) return { ok: false, error: ADMIN_PERMISSION_ERROR };

  try {
    const result = await verifyAndPromoteAdminArtwork({
      actorId: auth.user.id,
      kind: metadata.value.kind,
      mimeType: metadata.value.mimeType,
      path: parsedPath.path,
      size: metadata.value.size,
    });
    return result ? { ok: true, imagePath: result.imagePath } : {
      ok: false,
      error: ADMIN_ARTWORK_VERIFY_ERROR,
    };
  } catch {
    return { ok: false, error: ADMIN_ARTWORK_VERIFY_ERROR };
  }
}
