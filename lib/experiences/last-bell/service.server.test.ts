import { describe, expect, it, vi } from 'vitest';
import { recordVerifiedLastBellEvent, startVerifiedLastBellRun } from './service.server';

describe('verified Last Bell service adapter', () => {
  it('forwards only stable collectible keys to the server RPC', async () => {
    const rpc = vi.fn(async () => ({
      data: { status: 'recorded', sequence: 2, progressStage: 1 },
      error: null,
    }));

    await expect(recordVerifiedLastBellEvent({ rpc }, {
      runId: '00000000-0000-4000-8000-000000000001',
      userId: null,
      guestTokenDigest: 'a'.repeat(64),
      event: {
        sequence: 2,
        operationId: '00000000-0000-4000-8000-000000000002',
        type: 'pickup',
        chapterId: 'chapter-01',
        zoneId: 'classroom',
        objectiveId: null,
        collectibleKey: 'idcard',
        checkpointId: null,
      },
    })).resolves.toEqual({ status: 'recorded', sequence: 2, progressStage: 1 });

    expect(rpc).toHaveBeenCalledWith('last_bell_record_event', expect.objectContaining({
      p_collectible_key: 'idcard',
      p_guest_token_digest: 'a'.repeat(64),
    }));
    expect(rpc).not.toHaveBeenCalledWith('last_bell_record_event', expect.objectContaining({
      p_good_id: expect.anything(),
    }));
  });

  it('rejects malformed server responses instead of inventing a run identity', async () => {
    await expect(startVerifiedLastBellRun({
      rpc: async () => ({ data: { runId: 'not-a-complete-response' }, error: null }),
    }, {
      userId: '00000000-0000-4000-8000-000000000001',
      guestTokenDigest: null,
      start: { startChapterId: 'chapter-01', runMode: 'first-play' },
    })).rejects.toThrow('Last Bell service RPC failed');
  });

  it('preserves a database account fence as an RPC failure for the route boundary to normalize', async () => {
    await expect(startVerifiedLastBellRun({
      rpc: async () => ({ data: null, error: { message: 'account_deletion_write_fenced' } }),
    }, {
      userId: '00000000-0000-4000-8000-000000000001',
      guestTokenDigest: null,
      start: { startChapterId: 'chapter-01', runMode: 'first-play' },
    })).rejects.toMatchObject({ rpcMessage: 'account_deletion_write_fenced' });
  });

  it('restores sequence and progression state when a run is resumed', async () => {
    await expect(startVerifiedLastBellRun({
      rpc: async () => ({
        data: {
          runId: '00000000-0000-4000-8000-000000000001',
          catalogVersion: 'last-bell-v1',
          startChapterId: 'chapter-01',
          runMode: 'chapter-replay',
          resumed: true,
          activeUntil: '2026-08-26T00:00:00.000Z',
          lastSequence: 8,
          progressStage: 6,
          pickedCollectibleKeys: ['idcard', 'candle'],
        },
        error: null,
      }),
    }, {
      userId: '00000000-0000-4000-8000-000000000001',
      guestTokenDigest: null,
      start: { startChapterId: 'chapter-01', runMode: 'chapter-replay' },
    })).resolves.toMatchObject({
      resumed: true,
      runMode: 'chapter-replay',
      lastSequence: 8,
      progressStage: 6,
      pickedCollectibleKeys: ['idcard', 'candle'],
    });
  });
});
