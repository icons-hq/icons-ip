import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CurrentAuthState } from '@/lib/auth/server';
import { openDrawTicketAction } from './actions';

const mocks = vi.hoisted(() => ({
  auth: null as unknown as CurrentAuthState,
  enabled: true,
  rpc: vi.fn(),
}));

vi.mock('@/lib/auth/server', () => ({ getCurrentAuthState: () => mocks.auth }));
vi.mock('@/lib/supabase/config', () => ({ getSupabaseConfig: () => ({ isConfigured: true }) }));
vi.mock('@/lib/catalog-source', () => ({ resolveCatalogSource: () => 'supabase' }));
vi.mock('@/lib/card-rewards/gate.server', () => ({ readCardRewardsEnabled: () => mocks.enabled }));
vi.mock('@/lib/supabase/server', () => ({ createClient: () => ({ rpc: mocks.rpc }) }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('next/navigation', () => ({
  redirect: (path: string) => {
    throw new Error(`NEXT_REDIRECT:${path}`);
  },
}));

const ticketId = '7ad4c967-3d48-44da-a665-64731ac33f62';

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

describe('openDrawTicketAction', () => {
  beforeEach(() => {
    mocks.auth = onboardedAuth();
    mocks.enabled = true;
    mocks.rpc.mockReset();
    mocks.rpc.mockResolvedValue({
      data: [{ cardId: 'card-1', rarity: 'R', isNew: true }],
      error: null,
    });
  });

  it('fails closed before auth or RPC work while rewards are disabled', async () => {
    mocks.enabled = false;

    await expect(openDrawTicketAction(ticketId)).resolves.toEqual({
      status: 'error',
      code: 'rewards_disabled',
      message: '카드 리워드는 현재 준비 중이에요.',
    });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('redirects a suspended account before opening a draw ticket', async () => {
    mocks.auth = {
      ...onboardedAuth(),
      profile: {
        ...onboardedAuth().profile,
        suspended_at: '2026-07-17T00:00:00.000Z',
      },
    };

    await expect(openDrawTicketAction(ticketId)).rejects.toThrow(
      'NEXT_REDIRECT:/account-suspended',
    );
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('maps a database suspension race to generic account guidance', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message: 'account_suspended' } });

    await expect(openDrawTicketAction(ticketId)).resolves.toEqual({
      status: 'error',
      code: 'account_suspended',
      message: '정지된 계정은 카드팩을 개봉할 수 없어요.',
    });
  });
});
