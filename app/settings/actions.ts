'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { isOnboarded, onboardingPath } from '@/lib/auth/onboarding';
import { getCurrentAuthState } from '@/lib/auth/server';
import type { CurrentAuthState } from '@/lib/auth/server';
import {
  buildProfileAvatarPath,
  isProfileAvatarPathForUser,
  normalizeProfileForm,
} from '@/lib/profile';
import { mergeMarketingConsent } from '@/lib/settings';
import { createClient } from '@/lib/supabase/server';

export interface SettingsActionState {
  errors?: {
    nickname?: string;
    avatar?: string;
    form?: string;
  };
  message?: string;
}

const SETTINGS_PATH = '/settings';
const USER_UPLOADS_BUCKET = 'user-uploads';
const SETTINGS_CONFIG_ERROR = 'Supabase 환경변수를 설정한 뒤 설정을 변경할 수 있습니다.';

type RequireSettingsAuthResult =
  | {
      ok: true;
      auth: CurrentAuthState;
      user: NonNullable<CurrentAuthState['user']>;
    }
  | { ok: false; state: SettingsActionState };

async function requireSettingsAuth(): Promise<RequireSettingsAuthResult> {
  const auth = await getCurrentAuthState();
  if (!auth.isConfigured) {
    return { ok: false, state: { errors: { form: SETTINGS_CONFIG_ERROR } } };
  }
  if (!auth.user) {
    redirect(`/login?next=${encodeURIComponent(SETTINGS_PATH)}`);
  }
  if (!isOnboarded(auth.profile, auth.user.email)) {
    redirect(onboardingPath(SETTINGS_PATH));
  }

  return { ok: true, auth, user: auth.user };
}

export async function updateProfileAction(
  _state: SettingsActionState,
  formData: FormData,
): Promise<SettingsActionState> {
  const normalized = normalizeProfileForm(formData);
  if (!normalized.ok) return { errors: normalized.errors };

  const required = await requireSettingsAuth();
  if (!required.ok) return required.state;

  const { auth, user } = required;
  const { nickname, avatar } = normalized.value;
  const avatarPath = avatar
    ? buildProfileAvatarPath({
        userId: user.id,
        mimeType: avatar.type,
        nonce: crypto.randomUUID(),
      })
    : null;
  const supabase = await createClient();
  const profileStorage = avatarPath ? supabase.storage.from(USER_UPLOADS_BUCKET) : null;

  if (avatar && avatarPath && profileStorage) {
    const { error } = await profileStorage.upload(avatarPath, avatar, {
      contentType: avatar.type,
      upsert: false,
    });

    if (error) {
      return { errors: { avatar: '아바타를 업로드하지 못했습니다. 다시 시도해주세요.' } };
    }
  }

  const { error } = await supabase
    .from('profiles')
    .update({ nickname, ...(avatarPath ? { avatar_path: avatarPath } : {}) })
    .eq('id', user.id)
    .select('id')
    .single();

  if (error) {
    if (avatarPath && profileStorage) await profileStorage.remove([avatarPath]);
    if (error.code === '23505') {
      return { errors: { nickname: '이미 사용 중인 닉네임입니다.' } };
    }
    return { errors: { form: '프로필을 저장하지 못했습니다. 다시 시도해주세요.' } };
  }

  const previousAvatarPath = auth.profile?.avatar_path;
  if (
    avatarPath &&
    profileStorage &&
    previousAvatarPath &&
    previousAvatarPath !== avatarPath &&
    isProfileAvatarPathForUser(previousAvatarPath, user.id)
  ) {
    try {
      await profileStorage.remove([previousAvatarPath]);
    } catch {
      // 프로필 저장은 이미 성공했으므로 이전 파일 정리는 다음 교체 때 다시 시도한다.
    }
  }

  revalidatePath(SETTINGS_PATH);
  revalidatePath('/');
  revalidatePath('/community');
  revalidatePath('/search');
  return { message: '프로필을 저장했어요.' };
}

export async function updateMarketingConsentAction(
  _state: SettingsActionState,
  formData: FormData,
): Promise<SettingsActionState> {
  const marketing = formData.get('marketing') === 'on';

  const required = await requireSettingsAuth();
  if (!required.ok) return required.state;

  const { auth, user } = required;

  // terms·privacy는 클라이언트 입력을 신뢰하지 않고 DB 현재 값을 보존한다
  const supabase = await createClient();
  const { error } = await supabase
    .from('profiles')
    .update({ consents: mergeMarketingConsent(auth.profile?.consents, marketing) })
    .eq('id', user.id)
    .select('id')
    .single();

  if (error) return { errors: { form: '설정을 저장하지 못했습니다. 다시 시도해주세요.' } };

  revalidatePath(SETTINGS_PATH);
  return { message: '마케팅 정보 수신 동의 설정을 저장했어요.' };
}
