import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  cleanupProfileAvatar,
  prepareProfileAvatarClaim,
  rejectProfileAvatarClaim,
  updateProfileIdentity,
} from './profile.server';

const mocks = vi.hoisted(() => ({
  createClient: vi.fn(),
  createServiceClient: vi.fn(),
  serviceRemove: vi.fn(),
  serviceRpc: vi.fn(),
  serviceStorageFrom: vi.fn(),
  userRemove: vi.fn(),
  userStorageFrom: vi.fn(),
}));

vi.mock('@/lib/profile', async () => await import('./profile'));
vi.mock('@/lib/supabase/server', () => ({ createClient: mocks.createClient }));
vi.mock('@/lib/supabase/service', () => ({
  createServiceClient: mocks.createServiceClient,
}));

const USER_ID = '00000000-0000-4000-8000-000000001201';
const AVATAR_PATH = `${USER_ID}/profile/22222222-2222-4222-8222-222222222222.webp`;
const PREVIOUS_AVATAR_PATH = `${USER_ID}/profile/11111111-1111-4111-8111-111111111111.jpg`;

beforeEach(() => {
  mocks.createClient.mockReset();
  mocks.createServiceClient.mockReset();
  mocks.serviceRemove.mockReset();
  mocks.serviceRpc.mockReset();
  mocks.serviceStorageFrom.mockReset();
  mocks.userRemove.mockReset();
  mocks.userStorageFrom.mockReset();

  mocks.userRemove.mockResolvedValue({ data: [], error: null });
  mocks.serviceRemove.mockResolvedValue({ data: [], error: null });
  mocks.serviceRpc.mockResolvedValue({
    data: [{
      applied: true,
      cleanup_safe: false,
      error_code: null,
      previous_avatar_path: PREVIOUS_AVATAR_PATH,
    }],
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
  mocks.createClient.mockResolvedValue({
    storage: { from: mocks.userStorageFrom },
  });
  mocks.createServiceClient.mockReturnValue({
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

  it('accepts a null previous path but rejects malformed RPC data without cleanup authority', async () => {
    mocks.serviceRpc.mockResolvedValueOnce({
      data: [{
        applied: true,
        cleanup_safe: false,
        error_code: null,
        previous_avatar_path: null,
      }],
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
    })).resolves.toEqual({ ok: false, cleanupSafe: false });
  });

  it('maps a known rejected claim to one cleanup-safe failure', async () => {
    mocks.serviceRpc.mockResolvedValue({
      data: [{
        applied: false,
        cleanup_safe: true,
        error_code: '23505',
        previous_avatar_path: null,
      }],
      error: null,
    });

    const result = await updateProfileIdentity({
      userId: USER_ID,
      nickname: 'taken',
      avatarPath: AVATAR_PATH,
      replaceAvatar: true,
    });

    expect(result).toEqual({ ok: false, errorCode: '23505', cleanupSafe: true });
  });

  it('never authorizes cleanup for a nickname-only uniqueness failure', async () => {
    mocks.serviceRpc.mockResolvedValue({
      data: [{
        applied: false,
        cleanup_safe: false,
        error_code: '23505',
        previous_avatar_path: null,
      }],
      error: null,
    });

    await expect(updateProfileIdentity({
      userId: USER_ID,
      nickname: 'taken',
      avatarPath: null,
      replaceAvatar: false,
    })).resolves.toEqual({ ok: false, errorCode: '23505', cleanupSafe: false });
  });

  it('maps a replay to a failure that can never authorize candidate cleanup', async () => {
    mocks.serviceRpc.mockResolvedValue({
      data: [{
        applied: false,
        cleanup_safe: false,
        error_code: 'avatar_replayed',
        previous_avatar_path: null,
      }],
      error: null,
    });

    await expect(updateProfileIdentity({
      userId: USER_ID,
      nickname: 'conflicting nickname',
      avatarPath: AVATAR_PATH,
      replaceAvatar: true,
    })).resolves.toEqual({
      ok: false,
      errorCode: 'avatar_replayed',
      cleanupSafe: false,
    });
  });

  it('never turns a provider error into candidate cleanup authority', async () => {
    mocks.serviceRpc.mockResolvedValue({
      data: null,
      error: { code: '23505', message: 'private duplicate detail' },
    });

    const result = await updateProfileIdentity({
      userId: USER_ID,
      nickname: 'taken',
      avatarPath: AVATAR_PATH,
      replaceAvatar: true,
    });

    expect(result).toEqual({ ok: false, errorCode: '23505', cleanupSafe: false });
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

    expect(result).toEqual({ ok: false, cleanupSafe: false });
    expect(JSON.stringify(result)).not.toContain('private provider rejection');
  });
});

describe('prepareProfileAvatarClaim', () => {
  it('registers the exact candidate through the hardened service RPC', async () => {
    mocks.serviceRpc.mockResolvedValue({ data: true, error: null });

    await expect(prepareProfileAvatarClaim({
      userId: USER_ID,
      path: AVATAR_PATH,
    })).resolves.toEqual({ ok: true });

    expect(mocks.serviceRpc).toHaveBeenCalledWith('service_prepare_profile_avatar_claim', {
      p_avatar_path: AVATAR_PATH,
      p_user_id: USER_ID,
    });
  });

  it.each([
    ['a resolved error', () => mocks.serviceRpc.mockResolvedValue({
      data: null,
      error: { message: 'private prepare error' },
    })],
    ['a replay result', () => mocks.serviceRpc.mockResolvedValue({
      data: false,
      error: null,
    })],
    ['a transport rejection', () => mocks.serviceRpc.mockRejectedValue(
      new Error('private prepare rejection'),
    )],
  ])('fails closed for %s', async (_label, arrange) => {
    arrange();

    await expect(prepareProfileAvatarClaim({
      userId: USER_ID,
      path: AVATAR_PATH,
    })).resolves.toEqual({ ok: false });
  });
});

describe('rejectProfileAvatarClaim', () => {
  it('exposes cleanup authority only after the DB rejects a pending claim', async () => {
    mocks.serviceRpc.mockResolvedValue({
      data: [{ cleanup_safe: true, rejected: true }],
      error: null,
    });

    await expect(rejectProfileAvatarClaim({
      userId: USER_ID,
      path: AVATAR_PATH,
    })).resolves.toEqual({ cleanupSafe: true });

    expect(mocks.serviceRpc).toHaveBeenCalledWith('service_reject_profile_avatar_claim', {
      p_avatar_path: AVATAR_PATH,
      p_user_id: USER_ID,
    });
  });

  it.each([
    ['a replay', { data: [{ cleanup_safe: false, rejected: false }], error: null }],
    ['malformed data', { data: [], error: null }],
    ['a provider error', { data: null, error: { message: 'private reject error' } }],
  ])('does not authorize cleanup after %s', async (_label, rpcResult) => {
    mocks.serviceRpc.mockResolvedValue(rpcResult);

    await expect(rejectProfileAvatarClaim({
      userId: USER_ID,
      path: AVATAR_PATH,
    })).resolves.toEqual({ cleanupSafe: false });
  });

  it('does not authorize cleanup after an unknown transport exception', async () => {
    mocks.serviceRpc.mockRejectedValue(new Error('private reject rejection'));

    await expect(rejectProfileAvatarClaim({
      userId: USER_ID,
      path: AVATAR_PATH,
    })).resolves.toEqual({ cleanupSafe: false });
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

  it('removes a profile object only through the service client', async () => {
    await cleanupProfileAvatar({ userId: USER_ID, path: AVATAR_PATH, stage: 'previous' });

    expect(mocks.createClient).not.toHaveBeenCalled();
    expect(mocks.userRemove).not.toHaveBeenCalled();
    expect(mocks.serviceRemove).toHaveBeenCalledWith([AVATAR_PATH]);
    expect(mocks.serviceRpc).not.toHaveBeenCalled();
  });

  it('audits the exact path after a resolved service cleanup error', async () => {
    mocks.serviceRemove.mockResolvedValue({
      data: null,
      error: { message: 'private service cleanup error' },
    });

    await cleanupProfileAvatar({ userId: USER_ID, path: AVATAR_PATH, stage: 'candidate' });

    expect(mocks.serviceRemove).toHaveBeenCalledWith([AVATAR_PATH]);
    expect(mocks.serviceRpc).toHaveBeenCalledWith(
      'service_log_profile_avatar_cleanup_failure',
      {
        p_avatar_path: AVATAR_PATH,
        p_stage: 'candidate',
        p_user_id: USER_ID,
      },
    );
  });

  it('audits the exact path when service cleanup rejects', async () => {
    mocks.serviceRemove.mockRejectedValue(new Error('private service rejection'));

    await cleanupProfileAvatar({ userId: USER_ID, path: AVATAR_PATH, stage: 'candidate' });

    expect(mocks.serviceRemove).toHaveBeenCalledWith([AVATAR_PATH]);
    expect(mocks.serviceRpc).toHaveBeenCalledWith(
      'service_log_profile_avatar_cleanup_failure',
      {
        p_avatar_path: AVATAR_PATH,
        p_stage: 'candidate',
        p_user_id: USER_ID,
      },
    );
  });

  it('sends actor, path, and stage only through the hardened audit RPC', async () => {
    mocks.serviceRemove.mockRejectedValue(new Error('private service cleanup rejection'));

    await cleanupProfileAvatar({ userId: USER_ID, path: AVATAR_PATH, stage: 'previous' });

    expect(mocks.serviceRpc).toHaveBeenCalledOnce();
    expect(mocks.serviceRpc).toHaveBeenCalledWith(
      'service_log_profile_avatar_cleanup_failure',
      {
        p_avatar_path: AVATAR_PATH,
        p_stage: 'previous',
        p_user_id: USER_ID,
      },
    );
    const auditPayload = JSON.stringify(mocks.serviceRpc.mock.calls[0]);
    expect(auditPayload).not.toContain('private service cleanup rejection');
  });

  it('never throws when the best-effort audit RPC also rejects', async () => {
    mocks.serviceRemove.mockRejectedValue(new Error('service failed'));
    mocks.serviceRpc.mockRejectedValue(new Error('audit failed'));

    await expect(cleanupProfileAvatar({
      userId: USER_ID,
      path: AVATAR_PATH,
      stage: 'candidate',
    })).resolves.toBeUndefined();
  });
});
