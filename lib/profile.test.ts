import { describe, expect, it } from 'vitest';
import {
  MAX_PROFILE_IMAGE_BYTES,
  PROFILE_IMAGE_ACCEPT,
  buildProfileAvatarPath,
  isProfileAvatarPathForUser,
  normalizeProfileForm,
  profileAvatarFolder,
} from './profile';

function profileForm(input: { nickname: string; avatar?: File }) {
  const formData = new FormData();
  formData.set('nickname', input.nickname);
  if (input.avatar) formData.set('avatar', input.avatar);
  return formData;
}

describe('normalizeProfileForm', () => {
  it('trims a valid nickname and accepts no new avatar', () => {
    expect(normalizeProfileForm(profileForm({ nickname: '  새닉네임  ' }))).toEqual({
      ok: true,
      value: { nickname: '새닉네임', avatar: null },
    });
  });

  it('rejects an empty nickname', () => {
    expect(normalizeProfileForm(profileForm({ nickname: '   ' }))).toEqual({
      ok: false,
      errors: { nickname: '닉네임을 입력해주세요.' },
    });
  });

  it('rejects a nickname longer than 30 characters', () => {
    expect(normalizeProfileForm(profileForm({ nickname: '가'.repeat(31) }))).toEqual({
      ok: false,
      errors: { nickname: '닉네임은 30자 이하로 입력해주세요.' },
    });
  });

  it('counts nickname limits by user-visible grapheme clusters', () => {
    expect(normalizeProfileForm(profileForm({ nickname: '😀'.repeat(30) }))).toEqual({
      ok: true,
      value: { nickname: '😀'.repeat(30), avatar: null },
    });
    expect(normalizeProfileForm(profileForm({ nickname: '😀'.repeat(31) }))).toEqual({
      ok: false,
      errors: { nickname: '닉네임은 30자 이하로 입력해주세요.' },
    });
  });

  it('rejects an unsupported avatar type', () => {
    expect(
      normalizeProfileForm(
        profileForm({ nickname: 'fan', avatar: new File(['x'], 'a.svg', { type: 'image/svg+xml' }) }),
      ),
    ).toEqual({
      ok: false,
      errors: { avatar: '아바타는 JPEG, PNG, WebP 형식의 5MB 이하 파일만 업로드할 수 있습니다.' },
    });
  });

  it('rejects an avatar over 5MB', () => {
    const avatar = new File([new Uint8Array(MAX_PROFILE_IMAGE_BYTES + 1)], 'large.png', {
      type: 'image/png',
    });

    expect(normalizeProfileForm(profileForm({ nickname: 'fan', avatar }))).toEqual({
      ok: false,
      errors: { avatar: '아바타는 JPEG, PNG, WebP 형식의 5MB 이하 파일만 업로드할 수 있습니다.' },
    });
  });

  it('treats a zero-byte file as no new avatar', () => {
    expect(
      normalizeProfileForm(
        profileForm({ nickname: 'fan', avatar: new File([], 'empty.png', { type: 'image/png' }) }),
      ),
    ).toEqual({
      ok: true,
      value: { nickname: 'fan', avatar: null },
    });
  });

  it('exports the avatar file input accept contract', () => {
    expect(PROFILE_IMAGE_ACCEPT).toBe('image/jpeg,image/png,image/webp');
  });
});

describe('profile avatar paths', () => {
  it('builds the profile folder and a MIME-derived avatar path', () => {
    expect(profileAvatarFolder('user-1')).toBe('user-1/profile');
    expect(buildProfileAvatarPath({ userId: 'user-1', mimeType: 'image/png', nonce: 'asset-1' })).toBe(
      'user-1/profile/asset-1.png',
    );
  });

  it('rejects unsupported MIME types instead of creating a fallback path', () => {
    expect(() =>
      buildProfileAvatarPath({ userId: 'user-1', mimeType: 'image/svg+xml', nonce: 'asset-1' }),
    ).toThrow(new Error('Unsupported profile image MIME type'));
  });

  it('recognizes only paths inside the requested user profile folder', () => {
    expect(isProfileAvatarPathForUser('user-1/profile/asset-1.png', 'user-1')).toBe(true);
    expect(isProfileAvatarPathForUser('user-2/profile/asset-1.png', 'user-1')).toBe(false);
  });
});
