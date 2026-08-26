import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getAccountDeletionPresentation,
  getCurrentAccountDeletionWriteFenceState,
} from './account-deletion.server';

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

  it.each([
    [
      { data: null, error: { message: 'private preview error' } },
      {
        data: {
          status: 'processing', phase: 'awaiting_notification',
          nextAction: 'retry_later', blockers: [],
        },
        error: null,
      },
    ],
    [
      { data: { available: true, eligible: true, blockers: [] }, error: null },
      { data: null, error: { message: 'private status error' } },
    ],
  ])('fails the whole presentation closed when either database read errors', async (
    previewResult,
    statusResult,
  ) => {
    mocks.rpc
      .mockResolvedValueOnce(previewResult)
      .mockResolvedValueOnce(statusResult);

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

describe('getCurrentAccountDeletionWriteFenceState', () => {
  beforeEach(() => {
    mocks.createClient.mockReset();
    mocks.rpc.mockReset();
    mocks.createClient.mockResolvedValue({ rpc: mocks.rpc });
  });

  it('permits only the exact public not-requested status returned by the self RPC', async () => {
    mocks.rpc.mockResolvedValue({
      data: { status: 'not_requested', phase: 'none', nextAction: '/settings', blockers: [] },
      error: null,
    });

    await expect(getCurrentAccountDeletionWriteFenceState()).resolves.toBe('clear');
    expect(mocks.rpc).toHaveBeenCalledWith('get_my_account_deletion_status');
  });

  it.each([
    { status: 'blocked', phase: 'fenced', nextAction: '/settings', blockers: [{ code: 'not_available', count: 1, path: '/settings' }] },
    { status: 'processing', phase: 'awaiting_notification', nextAction: 'retry_later', blockers: [] },
    { status: 'not_requested', phase: 'none', nextAction: '/settings', blockers: 'not-an-array' },
  ])('treats non-clear or malformed public deletion status as a write fence', async (data) => {
    mocks.rpc.mockResolvedValue({ data, error: null });
    await expect(getCurrentAccountDeletionWriteFenceState()).resolves.toBe('fenced');
  });

  it('fails closed when the self-scoped status RPC is unavailable', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message: 'rpc unavailable' } });
    await expect(getCurrentAccountDeletionWriteFenceState()).resolves.toBe('unavailable');
  });
});
