import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CurrentAuthState } from '@/lib/auth/server';
import { playGameAction } from './actions';

const mocks = vi.hoisted(() => ({
  auth: null as unknown as CurrentAuthState,
  rpc: vi.fn(),
}));

vi.mock('@/lib/auth/server', () => ({ getCurrentAuthState: () => mocks.auth }));
vi.mock('@/lib/supabase/server', () => ({ createClient: () => ({ rpc: mocks.rpc }) }));

function onboardedAuth(): CurrentAuthState {
  return {
    isConfigured: true,
    user: { id: 'user-1', email: 'fan@icons.gg' },
    profile: {
      email: 'fan@icons.gg',
      nickname: 'fan',
      birth_date: '2000-01-01',
      consents: { terms: true, privacy: true },
      onboarded_at: '2026-07-01T00:00:00.000Z',
    },
    isStaff: false,
  };
}

describe('playGameAction', () => {
  beforeEach(() => {
    mocks.auth = onboardedAuth();
    mocks.rpc.mockReset();
  });

  it('rejects a suspended account before game play', async () => {
    mocks.auth = {
      ...onboardedAuth(),
      profile: {
        ...onboardedAuth().profile,
        suspended_at: '2026-07-17T00:00:00.000Z',
      },
    };

    await expect(playGameAction('game-1')).resolves.toEqual({
      ok: false,
      error: 'account_suspended',
    });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('maps a database suspension race without exposing database detail', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message: 'account_suspended' } });

    await expect(playGameAction('game-1')).resolves.toEqual({
      ok: false,
      error: 'account_suspended',
    });
  });
});
