'use server';

import { redirect } from 'next/navigation';
import { after } from 'next/server';
import {
  ADMIN_ARTWORK_BLOCK_MESSAGES,
  buildAdminArtworkPath,
  normalizeAdminArtworkMetadata,
  parseAdminArtworkPath,
} from '@/lib/admin/artwork';
import {
  cancelAdminArtworkUpload,
  cleanupExpiredAdminArtworkUploads,
  createAdminArtworkUploadClaim,
  readAdminArtworkUploadBlockReason,
  rejectAdminArtworkUpload,
} from '@/lib/admin/artwork.server';
import {
  ADMIN_ARTWORK_ACTOR_CHANGED_ERROR,
  ADMIN_PERMISSION_ERROR,
  adminArtworkCapability,
  verifyAdminArtworkUploadRequest,
  type GoodsPhotoRegistration,
} from '@/lib/admin/artwork-verify.server';
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
  library?: unknown;
}

export interface CancelAdminArtworkUploadInput {
  path: unknown;
}

export type VerifyAdminArtworkUploadResult =
  | { ok: true; imagePath: string; library?: GoodsPhotoRegistration }
  | { ok: false; error: string };

const ADMIN_ARTWORK_PREPARE_ERROR =
  '이미지 업로드를 준비하지 못했습니다. 다시 시도해주세요.';
/** 만료 claim 정리 한 번에 다룰 수. 나머지는 매일 도는 /api/cron/admin-artwork가 치운다. */
const PREPARE_CLEANUP_LIMIT = 5;

function adminLoginPath() {
  return `/login?next=${encodeURIComponent('/admin')}`;
}

/*
 * R19(MD-0030): 정리 RPC·Storage 삭제가 준비 응답을 붙잡아, 사진마다 서버 액션 대기열이 길어졌다
 * (Next는 한 화면의 서버 액션을 한 번에 하나씩 보낸다). 응답을 보낸 뒤 after()로 돌린다.
 */
function scheduleExpiredUploadCleanup() {
  try {
    after(async () => {
      try {
        await cleanupExpiredAdminArtworkUploads(PREPARE_CLEANUP_LIMIT);
      } catch {
        // 정리는 기회가 될 때만 한다. 매일 도는 정리 작업이 다시 시도한다.
      }
    });
  } catch {
    // 요청 범위 밖이면 예약하지 않는다. 매일 도는 정리 작업이 다시 시도한다.
  }
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
  if (!auth.isStaff || !hasAdminCapability(auth, adminArtworkCapability(metadata.value.kind))) return { ok: false, error: ADMIN_PERMISSION_ERROR };

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
    if (!claimed) {
      // R20: 운영자별 업로드 한도에 걸린 경우는 이유를 알려준다.
      const reason = await readAdminArtworkUploadBlockReason({ actorId: auth.user.id, stage: 'prepare' });
      return { ok: false, error: reason ? ADMIN_ARTWORK_BLOCK_MESSAGES[reason] : ADMIN_ARTWORK_PREPARE_ERROR };
    }
    claimedPath = path;
    scheduleExpiredUploadCleanup();
    return { ok: true, path };
  } catch {
    if (claimedPath) {
      await rejectAdminArtworkUpload({ actorId: auth.user.id, path: claimedPath });
    }
    return { ok: false, error: ADMIN_ARTWORK_PREPARE_ERROR };
  }
}

/**
 * 업로드 화면은 /api/admin/artwork/verify(Route Handler)로 확인한다 — 수 초 걸리는 확인이 서버 액션 대기열을
 * 막아 사진 보관함 팝업 같은 다른 액션이 기다리던 문제(R19). 이 액션은 같은 판정을 쓰는 호환 경로다.
 */
export async function verifyAdminArtworkUploadAction(
  input: VerifyAdminArtworkUploadInput,
): Promise<VerifyAdminArtworkUploadResult> {
  const outcome = await verifyAdminArtworkUploadRequest(input);
  if (!outcome.ok) {
    if ('signedOut' in outcome) redirect(adminLoginPath());
    return { ok: false, error: outcome.error };
  }
  return outcome.library
    ? { ok: true, imagePath: outcome.imagePath, library: outcome.library }
    : { ok: true, imagePath: outcome.imagePath };
}
