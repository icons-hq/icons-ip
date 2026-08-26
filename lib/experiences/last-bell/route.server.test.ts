import { describe, expect, it, vi } from 'vitest';
import type { CurrentAuthState } from '@/lib/auth/server';
import { getLastBellWriteIdentity, isSameOriginLastBellMutation } from './route.server';

const mocks = vi.hoisted(() => ({
  auth: null as unknown as CurrentAuthState,
  deletionFence: 'clear' as 'clear' | 'fenced' | 'unavailable',
}));

vi.mock('@/lib/auth/server', () => ({
  getCurrentAuthState: () => mocks.auth,
}));

vi.mock('@/lib/account-deletion.server', () => ({
  getCurrentAccountDeletionWriteFenceState: () => mocks.deletionFence,
}));

function request(origin: string | null, headers: Record<string, string> = {}) {
  return new Request('http://localhost:3127/api/experiences/last-bell/runs', {
    method: 'POST',
    headers: {
      ...(origin ? { origin } : {}),
      ...headers,
    },
  });
}

describe('isSameOriginLastBellMutation', () => {
  it('accepts the browser-facing Host even when the framework canonicalizes request.url', () => {
    expect(isSameOriginLastBellMutation(request('http://127.0.0.1:3127', {
      host: '127.0.0.1:3127',
    }))).toBe(true);
  });

  it('uses the trusted proxy-facing host and protocol when supplied', () => {
    expect(isSameOriginLastBellMutation(request('https://preview.icons.example', {
      host: 'localhost:3000',
      'x-forwarded-host': 'preview.icons.example',
      'x-forwarded-proto': 'https',
    }))).toBe(true);
  });

  it('rejects missing and cross-origin mutations', () => {
    expect(isSameOriginLastBellMutation(request(null, { host: 'icons.example' }))).toBe(false);
    expect(isSameOriginLastBellMutation(request('https://attacker.example', {
      host: 'icons.example',
      'x-forwarded-proto': 'https',
    }))).toBe(false);
  });
});

function onboardedAuth(): CurrentAuthState {
  return {
    isConfigured: true,
    user: { id: '00000000-0000-4000-8000-000000000701', email: 'fan@icons.gg' },
    profile: {
      email: 'fan@icons.gg',
      nickname: 'fan',
      birth_date: '2000-01-01',
      consents: { terms: true, privacy: true },
      onboarded_at: '2026-08-25T00:00:00.000Z',
    },
    isStaff: false,
  };
}

describe('getLastBellWriteIdentity', () => {
  it.each(['fenced', 'unavailable'] as const)('fails closed before the authority RPC when deletion status is %s', async (deletionFence) => {
    mocks.auth = onboardedAuth();
    mocks.deletionFence = deletionFence;
    await expect(getLastBellWriteIdentity()).resolves.toEqual({
      error: { status: 409, code: 'account_deletion_write_fenced' },
    });
    mocks.deletionFence = 'clear';
  });

  it('keeps anonymous story starts available but requires an account for a guest claim', async () => {
    mocks.auth = { isConfigured: true, user: null, profile: null, isStaff: false };

    await expect(getLastBellWriteIdentity()).resolves.toEqual({ userId: null });
    await expect(getLastBellWriteIdentity(true)).resolves.toEqual({
      error: { status: 401, code: 'auth_required' },
    });
  });

  it('rejects suspended and incomplete accounts before a Last Bell authority RPC is called', async () => {
    mocks.auth = {
      ...onboardedAuth(),
      profile: { ...onboardedAuth().profile, suspended_at: '2026-08-25T00:00:00.000Z' },
    };
    await expect(getLastBellWriteIdentity()).resolves.toEqual({
      error: { status: 403, code: 'account_suspended' },
    });

    mocks.auth = { ...onboardedAuth(), profile: null };
    await expect(getLastBellWriteIdentity(true)).resolves.toEqual({
      error: { status: 409, code: 'onboarding_required' },
    });
  });

  it('returns only a verified account identity after the shared write fence passes', async () => {
    mocks.auth = onboardedAuth();
    await expect(getLastBellWriteIdentity(true)).resolves.toEqual({
      userId: '00000000-0000-4000-8000-000000000701',
    });
  });
});
