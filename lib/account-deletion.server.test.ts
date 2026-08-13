import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getAccountDeletionPresentation } from './account-deletion.server';

const mocks = vi.hoisted(() => ({
  createClient: vi.fn(),
  rpc: vi.fn(),
}));

vi.mock('@/lib/supabase/server', () => ({ createClient: mocks.createClient }));

describe('getAccountDeletionPresentation', () => {
  beforeEach(() => {
    mocks.createClient.mockReset();
    mocks.rpc.mockReset();
    mocks.createClient.mockResolvedValue({ rpc: mocks.rpc });
  });

  it('reads the preview and opaque self status without selecting private tables', async () => {
    mocks.rpc
      .mockResolvedValueOnce({
        data: { available: true, eligible: true, blockers: [] }, error: null,
      })
      .mockResolvedValueOnce({
        data: {
          status: 'not_requested', phase: 'none', nextAction: '/settings', blockers: [],
        },
        error: null,
      });

    await expect(getAccountDeletionPresentation()).resolves.toEqual({
      preview: { available: true, eligible: true, blockers: [] },
      status: {
        status: 'not_requested', phase: 'none', nextAction: '/settings', blockers: [],
      },
    });
    expect(mocks.rpc.mock.calls).toEqual([
      ['preview_my_account_deletion'],
      ['get_my_account_deletion_status'],
    ]);
  });

  it('fails closed when either database read errors', async () => {
    mocks.rpc
      .mockResolvedValueOnce({ data: null, error: { message: 'private preview error' } })
      .mockResolvedValueOnce({ data: null, error: { message: 'private status error' } });

    await expect(getAccountDeletionPresentation()).resolves.toEqual({
      preview: {
        available: false,
        eligible: false,
        blockers: [{ code: 'not_available', count: 1, path: '/settings' }],
      },
      status: {
        status: 'not_requested', phase: 'none', nextAction: '/settings', blockers: [],
      },
    });
  });
});
