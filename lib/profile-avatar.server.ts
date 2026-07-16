import 'server-only';

import { profileAvatarInitial } from '@/lib/profile';
import { createClient } from '@/lib/supabase/server';

interface ProfileAvatarPresentationInput {
  avatarPath: string | null;
  nickname: string;
}

interface ProfileAvatarPresentation {
  avatarInitial: string;
  avatarUrl: string | null;
}

export async function getProfileAvatarPresentation(
  input: ProfileAvatarPresentationInput,
): Promise<ProfileAvatarPresentation> {
  const avatarInitial = profileAvatarInitial(input.nickname);
  if (!input.avatarPath) return { avatarInitial, avatarUrl: null };

  try {
    const supabase = await createClient();
    const { data, error } = await supabase.storage
      .from('user-uploads')
      .createSignedUrl(input.avatarPath, 3600);

    return {
      avatarInitial,
      avatarUrl: error ? null : data?.signedUrl ?? null,
    };
  } catch {
    return { avatarInitial, avatarUrl: null };
  }
}
