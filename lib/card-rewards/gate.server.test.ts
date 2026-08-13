import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readCardRewardsEnabled } from './gate.server';

const mocks = vi.hoisted(() => ({
  config: { isConfigured: false, url: undefined, key: undefined } as {
    isConfigured: boolean;
    url?: string;
    key?: string;
  },
  rpc: vi.fn(),
  connection: vi.fn(),
}));

vi.mock('@/lib/supabase/config', () => ({
  getSupabaseConfig: () => mocks.config,
}));

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({ rpc: mocks.rpc }),
}));
vi.mock('next/server', () => ({ connection: mocks.connection }));

describe('readCardRewardsEnabled', () => {
  beforeEach(() => {
    mocks.config = { isConfigured: false, url: undefined, key: undefined };
    mocks.rpc.mockReset();
    mocks.connection.mockReset();
  });

  it('fails closed when Supabase is unavailable', async () => {
    await expect(readCardRewardsEnabled()).resolves.toBe(false);
    expect(mocks.connection).toHaveBeenCalledOnce();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('returns true only for an explicit enabled database capability', async () => {
    mocks.config = { isConfigured: true, url: 'https://project.supabase.co', key: 'publishable-key' };
    mocks.rpc.mockResolvedValue({ data: true, error: null });

    await expect(readCardRewardsEnabled()).resolves.toBe(true);
    expect(mocks.rpc).toHaveBeenCalledWith('card_rewards_enabled');

    mocks.rpc.mockResolvedValue({ data: 'true', error: null });
    await expect(readCardRewardsEnabled()).resolves.toBe(false);
  });

  it('fails closed on capability read errors', async () => {
    mocks.config = { isConfigured: true, url: 'https://project.supabase.co', key: 'publishable-key' };
    mocks.rpc.mockResolvedValue({ data: null, error: { message: 'unavailable' } });

    await expect(readCardRewardsEnabled()).resolves.toBe(false);
  });
});
