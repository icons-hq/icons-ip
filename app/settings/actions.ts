'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { isOnboarded, onboardingPath } from '@/lib/auth/onboarding';
import { getCurrentAuthState } from '@/lib/auth/server';
import type { CurrentAuthState } from '@/lib/auth/server';
import {
  ACCOUNT_DELETION_CONFIRMATION,
  normalizeAccountDeletionStatus,
  type AccountDeletionStatus,
} from '@/lib/account-deletion';
import {
  buildProfileAvatarPath,
  matchesProfileImageMagicBytes,
  normalizeProfileImageMetadata,
  normalizeProfileNickname,
  parseProfileAvatarPath,
} from '@/lib/profile';
import {
  cleanupProfileAvatar,
  prepareProfileAvatarClaim,
  rejectProfileAvatarClaim,
  updateProfileIdentity,
} from '@/lib/profile.server';
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

export interface AccountDeletionActionState {
  error?: string;
  message?: string;
  status?: AccountDeletionStatus;
}

export interface PrepareProfileAvatarUploadInput {
  nickname: unknown;
  mimeType: unknown;
  size: unknown;
}

export type PrepareProfileAvatarUploadResult =
  | { ok: true; path: string }
  | { ok: false; errors: NonNullable<SettingsActionState['errors']> };

const SETTINGS_PATH = '/settings';
const USER_UPLOADS_BUCKET = 'user-uploads';
const SETTINGS_CONFIG_ERROR = 'Supabase 환경변수를 설정한 뒤 설정을 변경할 수 있습니다.';
const AVATAR_PATH_ERROR = '아바타 경로를 확인할 수 없습니다. 다시 업로드해주세요.';
const AVATAR_VALIDATION_ERROR = '아바타 파일을 확인하지 못했습니다. 다시 업로드해주세요.';
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type RequireSettingsAuthResult =
  | {
      ok: true;
      auth: CurrentAuthState;
      user: NonNullable<CurrentAuthState['user']>;
    }
  | { ok: false; state: SettingsActionState };

type RequireAccountDeletionAuthResult =
  | { ok: true; user: NonNullable<CurrentAuthState['user']> }
  | { ok: false; error: string };

async function requireAccountDeletionAuth(): Promise<RequireAccountDeletionAuthResult> {
  const auth = await getCurrentAuthState();
  if (!auth.isConfigured) return { ok: false, error: SETTINGS_CONFIG_ERROR };
  if (!auth.user) {
    redirect(`/login?next=${encodeURIComponent('/settings/delete-account')}`);
  }
  return { ok: true, user: auth.user };
}

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

export async function requestAccountDeletionAction(
  _state: AccountDeletionActionState,
  formData: FormData,
): Promise<AccountDeletionActionState> {
  const confirmation = formData.get('confirmation');
  const idempotencyKey = formData.get('idempotencyKey');

  if (confirmation !== ACCOUNT_DELETION_CONFIRMATION) {
    return { error: '확인 문구를 정확히 입력해주세요.' };
  }
  if (typeof idempotencyKey !== 'string' || !UUID_PATTERN.test(idempotencyKey)) {
    return { error: '탈퇴 신청 화면을 새로고침한 뒤 다시 시도해주세요.' };
  }

  const required = await requireAccountDeletionAuth();
  if (!required.ok) {
    return { error: required.error };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc('request_my_account_deletion', {
    p_confirmation: confirmation,
    p_idempotency_key: idempotencyKey,
  });

  if (error) {
    if (error.message.includes('account_deletion_not_available')) {
      return { error: '탈퇴 신청 기능을 준비 중입니다.' };
    }
    if (error.message.includes('account_deletion_reauthentication_required')) {
      return { error: '보안을 위해 다시 로그인한 뒤 탈퇴를 신청해주세요.' };
    }
    if (error.message.includes('account_deletion_idempotency_conflict')) {
      return { error: '이미 접수된 탈퇴 신청 상태를 확인해주세요.' };
    }
    return { error: '탈퇴 신청을 접수하지 못했습니다. 다시 시도해주세요.' };
  }

  const status = normalizeAccountDeletionStatus(data);
  if (status.status === 'not_requested') {
    return { error: '탈퇴 신청 상태를 확인하지 못했습니다. 다시 시도해주세요.' };
  }

  revalidatePath(SETTINGS_PATH);
  return {
    message: '탈퇴 신청을 접수했어요. 계정은 아직 삭제되지 않았습니다.',
    status,
  };
}

async function safeCleanupProfileAvatar(input: {
  userId: string;
  path: string;
  stage: 'candidate' | 'previous';
}) {
  try {
    await cleanupProfileAvatar(input);
  } catch {
    // The helper is best-effort; an unexpected rejection must not replace the intended result.
  }
}

async function rejectAndCleanupProfileAvatarCandidate(input: {
  userId: string;
  path: string;
}) {
  let cleanupSafe = false;
  try {
    const rejected = await rejectProfileAvatarClaim(input);
    cleanupSafe = rejected.cleanupSafe;
  } catch {
    // Unknown claim state must never authorize deletion.
  }

  if (cleanupSafe) {
    await safeCleanupProfileAvatar({ ...input, stage: 'candidate' });
  }
}

export async function prepareProfileAvatarUploadAction(
  input: PrepareProfileAvatarUploadInput,
): Promise<PrepareProfileAvatarUploadResult> {
  const nickname = normalizeProfileNickname(input.nickname);
  const metadata = normalizeProfileImageMetadata({
    mimeType: input.mimeType,
    size: input.size,
  });
  if (!nickname.ok || !metadata.ok) {
    const errors: NonNullable<SettingsActionState['errors']> = {};
    if (!nickname.ok) errors.nickname = nickname.error;
    if (!metadata.ok) errors.avatar = metadata.error;
    return { ok: false, errors };
  }

  const required = await requireSettingsAuth();
  if (!required.ok) {
    return {
      ok: false,
      errors: required.state.errors ?? {
        form: '아바타 업로드를 준비하지 못했습니다. 다시 시도해주세요.',
      },
    };
  }

  try {
    const path = buildProfileAvatarPath({
      userId: required.user.id,
      mimeType: metadata.value.mimeType,
      nonce: crypto.randomUUID(),
    });
    const claim = await prepareProfileAvatarClaim({
      userId: required.user.id,
      path,
    });
    if (!claim.ok) {
      return {
        ok: false,
        errors: { avatar: '아바타 업로드를 준비하지 못했습니다. 다시 시도해주세요.' },
      };
    }
    return { ok: true, path };
  } catch {
    return {
      ok: false,
      errors: { avatar: '아바타 업로드를 준비하지 못했습니다. 다시 시도해주세요.' },
    };
  }
}

function readProfileUpdateForm(formData: FormData): {
  nickname: ReturnType<typeof normalizeProfileNickname>;
  avatarPath: string | null;
  avatarPathError: boolean;
} {
  const nickname = normalizeProfileNickname(formData.get('nickname'));
  const avatarPathEntry = formData.get('avatarPath');
  const legacyAvatarEntry = formData.get('avatar');
  const legacyFileSubmitted =
    typeof File !== 'undefined'
    && legacyAvatarEntry instanceof File
    && legacyAvatarEntry.size > 0;

  if (avatarPathEntry === null || avatarPathEntry === '') {
    return { nickname, avatarPath: null, avatarPathError: legacyFileSubmitted };
  }
  if (typeof avatarPathEntry !== 'string') {
    return { nickname, avatarPath: null, avatarPathError: true };
  }

  return { nickname, avatarPath: avatarPathEntry, avatarPathError: legacyFileSubmitted };
}

async function validateStoredProfileAvatar(input: {
  path: string;
  mimeType: 'image/jpeg' | 'image/png' | 'image/webp';
}): Promise<boolean> {
  try {
    const supabase = await createClient();
    const storage = supabase.storage.from(USER_UPLOADS_BUCKET);
    const { data: info, error: infoError } = await storage.info(input.path);
    if (infoError || !info) return false;

    const metadata = normalizeProfileImageMetadata({
      mimeType: info.contentType,
      size: info.size,
    });
    if (!metadata.ok || metadata.value.mimeType !== input.mimeType) return false;

    const { data: blob, error: downloadError } = await storage.download(input.path);
    if (downloadError || !blob || typeof blob.arrayBuffer !== 'function') return false;

    const bytes = new Uint8Array(await blob.arrayBuffer());
    return matchesProfileImageMagicBytes(bytes, input.mimeType);
  } catch {
    return false;
  }
}

export async function updateProfileAction(
  _state: SettingsActionState,
  formData: FormData,
): Promise<SettingsActionState> {
  const input = readProfileUpdateForm(formData);
  const errors: NonNullable<SettingsActionState['errors']> = {};
  if (!input.nickname.ok) errors.nickname = input.nickname.error;
  if (input.avatarPathError) errors.avatar = AVATAR_PATH_ERROR;
  if (Object.keys(errors).length > 0) return { errors };

  const required = await requireSettingsAuth();
  if (!required.ok) return required.state;

  const { auth, user } = required;
  const parsedAvatar = input.avatarPath
    ? parseProfileAvatarPath(input.avatarPath, user.id)
    : null;
  if (input.avatarPath && !parsedAvatar) {
    return { errors: { avatar: AVATAR_PATH_ERROR } };
  }
  if (parsedAvatar && parsedAvatar.path === auth.profile?.avatar_path) {
    return { errors: { avatar: '현재 아바타와 다른 이미지를 선택해주세요.' } };
  }

  if (parsedAvatar) {
    const valid = await validateStoredProfileAvatar(parsedAvatar);
    if (!valid) {
      await rejectAndCleanupProfileAvatarCandidate({
        userId: user.id,
        path: parsedAvatar.path,
      });
      return { errors: { avatar: AVATAR_VALIDATION_ERROR } };
    }
  }

  let updateResult: Awaited<ReturnType<typeof updateProfileIdentity>>;
  try {
    updateResult = await updateProfileIdentity({
      userId: user.id,
      nickname: input.nickname.ok ? input.nickname.value : '',
      avatarPath: parsedAvatar?.path ?? null,
      replaceAvatar: parsedAvatar !== null,
    });
  } catch {
    updateResult = { ok: false, cleanupSafe: false };
  }

  if (!updateResult.ok) {
    if (parsedAvatar && updateResult.cleanupSafe) {
      await safeCleanupProfileAvatar({
        userId: user.id,
        path: parsedAvatar.path,
        stage: 'candidate',
      });
    }
    if (updateResult.errorCode === '23505') {
      return { errors: { nickname: '이미 사용 중인 닉네임입니다.' } };
    }
    return { errors: { form: '프로필을 저장하지 못했습니다. 다시 시도해주세요.' } };
  }

  if (
    parsedAvatar
    && updateResult.previousAvatarPath
    && updateResult.previousAvatarPath !== parsedAvatar.path
  ) {
    await safeCleanupProfileAvatar({
      userId: user.id,
      path: updateResult.previousAvatarPath,
      stage: 'previous',
    });
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
