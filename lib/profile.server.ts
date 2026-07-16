import 'server-only';

import { parseProfileAvatarPath } from '@/lib/profile';
import { createClient } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/service';

interface UpdateProfileIdentityInput {
  userId: string;
  nickname: string;
  avatarPath: string | null;
  replaceAvatar: boolean;
}

export type UpdateProfileIdentityResult =
  | { ok: true; previousAvatarPath: string | null }
  | { ok: false; errorCode?: string };

interface CleanupProfileAvatarInput {
  userId: string;
  path: string;
  stage: string;
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
        ? { ok: false, errorCode: error.code }
        : { ok: false };
    }

    if (!Array.isArray(data) || data.length === 0) return { ok: false };
    const previousAvatarPath = (data[0] as { previous_avatar_path?: unknown })
      .previous_avatar_path;
    if (previousAvatarPath !== null && typeof previousAvatarPath !== 'string') {
      return { ok: false };
    }

    return { ok: true, previousAvatarPath };
  } catch {
    return { ok: false };
  }
}

export async function cleanupProfileAvatar(
  input: CleanupProfileAvatarInput,
): Promise<void> {
  const parsed = parseProfileAvatarPath(input.path, input.userId);
  if (!parsed) return;

  try {
    const supabase = await createClient();
    const { error } = await supabase.storage
      .from('user-uploads')
      .remove([parsed.path]);
    if (!error) return;
  } catch {
    // service-role retry below
  }

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
    await service.from('audit_log').insert({
      actor_id: input.userId,
      action: 'profile_avatar_cleanup_failed',
      target: parsed.path,
      diff: { stage: input.stage },
    });
  } catch {
    // cleanup and its audit are both best-effort
  }
}
