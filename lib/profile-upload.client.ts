'use client';

import {
  prepareProfileAvatarUploadAction,
  type SettingsActionState,
} from '@/app/settings/actions';
import { createClient } from '@/lib/supabase/client';

export type ProfileAvatarUploadResult =
  | { ok: true; path: string }
  | { ok: false; errors: NonNullable<SettingsActionState['errors']> };

const UPLOAD_ERROR = '아바타를 업로드하지 못했습니다. 다시 시도해주세요.';

export async function uploadProfileAvatar(input: {
  nickname: string;
  file: File;
}): Promise<ProfileAvatarUploadResult> {
  try {
    const grant = await prepareProfileAvatarUploadAction({
      nickname: input.nickname,
      mimeType: input.file.type,
      size: input.file.size,
    });
    if (!grant.ok) return grant;

    const supabase = createClient();
    const { error } = await supabase.storage
      .from('user-uploads')
      .uploadToSignedUrl(grant.path, grant.token, input.file, {
        contentType: input.file.type,
        upsert: false,
      });

    if (error) return { ok: false, errors: { avatar: UPLOAD_ERROR } };
    return { ok: true, path: grant.path };
  } catch {
    return { ok: false, errors: { avatar: UPLOAD_ERROR } };
  }
}
