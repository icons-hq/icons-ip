export const MAX_PROFILE_IMAGE_BYTES = 5 * 1024 * 1024;
export const PROFILE_IMAGE_ACCEPT = 'image/jpeg,image/png,image/webp';

const PROFILE_IMAGE_ERROR =
  '아바타는 JPEG, PNG, WebP 형식의 5MB 이하 파일만 업로드할 수 있습니다.';

const PROFILE_IMAGE_EXTENSIONS = new Map([
  ['image/jpeg', 'jpg'],
  ['image/png', 'png'],
  ['image/webp', 'webp'],
]);

export type ProfileFormResult =
  | { ok: true; value: { nickname: string; avatar: File | null } }
  | { ok: false; errors: { nickname?: string; avatar?: string } };

function countProfileNicknameGraphemes(nickname: string): number {
  const segmenter = new Intl.Segmenter('ko', { granularity: 'grapheme' });
  return Array.from(segmenter.segment(nickname)).length;
}

export function normalizeProfileForm(formData: FormData): ProfileFormResult {
  const nicknameValue = formData.get('nickname');
  const nickname = typeof nicknameValue === 'string' ? nicknameValue.trim() : '';
  const avatarValue = formData.get('avatar');
  const avatar = avatarValue instanceof File && avatarValue.size > 0 ? avatarValue : null;
  const errors: { nickname?: string; avatar?: string } = {};

  if (!nickname) {
    errors.nickname = '닉네임을 입력해주세요.';
  } else if (countProfileNicknameGraphemes(nickname) > 30) {
    errors.nickname = '닉네임은 30자 이하로 입력해주세요.';
  }

  if (
    avatar &&
    (avatar.size > MAX_PROFILE_IMAGE_BYTES || !PROFILE_IMAGE_EXTENSIONS.has(avatar.type))
  ) {
    errors.avatar = PROFILE_IMAGE_ERROR;
  }

  if (Object.keys(errors).length > 0) return { ok: false, errors };

  return { ok: true, value: { nickname, avatar } };
}

export function profileAvatarFolder(userId: string): string {
  return `${userId}/profile`;
}

export function buildProfileAvatarPath(input: {
  userId: string;
  mimeType: string;
  nonce: string;
}): string {
  const extension = PROFILE_IMAGE_EXTENSIONS.get(input.mimeType);
  if (!extension) throw new Error('Unsupported profile image MIME type');
  return `${profileAvatarFolder(input.userId)}/${input.nonce}.${extension}`;
}

export function isProfileAvatarPathForUser(
  path: string | null | undefined,
  userId: string,
): boolean {
  return path?.startsWith(`${profileAvatarFolder(userId)}/`) ?? false;
}
