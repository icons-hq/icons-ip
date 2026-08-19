import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchCardRewardsEnabled } from './gate.client';

const mocks = vi.hoisted(() => ({
  createClient: vi.fn(),
  rpc: vi.fn(),
}));

vi.mock('@/lib/supabase/client', () => ({
  createClient: mocks.createClient,
}));

describe('fetchCardRewardsEnabled', () => {
  beforeEach(() => {
    mocks.createClient.mockReset();
    mocks.rpc.mockReset();
    mocks.createClient.mockReturnValue({ rpc: mocks.rpc });
  });

  it('returns true only for an explicit enabled database capability', async () => {
    mocks.rpc.mockResolvedValueOnce({ data: true, error: null });
    await expect(fetchCardRewardsEnabled()).resolves.toBe(true);

    mocks.rpc.mockResolvedValueOnce({ data: 'true', error: null });
    await expect(fetchCardRewardsEnabled()).resolves.toBe(false);
  });

  it('fails closed when configuration or the capability request fails', async () => {
    mocks.createClient.mockImplementationOnce(() => {
      throw new Error('missing config');
    });
    await expect(fetchCardRewardsEnabled()).resolves.toBe(false);

    mocks.rpc.mockResolvedValueOnce({ data: null, error: { message: 'unavailable' } });
    await expect(fetchCardRewardsEnabled()).resolves.toBe(false);
  });
});
