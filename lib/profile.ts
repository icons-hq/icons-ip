export const MAX_PROFILE_NICKNAME_RAW_CODE_UNITS = 512;
export const MAX_PROFILE_NICKNAME_GRAPHEMES = 30;
export const MAX_PROFILE_IMAGE_BYTES = 5 * 1024 * 1024;
export const PROFILE_IMAGE_ACCEPT = 'image/jpeg,image/png,image/webp';
export const PROFILE_IMAGE_ERROR =
  '아바타는 JPEG, PNG, WebP 형식의 5MB 이하 파일만 업로드할 수 있습니다.';

const PROFILE_NICKNAME_REQUIRED_ERROR = '닉네임을 입력해주세요.';
const PROFILE_NICKNAME_LENGTH_ERROR = '닉네임은 30자 이하로 입력해주세요.';

export type ProfileImageMime = 'image/jpeg' | 'image/png' | 'image/webp';

const PROFILE_IMAGE_EXTENSIONS: Record<ProfileImageMime, 'jpg' | 'png' | 'webp'> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

const PROFILE_IMAGE_MIME_TYPES: readonly string[] = Object.keys(PROFILE_IMAGE_EXTENSIONS);
const PROFILE_IMAGE_MIME_BY_EXTENSION: Record<'jpg' | 'png' | 'webp', ProfileImageMime> = {
  jpg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
};

const UUID_PATTERN = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const UUID_V4_PATTERN = '[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}';
const UUID_REGEX = new RegExp(`^${UUID_PATTERN}$`);
const UUID_V4_REGEX = new RegExp(`^${UUID_V4_PATTERN}$`);

export type ProfileNicknameResult =
  | { ok: true; value: string }
  | { ok: false; error: string };

export type ProfileImageMetadataResult =
  | { ok: true; value: { mimeType: ProfileImageMime; size: number } }
  | { ok: false; error: string };

export type ProfileFormResult =
  | { ok: true; value: { nickname: string; avatar: File | null } }
  | { ok: false; errors: { nickname?: string; avatar?: string } };

// `value in EXTENSIONS`는 프로토타입 체인까지 훑어 'toString' 같은 입력을 MIME으로
// 인정한다. 그러면 확장자 조회가 함수를 돌려주고 경로 템플릿이 그것을 문자열화한다.
function isSupportedProfileImageMime(value: unknown): value is ProfileImageMime {
  return typeof value === 'string' && PROFILE_IMAGE_MIME_TYPES.includes(value);
}

function exceedsProfileNicknameGraphemeLimit(value: string): boolean {
  const Segmenter = Intl.Segmenter;

  if (typeof Segmenter === 'function') {
    let count = 0;
    const iterator = new Segmenter('ko', { granularity: 'grapheme' })
      .segment(value)
      [Symbol.iterator]();
    while (!iterator.next().done) {
      count += 1;
      if (count > MAX_PROFILE_NICKNAME_GRAPHEMES) return true;
    }
    return false;
  }

  let count = 0;
  const iterator = value[Symbol.iterator]();
  while (!iterator.next().done) {
    count += 1;
    if (count > MAX_PROFILE_NICKNAME_GRAPHEMES) return true;
  }
  return false;
}

export function normalizeProfileNickname(raw: unknown): ProfileNicknameResult {
  if (typeof raw !== 'string') return { ok: false, error: PROFILE_NICKNAME_REQUIRED_ERROR };
  if (raw.length > MAX_PROFILE_NICKNAME_RAW_CODE_UNITS) {
    return { ok: false, error: PROFILE_NICKNAME_LENGTH_ERROR };
  }

  const value = raw.trim();
  if (!value) return { ok: false, error: PROFILE_NICKNAME_REQUIRED_ERROR };
  if (exceedsProfileNicknameGraphemeLimit(value)) {
    return { ok: false, error: PROFILE_NICKNAME_LENGTH_ERROR };
  }

  return { ok: true, value };
}

export function normalizeProfileImageMetadata(input: {
  mimeType: unknown;
  size: unknown;
}): ProfileImageMetadataResult {
  if (
    !isSupportedProfileImageMime(input.mimeType) ||
    typeof input.size !== 'number' ||
    !Number.isInteger(input.size) ||
    input.size < 1 ||
    input.size > MAX_PROFILE_IMAGE_BYTES
  ) {
    return { ok: false, error: PROFILE_IMAGE_ERROR };
  }

  return {
    ok: true,
    value: { mimeType: input.mimeType, size: input.size },
  };
}

export function normalizeProfileForm(formData: FormData): ProfileFormResult {
  const nicknameResult = normalizeProfileNickname(formData.get('nickname'));
  const avatarValue = formData.get('avatar');
  const avatar =
    typeof File !== 'undefined' && avatarValue instanceof File && avatarValue.size > 0
      ? avatarValue
      : null;
  const errors: { nickname?: string; avatar?: string } = {};

  if (!nicknameResult.ok) errors.nickname = nicknameResult.error;

  if (avatar) {
    const metadataResult = normalizeProfileImageMetadata({
      mimeType: avatar.type,
      size: avatar.size,
    });
    if (!metadataResult.ok) errors.avatar = metadataResult.error;
  }

  if (Object.keys(errors).length > 0) return { ok: false, errors };

  return {
    ok: true,
    value: { nickname: nicknameResult.ok ? nicknameResult.value : '', avatar },
  };
}

export function profileAvatarFolder(userId: string): string {
  return `${userId}/profile`;
}

export function buildProfileAvatarPath(input: {
  userId: string;
  mimeType: string;
  nonce: string;
}): string {
  if (!isSupportedProfileImageMime(input.mimeType)) {
    throw new Error('Unsupported profile image MIME type');
  }
  if (!UUID_REGEX.test(input.userId)) throw new Error('Invalid profile user ID');
  if (!UUID_V4_REGEX.test(input.nonce)) throw new Error('Invalid profile image nonce');

  return `${profileAvatarFolder(input.userId)}/${input.nonce}.${PROFILE_IMAGE_EXTENSIONS[input.mimeType]}`;
}

export function parseProfileAvatarPath(
  raw: unknown,
  userId: string,
): { path: string; mimeType: ProfileImageMime } | null {
  if (typeof raw !== 'string' || !UUID_REGEX.test(userId)) return null;

  const match = new RegExp(
    `^${userId}/profile/(${UUID_V4_PATTERN})\\.(jpg|png|webp)$`,
  ).exec(raw);
  if (!match) return null;

  const extension = match[2] as 'jpg' | 'png' | 'webp';
  return { path: raw, mimeType: PROFILE_IMAGE_MIME_BY_EXTENSION[extension] };
}

export function isProfileAvatarPathForUser(
  path: string | null | undefined,
  userId: string,
): boolean {
  return parseProfileAvatarPath(path, userId) !== null;
}

function startsWith(bytes: Uint8Array, signature: readonly number[], offset = 0): boolean {
  if (bytes.length < offset + signature.length) return false;
  return signature.every((value, index) => bytes[offset + index] === value);
}

export function matchesProfileImageMagicBytes(
  bytes: Uint8Array,
  mimeType: ProfileImageMime,
): boolean {
  switch (mimeType) {
    case 'image/jpeg':
      return startsWith(bytes, [0xff, 0xd8, 0xff]);
    case 'image/png':
      return startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    case 'image/webp':
      return startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) && startsWith(bytes, [0x57, 0x45, 0x42, 0x50], 8);
  }
}

export function profileAvatarInitial(nickname: string): string {
  const value = nickname.trim();
  if (!value) return 'I';

  const Segmenter = Intl.Segmenter;
  if (typeof Segmenter === 'function') {
    const first = new Segmenter('ko', { granularity: 'grapheme' })
      .segment(value)
      [Symbol.iterator]()
      .next();
    if (!first.done) return first.value.segment;
  }

  return Array.from(value)[0] ?? 'I';
}
