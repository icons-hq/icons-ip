import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanupProfileAvatar, updateProfileIdentity } from './profile.server';

const mocks = vi.hoisted(() => ({
  auditInsert: vi.fn(),
  createClient: vi.fn(),
  createServiceClient: vi.fn(),
  serviceFrom: vi.fn(),
  serviceRemove: vi.fn(),
  serviceRpc: vi.fn(),
  serviceStorageFrom: vi.fn(),
  userRemove: vi.fn(),
  userStorageFrom: vi.fn(),
}));

vi.mock('server-only', () => ({}));
vi.mock('@/lib/profile', async () => await import('./profile'));
vi.mock('@/lib/supabase/server', () => ({ createClient: mocks.createClient }));
vi.mock('@/lib/supabase/service', () => ({
  createServiceClient: mocks.createServiceClient,
}));

const USER_ID = '00000000-0000-4000-8000-000000001201';
const AVATAR_PATH = `${USER_ID}/profile/22222222-2222-4222-8222-222222222222.webp`;
const PREVIOUS_AVATAR_PATH = `${USER_ID}/profile/11111111-1111-4111-8111-111111111111.jpg`;

beforeEach(() => {
  mocks.auditInsert.mockReset();
  mocks.createClient.mockReset();
  mocks.createServiceClient.mockReset();
  mocks.serviceFrom.mockReset();
  mocks.serviceRemove.mockReset();
  mocks.serviceRpc.mockReset();
  mocks.serviceStorageFrom.mockReset();
  mocks.userRemove.mockReset();
  mocks.userStorageFrom.mockReset();

  mocks.userRemove.mockResolvedValue({ data: [], error: null });
  mocks.serviceRemove.mockResolvedValue({ data: [], error: null });
  mocks.auditInsert.mockResolvedValue({ data: null, error: null });
  mocks.serviceRpc.mockResolvedValue({
    data: [{ previous_avatar_path: PREVIOUS_AVATAR_PATH }],
    error: null,
  });
  mocks.userStorageFrom.mockImplementation((bucket: string) => {
    if (bucket !== 'user-uploads') throw new Error(`Unexpected bucket ${bucket}`);
    return { remove: mocks.userRemove };
  });
  mocks.serviceStorageFrom.mockImplementation((bucket: string) => {
    if (bucket !== 'user-uploads') throw new Error(`Unexpected bucket ${bucket}`);
    return { remove: mocks.serviceRemove };
  });
  mocks.serviceFrom.mockImplementation((table: string) => {
    if (table !== 'audit_log') throw new Error(`Unexpected table ${table}`);
    return { insert: mocks.auditInsert };
  });
  mocks.createClient.mockResolvedValue({
    storage: { from: mocks.userStorageFrom },
  });
  mocks.createServiceClient.mockReturnValue({
    from: mocks.serviceFrom,
    rpc: mocks.serviceRpc,
    storage: { from: mocks.serviceStorageFrom },
  });
});

describe('updateProfileIdentity', () => {
  it('calls the service-only RPC with exact inputs and returns the locked previous path', async () => {
    await expect(updateProfileIdentity({
      userId: USER_ID,
      nickname: '새 닉네임',
      avatarPath: AVATAR_PATH,
      replaceAvatar: true,
    })).resolves.toEqual({ ok: true, previousAvatarPath: PREVIOUS_AVATAR_PATH });

    expect(mocks.serviceRpc).toHaveBeenCalledWith('service_update_profile_identity', {
      p_user_id: USER_ID,
      p_nickname: '새 닉네임',
      p_avatar_path: AVATAR_PATH,
      p_replace_avatar: true,
    });
  });

  it('accepts a null previous path but rejects malformed RPC data', async () => {
    mocks.serviceRpc.mockResolvedValueOnce({
      data: [{ previous_avatar_path: null }],
      error: null,
    });
    await expect(updateProfileIdentity({
      userId: USER_ID,
      nickname: 'fan',
      avatarPath: null,
      replaceAvatar: false,
    })).resolves.toEqual({ ok: true, previousAvatarPath: null });

    mocks.serviceRpc.mockResolvedValueOnce({ data: [], error: null });
    await expect(updateProfileIdentity({
      userId: USER_ID,
      nickname: 'fan',
      avatarPath: null,
      replaceAvatar: false,
    })).resolves.toEqual({ ok: false });
  });

  it('exposes only the 23505 code and never the raw RPC error', async () => {
    mocks.serviceRpc.mockResolvedValue({
      data: null,
      error: { code: '23505', message: 'private duplicate detail' },
    });

    const result = await updateProfileIdentity({
      userId: USER_ID,
      nickname: 'taken',
      avatarPath: null,
      replaceAvatar: false,
    });

    expect(result).toEqual({ ok: false, errorCode: '23505' });
    expect(JSON.stringify(result)).not.toContain('private duplicate detail');
  });

  it('turns RPC rejection into a generic failure without leaking its message', async () => {
    mocks.serviceRpc.mockRejectedValue(new Error('private provider rejection'));

    const result = await updateProfileIdentity({
      userId: USER_ID,
      nickname: 'fan',
      avatarPath: null,
      replaceAvatar: false,
    });

    expect(result).toEqual({ ok: false });
    expect(JSON.stringify(result)).not.toContain('private provider rejection');
  });
});

describe('cleanupProfileAvatar', () => {
  it('does nothing for a path outside the exact user profile contract', async () => {
    await expect(cleanupProfileAvatar({
      userId: USER_ID,
      path: `${USER_ID}/community/22222222-2222-4222-8222-222222222222.webp`,
      stage: 'candidate',
    })).resolves.toBeUndefined();

    expect(mocks.createClient).not.toHaveBeenCalled();
    expect(mocks.createServiceClient).not.toHaveBeenCalled();
  });

  it('stops after successful user-session cleanup', async () => {
    await cleanupProfileAvatar({ userId: USER_ID, path: AVATAR_PATH, stage: 'previous' });

    expect(mocks.userRemove).toHaveBeenCalledWith([AVATAR_PATH]);
    expect(mocks.createServiceClient).not.toHaveBeenCalled();
  });

  it('retries the exact same path with the service client after a resolved user error', async () => {
    mocks.userRemove.mockResolvedValue({
      data: null,
      error: { message: 'private user cleanup error' },
    });

    await cleanupProfileAvatar({ userId: USER_ID, path: AVATAR_PATH, stage: 'candidate' });

    expect(mocks.serviceRemove).toHaveBeenCalledWith([AVATAR_PATH]);
    expect(mocks.auditInsert).not.toHaveBeenCalled();
  });

  it('retries with the service client when user cleanup rejects', async () => {
    mocks.userRemove.mockRejectedValue(new Error('private user rejection'));

    await cleanupProfileAvatar({ userId: USER_ID, path: AVATAR_PATH, stage: 'candidate' });

    expect(mocks.serviceRemove).toHaveBeenCalledWith([AVATAR_PATH]);
    expect(mocks.auditInsert).not.toHaveBeenCalled();
  });

  it('audits actor, path, and stage only when both cleanup attempts fail', async () => {
    mocks.userRemove.mockResolvedValue({
      data: null,
      error: { message: 'private user cleanup error' },
    });
    mocks.serviceRemove.mockRejectedValue(new Error('private service cleanup rejection'));

    await cleanupProfileAvatar({ userId: USER_ID, path: AVATAR_PATH, stage: 'previous' });

    expect(mocks.auditInsert).toHaveBeenCalledOnce();
    expect(mocks.auditInsert).toHaveBeenCalledWith({
      actor_id: USER_ID,
      action: 'profile_avatar_cleanup_failed',
      target: AVATAR_PATH,
      diff: { stage: 'previous' },
    });
    const auditPayload = JSON.stringify(mocks.auditInsert.mock.calls[0]);
    expect(auditPayload).not.toContain('private user cleanup error');
    expect(auditPayload).not.toContain('private service cleanup rejection');
  });

  it('never throws when the best-effort audit insert also rejects', async () => {
    mocks.userRemove.mockRejectedValue(new Error('user failed'));
    mocks.serviceRemove.mockRejectedValue(new Error('service failed'));
    mocks.auditInsert.mockRejectedValue(new Error('audit failed'));

    await expect(cleanupProfileAvatar({
      userId: USER_ID,
      path: AVATAR_PATH,
      stage: 'candidate',
    })).resolves.toBeUndefined();
  });
});
