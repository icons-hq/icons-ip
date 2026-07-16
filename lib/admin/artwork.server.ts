import 'server-only';

import {
  normalizeAdminArtworkMetadata,
  parseAdminArtworkPath,
  type AdminArtworkKind,
  type AdminArtworkMimeType,
} from './artwork';
import { normalizeAdminArtworkImage } from './artwork-image.server';
import { createServiceClient } from '@/lib/supabase/service';

const CLAIM_TTL_MS = 10 * 60 * 1000;
const PUBLIC_MEDIA_BUCKET = 'public-media';
const STAGING_BUCKET = 'admin-artwork-staging';

interface AdminArtworkClaimInput {
  actorId: string;
  kind: AdminArtworkKind;
  mimeType: AdminArtworkMimeType;
  path: string;
  size: number;
}

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

async function rejectWithClient(
  service: ReturnType<typeof createServiceClient>,
  input: { actorId: string; path: string },
) {
  try {
    const { data, error } = await service.rpc('service_reject_admin_artwork_upload', {
      p_actor_id: input.actorId,
      p_path: input.path,
    });
    if (error || data !== true) return;
  } catch {
    return;
  }

  await cleanupClaimObjects(service, {
    ...input,
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
      p_expires_at: new Date(Date.now() + CLAIM_TTL_MS).toISOString(),
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

  await cleanupClaimObjects(service, {
    ...input,
    mode: 'all',
    stage: 'reject',
  });
}

export async function verifyAndPromoteAdminArtwork(
  input: AdminArtworkClaimInput,
): Promise<{ imagePath: string } | null> {
  if (!validClaimInput(input)) return null;

  let service: ReturnType<typeof createServiceClient>;
  try {
    service = createServiceClient();
    const { data, error } = await service.rpc('service_begin_admin_artwork_verification', {
      p_actor_id: input.actorId,
      p_path: input.path,
    });
    const claim = firstRpcRow(data);
    if (error || !claim) return null;
    if (
      claim.kind !== input.kind
      || claim.mime_type !== input.mimeType
      || claim.source_size !== input.size
    ) {
      await rejectWithClient(service, input);
      return null;
    }
  } catch {
    return null;
  }

  let normalized: Awaited<ReturnType<typeof normalizeAdminArtworkImage>> = null;
  try {
    const staging = service.storage.from(STAGING_BUCKET);
    const { data: info, error: infoError } = await staging.info(input.path);
    if (!infoError && info) {
      const metadata = normalizeAdminArtworkMetadata({
        kind: input.kind,
        mimeType: info.contentType,
        size: info.size,
      });
      if (
        metadata.ok
        && metadata.value.mimeType === input.mimeType
        && metadata.value.size === input.size
      ) {
        const { data: blob, error: downloadError } = await staging.download(input.path);
        if (!downloadError && blob && typeof blob.arrayBuffer === 'function') {
          normalized = await normalizeAdminArtworkImage(
            new Uint8Array(await blob.arrayBuffer()),
            input.mimeType,
          );
        }
      }
    }
  } catch {
    normalized = null;
  }

  if (!normalized) {
    await rejectWithClient(service, input);
    return null;
  }

  try {
    const { error: uploadError } = await service.storage
      .from(PUBLIC_MEDIA_BUCKET)
      .upload(input.path, normalized.bytes, {
        contentType: input.mimeType,
        upsert: false,
      });
    if (uploadError) {
      await rejectWithClient(service, input);
      return null;
    }

    const { data: verified, error: verifyError } = await service.rpc(
      'service_verify_admin_artwork_upload',
      {
        p_actor_id: input.actorId,
        p_final_size: normalized.bytes.byteLength,
        p_path: input.path,
      },
    );
    if (verifyError || verified !== true) {
      await rejectWithClient(service, input);
      return null;
    }
  } catch {
    await rejectWithClient(service, input);
    return null;
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
