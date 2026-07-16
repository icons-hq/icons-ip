import 'server-only';

import { parseProfileAvatarPath } from '@/lib/profile';
import { createServiceClient } from '@/lib/supabase/service';

interface UpdateProfileIdentityInput {
  userId: string;
  nickname: string;
  avatarPath: string | null;
  replaceAvatar: boolean;
}

export type UpdateProfileIdentityResult =
  | { ok: true; previousAvatarPath: string | null }
  | { ok: false; errorCode?: string; cleanupSafe: boolean };

interface ProfileAvatarClaimInput {
  userId: string;
  path: string;
}

interface CleanupProfileAvatarInput {
  userId: string;
  path: string;
  stage: 'candidate' | 'previous';
}

export async function updateProfileIdentity(
  input: UpdateProfileIdentityInput,
): Promise<UpdateProfileIdentityResult> {
  try {
    const service = createServiceClient();
    const { data, error } = await service.rpc('service_update_profile_identity', {
      p_user_id: input.userId,
      p_nickname: input.nickname,
      p_avatar_path: input.avatarPath,
      p_replace_avatar: input.replaceAvatar,
    });

    if (error) {
      return typeof error.code === 'string'
        ? { ok: false, errorCode: error.code, cleanupSafe: false }
        : { ok: false, cleanupSafe: false };
    }

    if (!Array.isArray(data) || data.length === 0) {
      return { ok: false, cleanupSafe: false };
    }
    const result = data[0] as {
      applied?: unknown;
      cleanup_safe?: unknown;
      error_code?: unknown;
      previous_avatar_path?: unknown;
    };
    const previousAvatarPath = result.previous_avatar_path;
    if (previousAvatarPath !== null && typeof previousAvatarPath !== 'string') {
      return { ok: false, cleanupSafe: false };
    }

    if (result.applied === true) {
      if (result.cleanup_safe !== false || result.error_code !== null) {
        return { ok: false, cleanupSafe: false };
      }
      return { ok: true, previousAvatarPath };
    }

    if (
      result.applied !== false
      || typeof result.cleanup_safe !== 'boolean'
      || typeof result.error_code !== 'string'
      || !result.error_code
      || previousAvatarPath !== null
    ) {
      return { ok: false, cleanupSafe: false };
    }

    return {
      ok: false,
      errorCode: result.error_code,
      cleanupSafe: result.cleanup_safe,
    };
  } catch {
    return { ok: false, cleanupSafe: false };
  }
}

export async function prepareProfileAvatarClaim(
  input: ProfileAvatarClaimInput,
): Promise<{ ok: boolean }> {
  try {
    const service = createServiceClient();
    const { data, error } = await service.rpc('service_prepare_profile_avatar_claim', {
      p_avatar_path: input.path,
      p_user_id: input.userId,
    });

    return { ok: !error && data === true };
  } catch {
    return { ok: false };
  }
}

export async function rejectProfileAvatarClaim(
  input: ProfileAvatarClaimInput,
): Promise<{ cleanupSafe: boolean }> {
  try {
    const service = createServiceClient();
    const { data, error } = await service.rpc('service_reject_profile_avatar_claim', {
      p_avatar_path: input.path,
      p_user_id: input.userId,
    });

    if (error || !Array.isArray(data) || data.length === 0) {
      return { cleanupSafe: false };
    }
    const result = data[0] as { cleanup_safe?: unknown; rejected?: unknown };
    return {
      cleanupSafe: result.rejected === true && result.cleanup_safe === true,
    };
  } catch {
    return { cleanupSafe: false };
  }
}

export async function cleanupProfileAvatar(
  input: CleanupProfileAvatarInput,
): Promise<void> {
  const parsed = parseProfileAvatarPath(input.path, input.userId);
  if (!parsed) return;

  let service: ReturnType<typeof createServiceClient> | null = null;
  try {
    service = createServiceClient();
    const { error } = await service.storage
      .from('user-uploads')
      .remove([parsed.path]);
    if (!error) return;
  } catch {
    // safe audit fallback below
  }

  if (!service) return;
  try {
    await service.rpc('service_log_profile_avatar_cleanup_failure', {
      p_avatar_path: parsed.path,
      p_stage: input.stage,
      p_user_id: input.userId,
    });
  } catch {
    // cleanup and its audit are both best-effort
  }
}
