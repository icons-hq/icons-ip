import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import {
  MAX_PROFILE_IMAGE_BYTES,
  MAX_PROFILE_NICKNAME_RAW_CODE_UNITS,
  PROFILE_IMAGE_ACCEPT,
  PROFILE_IMAGE_ERROR,
  buildProfileAvatarPath,
  isProfileAvatarPathForUser,
  matchesProfileImageMagicBytes,
  normalizeProfileForm,
  normalizeProfileImageMetadata,
  normalizeProfileNickname,
  parseProfileAvatarPath,
  profileAvatarFolder,
  profileAvatarInitial,
} from './profile';

const USER_ID = '00000000-0000-4000-8000-000000000136';
const OTHER_USER_ID = '00000000-0000-4000-8000-000000000137';
const AVATAR_ID = '123e4567-e89b-42d3-a456-426614174000';
const AVATAR_PATH = `${USER_ID}/profile/${AVATAR_ID}.png`;

function profileForm(input: { nickname: string; avatar?: File }) {
  const formData = new FormData();
  formData.set('nickname', input.nickname);
  if (input.avatar) formData.set('avatar', input.avatar);
  return formData;
}

describe('normalizeProfileNickname', () => {
  it('trims a nonempty nickname', () => {
    expect(normalizeProfileNickname('  새닉네임  ')).toEqual({
      ok: true,
      value: '새닉네임',
    });
  });

  it('rejects empty and non-string values', () => {
    expect(normalizeProfileNickname('   ')).toEqual({
      ok: false,
      error: '닉네임을 입력해주세요.',
    });
    expect(normalizeProfileNickname(null)).toEqual({
      ok: false,
      error: '닉네임을 입력해주세요.',
    });
  });

  it('accepts 30 graphemes and rejects 31 graphemes', () => {
    expect(normalizeProfileNickname('😀'.repeat(30))).toEqual({
      ok: true,
      value: '😀'.repeat(30),
    });
    expect(normalizeProfileNickname('😀'.repeat(31))).toEqual({
      ok: false,
      error: '닉네임은 30자 이하로 입력해주세요.',
    });
  });

  it('treats long family ZWJ sequences as one grapheme each', () => {
    const family = '👨‍👩‍👧‍👦';
    expect(family.repeat(30).length).toBeLessThanOrEqual(MAX_PROFILE_NICKNAME_RAW_CODE_UNITS);
    expect(normalizeProfileNickname(family.repeat(30))).toEqual({
      ok: true,
      value: family.repeat(30),
    });
    expect(normalizeProfileNickname(family.repeat(31))).toEqual({
      ok: false,
      error: '닉네임은 30자 이하로 입력해주세요.',
    });
  });

  it('rejects the raw ceiling before constructing a segmenter', () => {
    const original = Intl.Segmenter;
    Object.defineProperty(Intl, 'Segmenter', {
      configurable: true,
      value: class {
        constructor() {
          throw new Error('segmenter should not be constructed');
        }
      },
    });

    try {
      expect(normalizeProfileNickname('a'.repeat(MAX_PROFILE_NICKNAME_RAW_CODE_UNITS + 1))).toEqual({
        ok: false,
        error: '닉네임은 30자 이하로 입력해주세요.',
      });
    } finally {
      Object.defineProperty(Intl, 'Segmenter', { configurable: true, value: original });
    }
  });

  it('stops segmentation immediately after observing the 31st grapheme', () => {
    const original = Intl.Segmenter;
    Object.defineProperty(Intl, 'Segmenter', {
      configurable: true,
      value: class {
        segment() {
          return {
            *[Symbol.iterator]() {
              for (let index = 0; index < 31; index += 1) yield { segment: 'a' };
              throw new Error('iterator should stop at 31 graphemes');
            },
          };
        }
      },
    });

    try {
      expect(normalizeProfileNickname('a'.repeat(31))).toEqual({
        ok: false,
        error: '닉네임은 30자 이하로 입력해주세요.',
      });
    } finally {
      Object.defineProperty(Intl, 'Segmenter', { configurable: true, value: original });
    }
  });
});

describe('profile image metadata', () => {
  it('accepts the exact 5MiB boundary for supported image types', () => {
    expect(
      normalizeProfileImageMetadata({ mimeType: 'image/png', size: MAX_PROFILE_IMAGE_BYTES }),
    ).toEqual({
      ok: true,
      value: { mimeType: 'image/png', size: MAX_PROFILE_IMAGE_BYTES },
    });
  });

  it.each([
    { mimeType: 'image/png', size: 0 },
    { mimeType: 'image/png', size: 1.5 },
    { mimeType: 'image/png', size: MAX_PROFILE_IMAGE_BYTES + 1 },
    { mimeType: 'image/svg+xml', size: 1 },
    { mimeType: null, size: 1 },
  ])('rejects invalid metadata %#', (input) => {
    expect(normalizeProfileImageMetadata(input)).toEqual({
      ok: false,
      error: PROFILE_IMAGE_ERROR,
    });
  });

  it('exports the browser file input accept contract', () => {
    expect(PROFILE_IMAGE_ACCEPT).toBe('image/jpeg,image/png,image/webp');
  });
});

describe('profile avatar paths', () => {
  it('builds a MIME-derived strict UUID v4 path', () => {
    expect(profileAvatarFolder(USER_ID)).toBe(`${USER_ID}/profile`);
    expect(
      buildProfileAvatarPath({ userId: USER_ID, mimeType: 'image/png', nonce: AVATAR_ID }),
    ).toBe(AVATAR_PATH);
    expect(parseProfileAvatarPath(AVATAR_PATH, USER_ID)).toEqual({
      path: AVATAR_PATH,
      mimeType: 'image/png',
    });
    expect(isProfileAvatarPathForUser(AVATAR_PATH, USER_ID)).toBe(true);
  });

  it.each([
    `${OTHER_USER_ID}/profile/${AVATAR_ID}.png`,
    `${USER_ID}/profile/123e4567-e89b-12d3-a456-426614174000.png`,
    `${USER_ID}/profile/${AVATAR_ID.toUpperCase()}.png`,
    `${USER_ID}/profile/${AVATAR_ID}.gif`,
    `${USER_ID}/profile/${AVATAR_ID}.png/extra`,
    `${USER_ID}/profile/../${AVATAR_ID}.png`,
    `${USER_ID}/community/${AVATAR_ID}.png`,
  ])('rejects an invalid or non-owned path %s', (path) => {
    expect(parseProfileAvatarPath(path, USER_ID)).toBeNull();
    expect(isProfileAvatarPathForUser(path, USER_ID)).toBe(false);
  });

  it('rejects unsupported MIME types and invalid nonces when building', () => {
    expect(() =>
      buildProfileAvatarPath({ userId: USER_ID, mimeType: 'image/svg+xml', nonce: AVATAR_ID }),
    ).toThrow('Unsupported profile image MIME type');
    expect(() =>
      buildProfileAvatarPath({ userId: USER_ID, mimeType: 'image/png', nonce: 'asset-1' }),
    ).toThrow('Invalid profile image nonce');
  });
});

describe('profile image signatures', () => {
  it('recognizes JPEG, PNG and WebP signatures', () => {
    expect(matchesProfileImageMagicBytes(new Uint8Array([0xff, 0xd8, 0xff, 0x00]), 'image/jpeg')).toBe(
      true,
    );
    expect(
      matchesProfileImageMagicBytes(
        new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
        'image/png',
      ),
    ).toBe(true);
    expect(
      matchesProfileImageMagicBytes(
        new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]),
        'image/webp',
      ),
    ).toBe(true);
  });

  it('rejects truncated and MIME-mismatched signatures', () => {
    expect(matchesProfileImageMagicBytes(new Uint8Array([0xff, 0xd8]), 'image/jpeg')).toBe(false);
    expect(
      matchesProfileImageMagicBytes(
        new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
        'image/webp',
      ),
    ).toBe(false);
  });
});

describe('profile avatar initial', () => {
  it('returns the first grapheme or the I fallback', () => {
    expect(profileAvatarInitial('  👨‍👩‍👧‍👦팬  ')).toBe('👨‍👩‍👧‍👦');
    expect(profileAvatarInitial('   ')).toBe('I');
  });
});

describe('legacy FormData compatibility', () => {
  it('normalizes the current action shape through the shared validators', () => {
    expect(normalizeProfileForm(profileForm({ nickname: '  fan  ' }))).toEqual({
      ok: true,
      value: { nickname: 'fan', avatar: null },
    });

    const unsupported = new File(['x'], 'a.svg', { type: 'image/svg+xml' });
    expect(normalizeProfileForm(profileForm({ nickname: 'fan', avatar: unsupported }))).toEqual({
      ok: false,
      errors: { avatar: PROFILE_IMAGE_ERROR },
    });
  });

  it('treats a zero-byte file as no replacement avatar', () => {
    expect(
      normalizeProfileForm(
        profileForm({ nickname: 'fan', avatar: new File([], 'empty.png', { type: 'image/png' }) }),
      ),
    ).toEqual({
      ok: true,
      value: { nickname: 'fan', avatar: null },
    });
  });
});

describe('profile module loading', () => {
  it('can import client-safe constants when Intl.Segmenter is unavailable', () => {
    const profileModuleUrl = new URL('./profile.ts', import.meta.url).href;
    const script = `
      Object.defineProperty(Intl, 'Segmenter', { value: undefined });
      const profile = await import(${JSON.stringify(profileModuleUrl)});
      if (profile.PROFILE_IMAGE_ACCEPT !== 'image/jpeg,image/png,image/webp') process.exit(1);
    `;

    expect(() =>
      execFileSync(
        process.execPath,
        ['--experimental-strip-types', '--input-type=module', '--eval', script],
        { stdio: 'pipe' },
      ),
    ).not.toThrow();
  });
});
