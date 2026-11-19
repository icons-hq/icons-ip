import 'server-only';

import {
  normalizeAdminArtworkMetadata,
  parseAdminArtworkPath,
  parseAdminArtworkUploadBlockReason,
  type AdminArtworkKind,
  type AdminArtworkMimeType,
  type AdminArtworkRejectDetail,
  type AdminArtworkRejection,
  type AdminArtworkUploadBlockReason,
} from './artwork';
import { inspectAdminArtworkImage } from './artwork-image.server';
import { createServiceClient } from '@/lib/supabase/service';

/*
 * 클레임 수명은 두 창으로 나뉜다.
 *
 * 여기 있는 값은 "업로드 창"이다 — prepare 로 staging 버킷 쓰기가 열린 뒤
 * 검증까지 걸리는 시간. 앱이 prepare 직후 곧바로 올리므로 짧게 둔다
 * (service_prepare_admin_artwork_upload 가 15분을 상한으로 강제한다).
 *
 * 검증에 성공하면 DB 가 만료를 "폼 작성 창"까지 연장한다
 * (20260807140003). 운영자가 6칸을 채우고 고시정보를 적는 동안 먼저 올린
 * 이미지의 클레임이 죽어 저장 트랜잭션 전체가 롤백되던 문제를 그쪽에서 닫는다.
 */
const UPLOAD_CLAIM_TTL_MS = 10 * 60 * 1000;
const PUBLIC_MEDIA_BUCKET = 'public-media';
const STAGING_BUCKET = 'admin-artwork-staging';

interface AdminArtworkClaimInput {
  actorId: string;
  kind: AdminArtworkKind;
  mimeType: AdminArtworkMimeType;
  path: string;
  size: number;
}

type NormalizedImage = Extract<Awaited<ReturnType<typeof inspectAdminArtworkImage>>, { ok: true }>['image'];

interface CleanupCandidate {
  actorId: string;
  mode: 'all' | 'staging';
  path: string;
}

function validClaimInput(input: AdminArtworkClaimInput): boolean {
  const metadata = normalizeAdminArtworkMetadata(input);
  const parsed = parseAdminArtworkPath(input.path);
  return Boolean(
    input.actorId
    && metadata.ok
    && parsed
    && parsed.kind === input.kind
    && parsed.mimeType === input.mimeType,
  );
}

function firstRpcRow(data: unknown): Record<string, unknown> | null {
  const value = Array.isArray(data) ? data[0] : data;
  return value && typeof value === 'object' ? value as Record<string, unknown> : null;
}

async function logCleanupFailure(
  service: ReturnType<typeof createServiceClient>,
  input: {
    actorId: string;
    bucket: typeof PUBLIC_MEDIA_BUCKET | typeof STAGING_BUCKET;
    path: string;
    stage: 'gc' | 'promote' | 'reject';
  },
) {
  try {
    await service.rpc('service_log_admin_artwork_cleanup_failure', {
      p_actor_id: input.actorId,
      p_bucket: input.bucket,
      p_path: input.path,
      p_stage: input.stage,
    });
  } catch {
    // Cleanup and its audit are both best-effort.
  }
}

async function removeObject(
  service: ReturnType<typeof createServiceClient>,
  input: {
    actorId: string;
    bucket: typeof PUBLIC_MEDIA_BUCKET | typeof STAGING_BUCKET;
    path: string;
    stage: 'gc' | 'promote' | 'reject';
  },
): Promise<boolean> {
  try {
    const { error } = await service.storage.from(input.bucket).remove([input.path]);
    if (!error) return true;
  } catch {
    // Safe audit fallback below.
  }

  await logCleanupFailure(service, input);
  return false;
}

async function completeCleanup(
  service: ReturnType<typeof createServiceClient>,
  input: CleanupCandidate,
): Promise<boolean> {
  try {
    const { data, error } = await service.rpc('service_complete_admin_artwork_cleanup', {
      p_actor_id: input.actorId,
      p_mode: input.mode,
      p_path: input.path,
    });
    return !error && data === true;
  } catch {
    // A later opportunistic sweep may retry an uncommitted cleanup marker.
    return false;
  }
}

async function cleanupClaimObjects(
  service: ReturnType<typeof createServiceClient>,
  input: CleanupCandidate & { stage: 'gc' | 'promote' | 'reject' },
): Promise<boolean> {
  const stagingRemoved = await removeObject(service, {
    actorId: input.actorId,
    bucket: STAGING_BUCKET,
    path: input.path,
    stage: input.stage,
  });
  const publicRemoved = input.mode === 'all'
    ? await removeObject(service, {
        actorId: input.actorId,
        bucket: PUBLIC_MEDIA_BUCKET,
        path: input.path,
        stage: input.stage,
      })
    : true;

  if (!stagingRemoved || !publicRemoved) return false;
  return completeCleanup(service, input);
}

function errorText(error: unknown) {
  if (!error) return null;
  const message = typeof error === 'object' && error && 'message' in error ? String((error as { message: unknown }).message) : String(error);
  return message.split('\n')[0].slice(0, 160);
}

async function recordRejection(
  service: ReturnType<typeof createServiceClient>,
  input: { actorId: string; path: string; rejection?: AdminArtworkRejection },
): Promise<boolean> {
  if (input.rejection) {
    try {
      const { data, error } = await service.rpc('service_reject_admin_artwork_upload', {
        p_actor_id: input.actorId,
        p_path: input.path,
        p_reason: input.rejection.reason,
        p_detail: input.rejection.detail,
      });
      if (!error) return data === true;
    } catch {
      // 사유 기록 함수가 아직 없는 DB(배포 순서)에서는 이유 없이 거절한다.
    }
  }
  try {
    const { data, error } = await service.rpc('service_reject_admin_artwork_upload', {
      p_actor_id: input.actorId,
      p_path: input.path,
    });
    return !error && data === true;
  } catch {
    return false;
  }
}

async function rejectWithClient(
  service: ReturnType<typeof createServiceClient>,
  input: { actorId: string; path: string; rejection?: AdminArtworkRejection },
) {
  if (!await recordRejection(service, input)) return;

  await cleanupClaimObjects(service, {
    actorId: input.actorId,
    path: input.path,
    mode: 'all',
    stage: 'reject',
  });
}

export async function createAdminArtworkUploadClaim(
  input: AdminArtworkClaimInput,
): Promise<boolean> {
  if (!validClaimInput(input)) return false;

  try {
    const service = createServiceClient();
    const { data, error } = await service.rpc('service_prepare_admin_artwork_upload', {
      p_actor_id: input.actorId,
      p_expires_at: new Date(Date.now() + UPLOAD_CLAIM_TTL_MS).toISOString(),
      p_kind: input.kind,
      p_mime_type: input.mimeType,
      p_path: input.path,
      p_source_size: input.size,
    });
    return !error && data === true;
  } catch {
    return false;
  }
}

/**
 * 준비(false)·확인 시작(빈 결과)이 막힌 뒤에만 부른다. 한도 때문이 아니면 null이고, 호출자는 기존 일반 오류를 쓴다.
 * 조회 자체가 실패해도 원래 실패를 가리지 않는다.
 */
export async function readAdminArtworkUploadBlockReason(input: {
  actorId: string;
  stage: 'prepare' | 'verify';
}): Promise<AdminArtworkUploadBlockReason | null> {
  if (!input.actorId) return null;
  try {
    const { data, error } = await createServiceClient().rpc('service_admin_artwork_upload_block_reason', {
      p_actor_id: input.actorId,
      p_stage: input.stage,
    });
    return error ? null : parseAdminArtworkUploadBlockReason(data);
  } catch {
    return null;
  }
}

export async function rejectAdminArtworkUpload(input: {
  actorId: string;
  path: string;
}): Promise<void> {
  if (!input.actorId || !parseAdminArtworkPath(input.path)) return;

  try {
    await rejectWithClient(createServiceClient(), input);
  } catch {
    // Rejection is best-effort after the primary operation already failed.
  }
}

export async function cancelAdminArtworkUpload(input: {
  actorId: string;
  path: string;
  /** 브라우저 → 스테이징 업로드 실패로 취소하면 그 진단 값. claim에 staging_upload_failed로 남긴다. */
  failure?: AdminArtworkRejectDetail;
}): Promise<void> {
  if (!input.actorId || !parseAdminArtworkPath(input.path)) return;

  let service: ReturnType<typeof createServiceClient>;
  try {
    service = createServiceClient();
    const { data, error } = await service.rpc('service_cancel_admin_artwork_upload', {
      p_actor_id: input.actorId,
      p_path: input.path,
    });
    if (error || data !== true) return;
  } catch {
    return;
  }
  if (input.failure) {
    try {
      // 취소로 rejected가 된 같은 claim에 처음 이유만 남긴다(service_reject 4인자는 이미 남긴 이유를 덮지 않는다).
      await service.rpc('service_reject_admin_artwork_upload', {
        p_actor_id: input.actorId,
        p_path: input.path,
        p_reason: 'staging_upload_failed',
        p_detail: input.failure,
      });
    } catch {
      // 이유 기록은 진단용이다. 취소·정리는 그대로 진행한다.
    }
  }

  await cleanupClaimObjects(service, {
    ...input,
    mode: 'all',
    stage: 'reject',
  });
}

/**
 * 확인 시작이 운영자별 한도(동시 1건·1분 한도)에 걸리면 blockedReason, 확인 단계에서 거절했으면 그 이유(rejection),
 * 확인을 시작하지 못한 그 밖의 실패는 null이다.
 */
export async function verifyAndPromoteAdminArtwork(
  input: AdminArtworkClaimInput,
): Promise<
  | { imagePath: string }
  | { blockedReason: AdminArtworkUploadBlockReason }
  | { rejection: AdminArtworkRejection }
  | null
> {
  if (!validClaimInput(input)) return null;

  let service: ReturnType<typeof createServiceClient>;
  try {
    service = createServiceClient();
    const { data, error } = await service.rpc('service_begin_admin_artwork_verification', {
      p_actor_id: input.actorId,
      p_path: input.path,
    });
    const claim = firstRpcRow(data);
    if (error) return null;
    if (!claim) {
      const blockedReason = await readAdminArtworkUploadBlockReason({ actorId: input.actorId, stage: 'verify' });
      return blockedReason ? { blockedReason } : null;
    }
    if (
      claim.kind !== input.kind
      || claim.mime_type !== input.mimeType
      || claim.source_size !== input.size
    ) {
      const rejection: AdminArtworkRejection = { reason: 'claim_mismatch', detail: { kind: String(claim.kind), mimeType: String(claim.mime_type) } };
      await rejectWithClient(service, { ...input, rejection });
      return { rejection };
    }
  } catch {
    return null;
  }

  const rejected = async (rejection: AdminArtworkRejection) => {
    await rejectWithClient(service, { ...input, rejection });
    return { rejection };
  };

  let normalized: NormalizedImage;
  try {
    const staging = service.storage.from(STAGING_BUCKET);
    const { data: info, error: infoError } = await staging.info(input.path);
    if (infoError || !info) return rejected({ reason: 'staging_missing', detail: { error: errorText(infoError) } });
    const metadata = normalizeAdminArtworkMetadata({
      kind: input.kind,
      mimeType: info.contentType,
      size: info.size,
    });
    if (!metadata.ok || metadata.value.mimeType !== input.mimeType || metadata.value.size !== input.size) {
      return rejected({
        reason: 'staging_metadata_mismatch',
        detail: { contentType: typeof info.contentType === 'string' ? info.contentType.slice(0, 80) : null, size: typeof info.size === 'number' ? info.size : null },
      });
    }
    const { data: blob, error: downloadError } = await staging.download(input.path);
    if (downloadError || !blob || typeof blob.arrayBuffer !== 'function') {
      return rejected({ reason: 'staging_download_failed', detail: { error: errorText(downloadError) } });
    }
    const inspected = await inspectAdminArtworkImage(new Uint8Array(await blob.arrayBuffer()), input.mimeType, input.kind);
    if (!inspected.ok) return rejected({ reason: inspected.reason, detail: inspected.detail });
    normalized = inspected.image;
  } catch (error) {
    return rejected({ reason: 'unexpected_error', detail: { stage: 'inspect', error: errorText(error) } });
  }

  try {
    const { error: uploadError } = await service.storage
      .from(PUBLIC_MEDIA_BUCKET)
      .upload(input.path, normalized.bytes, {
        contentType: input.mimeType,
        upsert: false,
      });
    if (uploadError) {
      return rejected({ reason: 'public_upload_failed', detail: { error: errorText(uploadError), size: normalized.bytes.byteLength } });
    }

    const { data: verified, error: verifyError } = await service.rpc(
      'service_verify_admin_artwork_upload',
      {
        p_actor_id: input.actorId,
        p_final_size: normalized.bytes.byteLength,
        p_final_width: normalized.width,
        p_final_height: normalized.height,
        p_path: input.path,
      },
    );
    if (verifyError || verified !== true) {
      return rejected({
        reason: 'verify_rejected',
        detail: { error: errorText(verifyError), size: normalized.bytes.byteLength, width: normalized.width, height: normalized.height },
      });
    }
  } catch (error) {
    return rejected({ reason: 'unexpected_error', detail: { stage: 'promote', error: errorText(error) } });
  }

  await cleanupClaimObjects(service, {
    actorId: input.actorId,
    mode: 'staging',
    path: input.path,
    stage: 'promote',
  });

  return { imagePath: `${PUBLIC_MEDIA_BUCKET}/${input.path}` };
}

export async function cleanupExpiredAdminArtworkUploads(limit = 50): Promise<{
  candidates: number;
  completed: number;
} | null> {
  let service: ReturnType<typeof createServiceClient>;
  let rows: unknown[];
  const boundedLimit = Number.isInteger(limit)
    ? Math.min(Math.max(limit, 1), 100)
    : 50;
  try {
    service = createServiceClient();
    const { data, error } = await service.rpc(
      'service_list_admin_artwork_cleanup_candidates',
      { p_limit: boundedLimit },
    );
    if (error || !Array.isArray(data)) return null;
    rows = data;
  } catch {
    return null;
  }

  let candidates = 0;
  let completed = 0;
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue;
    const candidate = row as Record<string, unknown>;
    const actorId = candidate.actor_id;
    const mode = candidate.cleanup_mode;
    const path = candidate.path;
    if (
      typeof actorId !== 'string'
      || (mode !== 'all' && mode !== 'staging')
      || typeof path !== 'string'
      || !parseAdminArtworkPath(path)
    ) {
      return null;
    }

    candidates += 1;
    if (await cleanupClaimObjects(service, {
      actorId,
      mode,
      path,
      stage: 'gc',
    })) {
      completed += 1;
    }
  }

  return { candidates, completed };
}
