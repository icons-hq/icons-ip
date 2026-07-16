import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  createClient: vi.fn(),
  createSignedUrl: vi.fn(),
  storageFrom: vi.fn(),
}));

vi.mock('server-only', () => ({}));
vi.mock('@/lib/supabase/server', () => ({ createClient: mocks.createClient }));
vi.mock('@/lib/profile', async () => await import('./profile'));

import { getProfileAvatarPresentation } from './profile-avatar.server';

const avatarPath =
  '00000000-0000-4000-8000-000000001201/profile/22222222-2222-4222-8222-222222222222.png';

beforeEach(() => {
  mocks.createClient.mockReset();
  mocks.createSignedUrl.mockReset();
  mocks.storageFrom.mockReset();
  mocks.storageFrom.mockReturnValue({ createSignedUrl: mocks.createSignedUrl });
  mocks.createClient.mockResolvedValue({ storage: { from: mocks.storageFrom } });
  mocks.createSignedUrl.mockResolvedValue({
    data: { signedUrl: 'https://signed.example/avatar.png' },
    error: null,
  });
});

describe('getProfileAvatarPresentation', () => {
  it('returns the grapheme initial without opening Storage when no avatar exists', async () => {
    await expect(getProfileAvatarPresentation({
      avatarPath: null,
      nickname: '👩‍🎤팬',
    })).resolves.toEqual({ avatarInitial: '👩‍🎤', avatarUrl: null });

    expect(mocks.createClient).not.toHaveBeenCalled();
  });

  it('signs the private profile avatar for one hour', async () => {
    await expect(getProfileAvatarPresentation({
      avatarPath,
      nickname: '아이콘즈 팬',
    })).resolves.toEqual({
      avatarInitial: '아',
      avatarUrl: 'https://signed.example/avatar.png',
    });

    expect(mocks.storageFrom).toHaveBeenCalledWith('user-uploads');
    expect(mocks.createSignedUrl).toHaveBeenCalledWith(avatarPath, 3600);
  });

  it.each([
    ['returns an error', () => mocks.createSignedUrl.mockResolvedValue({ data: null, error: { message: 'failed' } })],
    ['rejects', () => mocks.createSignedUrl.mockRejectedValue(new Error('rejected'))],
    ['throws synchronously', () => mocks.createSignedUrl.mockImplementation(() => { throw new Error('thrown'); })],
  ])('keeps the initial and drops the URL when signing %s', async (_label, arrange) => {
    arrange();

    await expect(getProfileAvatarPresentation({
      avatarPath,
      nickname: '',
    })).resolves.toEqual({ avatarInitial: 'I', avatarUrl: null });
  });
});
