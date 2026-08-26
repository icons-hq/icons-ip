import { afterEach, describe, expect, it, vi } from 'vitest';
import { LastBellSimulation } from '@/lib/prototypes/last-bell/runtime/simulation';
import { LocalRunHost, resolveLastBellRunResume, VerifiedRunHost } from './LastBellRunHost';

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('Last Bell run hosts', () => {
  it('returns the local chapter contract without creating a purchase authority', async () => {
    const host = new LocalRunHost();
    await expect(host.start('chapter-02', 'chapter-replay')).resolves.toMatchObject({
      startChapterId: 'chapter-02',
      runMode: 'chapter-replay',
      resumed: false,
      progressStage: 6,
      pickedCollectibles: [],
    });
    expect(host.authority).toBe('local-qa');
  });

  it('restores the canonical server chapter, mode, sequence, stage, and only stable pickup keys', async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      void input;
      void init;
      return json({
        runId: '00000000-0000-4000-8000-000000000001',
        startChapterId: 'chapter-01',
        runMode: 'first-play',
        resumed: true,
        lastSequence: 8,
        progressStage: 7,
        pickedCollectibleKeys: ['idcard', 'not-a-product'],
      });
    });
    vi.stubGlobal('fetch', fetchMock);

    const host = new VerifiedRunHost();
    await expect(host.start('chapter-02', 'chapter-replay')).resolves.toEqual({
      runId: '00000000-0000-4000-8000-000000000001',
      startChapterId: 'chapter-01',
      runMode: 'first-play',
      resumed: true,
      progressStage: 7,
      pickedCollectibles: ['idcard'],
    });
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toEqual({
      startChapterId: 'chapter-02',
      runMode: 'chapter-replay',
    });
  });

  it('preserves server purchase availability when loading verified inventory', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({
      items: [
        {
          collectibleKey: 'idcard',
          goodId: 'last-bell-idcard',
          validUntil: '2026-08-25T00:00:00.000Z',
          isPurchasable: false,
        },
        {
          collectibleKey: 'candle',
          goodId: 'last-bell-candle',
          validUntil: '2026-09-25T00:00:00.000Z',
          isPurchasable: true,
        },
      ],
    })));

    await expect(new VerifiedRunHost().loadInventory()).resolves.toEqual([
      {
        collectibleKey: 'idcard',
        goodId: 'last-bell-idcard',
        validUntil: '2026-08-25T00:00:00.000Z',
        isPurchasable: false,
      },
      {
        collectibleKey: 'candle',
        goodId: 'last-bell-candle',
        validUntil: '2026-09-25T00:00:00.000Z',
        isPurchasable: true,
      },
    ]);
  });

  it('serializes accepted events before completion and never sends a good id', async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      void init;
      const url = String(input);
      if (url.endsWith('/runs')) return json({
        runId: '00000000-0000-4000-8000-000000000001',
        startChapterId: 'chapter-01',
        runMode: 'first-play',
        resumed: false,
        lastSequence: 0,
        progressStage: 0,
        pickedCollectibleKeys: [],
      });
      if (url.endsWith('/events')) return json({ status: 'recorded', sequence: 1, progressStage: 1 });
      if (url.endsWith('/complete')) return json({ status: 'completed', claimUntil: '2026-09-01T00:00:00.000Z' });
      return json({ error: { code: 'unexpected' } }, 500);
    });
    vi.stubGlobal('fetch', fetchMock);

    const host = new VerifiedRunHost();
    await host.start('chapter-01', 'first-play');
    const snapshot = new LastBellSimulation().snapshot();
    host.record({ type: 'objective', chapterId: 'chapter-01', objectiveId: 'ch1.cross-and-lock-classroom-door', atSeconds: 18 }, snapshot);
    host.record({ type: 'objective', chapterId: 'chapter-01', objectiveId: 'ch1.open-classroom-door', atSeconds: 0 }, snapshot);
    await host.complete();

    const urls = fetchMock.mock.calls.map(([input]) => String(input));
    expect(urls).toEqual([
      '/api/experiences/last-bell/runs',
      '/api/experiences/last-bell/runs/00000000-0000-4000-8000-000000000001/events',
      '/api/experiences/last-bell/runs/00000000-0000-4000-8000-000000000001/complete',
    ]);
    const eventBody = JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body));
    expect(eventBody).toMatchObject({ sequence: 1, type: 'objective', objectiveId: 'ch1.open-classroom-door' });
    expect(eventBody).not.toHaveProperty('goodId');
    expect(eventBody).not.toHaveProperty('good_id');
  });

  it('sends the rooftop-side authored zone for the rooftop door objective, not the stale stairwell snapshot', async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      void init;
      const url = String(input);
      if (url.endsWith('/runs')) return json({
        runId: '00000000-0000-4000-8000-000000000009',
        startChapterId: 'chapter-02',
        runMode: 'chapter-replay',
        resumed: false,
        lastSequence: 0,
        progressStage: 8,
        pickedCollectibleKeys: [],
      });
      if (url.endsWith('/events')) return json({ status: 'recorded', sequence: 1, progressStage: 9 });
      if (url.endsWith('/complete')) return json({ status: 'completed', claimUntil: '2026-09-01T00:00:00.000Z' });
      return json({ error: { code: 'unexpected' } }, 500);
    });
    vi.stubGlobal('fetch', fetchMock);

    const host = new VerifiedRunHost();
    await host.start('chapter-02', 'chapter-replay');
    const stairwellSnapshot = new LastBellSimulation({ chapterId: 'chapter-02', runMode: 'chapter-replay', progressStage: 8 }).snapshot();
    expect(stairwellSnapshot.zoneId).toBe('stairwell');
    host.record({
      type: 'objective', chapterId: 'chapter-02', objectiveId: 'ch2.approach-namra', zoneId: 'rooftop', atSeconds: 35,
    }, stairwellSnapshot);
    await host.complete();

    const eventCall = fetchMock.mock.calls.find(([input]) => String(input).endsWith('/events'));
    expect(JSON.parse(String(eventCall?.[1]?.body))).toMatchObject({
      type: 'objective', objectiveId: 'ch2.approach-namra', chapterId: 'chapter-02', zoneId: 'rooftop',
    });
  });

  it('keeps renderer-only infection foreshadowing out of the verified-run event API', async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      void init;
      const url = String(input);
      if (url.endsWith('/runs')) return json({
        runId: '00000000-0000-4000-8000-000000000010', startChapterId: 'chapter-01', runMode: 'first-play',
        resumed: false, lastSequence: 0, progressStage: 0, pickedCollectibleKeys: [],
      });
      return json({ error: { code: 'unexpected' } }, 500);
    });
    vi.stubGlobal('fetch', fetchMock);

    const host = new VerifiedRunHost();
    await host.start('chapter-01', 'first-play');
    host.record({ type: 'foreshadowing', chapterId: 'chapter-01', cue: 'rapid-recovery', atSeconds: 425 }, new LastBellSimulation().snapshot());
    await Promise.resolve();

    expect(fetchMock.mock.calls.filter(([input]) => String(input).endsWith('/events'))).toHaveLength(0);
    expect(host.status()).toMatchObject({ state: 'active' });
  });

  it('resolves a verified Chapter 2 replay terminal stage as a complete result instead of remounting a spinner', () => {
    expect(resolveLastBellRunResume({
      runId: '00000000-0000-4000-8000-000000000011',
      startChapterId: 'chapter-02',
      runMode: 'chapter-replay',
      resumed: true,
      progressStage: 11,
      pickedCollectibles: ['candle', 'blanket'],
    })).toEqual({ restoredChapter: 'chapter-02', terminal: 'game-complete' });
  });

  it('keeps a failed head event blocked when a later runtime event is recorded', async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      void init;
      const url = String(input);
      if (url.endsWith('/runs')) return json({
        runId: '00000000-0000-4000-8000-000000000021', startChapterId: 'chapter-01', runMode: 'first-play',
        resumed: false, lastSequence: 0, progressStage: 0, pickedCollectibleKeys: [],
      });
      if (url.endsWith('/events')) return json({ error: { code: 'run_progression_too_fast' } }, 409);
      return json({ error: { code: 'unexpected' } }, 500);
    });
    vi.stubGlobal('fetch', fetchMock);

    const host = new VerifiedRunHost();
    await host.start('chapter-01', 'first-play');
    const snapshot = new LastBellSimulation().snapshot();
    host.record({ type: 'objective', chapterId: 'chapter-01', objectiveId: 'ch1.open-classroom-door', atSeconds: 0 }, snapshot);
    await vi.waitFor(() => expect(host.status()).toMatchObject({ state: 'error', message: 'run_progression_too_fast' }));

    host.record({ type: 'pickup', chapterId: 'chapter-01', collectibleKey: 'idcard', atSeconds: 1 }, snapshot);
    await Promise.resolve();

    const eventCalls = fetchMock.mock.calls.filter(([input]) => String(input).endsWith('/events'));
    expect(eventCalls).toHaveLength(1);
    expect(JSON.parse(String(eventCalls[0]?.[1]?.body))).toMatchObject({ sequence: 1, objectiveId: 'ch1.open-classroom-door' });
    expect(host.status()).toMatchObject({ state: 'error', message: 'run_progression_too_fast' });
  });

  it('serializes the authored archery broadcast detour key and zone without product ids', async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      void init;
      const url = String(input);
      if (url.endsWith('/runs')) return json({
        runId: '00000000-0000-4000-8000-000000000022', startChapterId: 'chapter-01', runMode: 'first-play',
        resumed: false, lastSequence: 0, progressStage: 0, pickedCollectibleKeys: [],
      });
      if (url.endsWith('/events')) return json({ status: 'recorded', sequence: 1, progressStage: 1 });
      if (url.endsWith('/complete')) return json({ status: 'completed', claimUntil: '2026-09-01T00:00:00.000Z' });
      return json({ error: { code: 'unexpected' } }, 500);
    });
    vi.stubGlobal('fetch', fetchMock);

    const host = new VerifiedRunHost();
    await host.start('chapter-01', 'first-play');
    const snapshot = { ...new LastBellSimulation().snapshot(), zoneId: 'broadcast' as const };
    host.record({ type: 'pickup', chapterId: 'chapter-01', collectibleKey: 'archery', atSeconds: 0 }, snapshot);
    await host.complete();

    const eventCall = fetchMock.mock.calls.find(([input]) => String(input).endsWith('/events'));
    expect(JSON.parse(String(eventCall?.[1]?.body))).toMatchObject({
      type: 'pickup', chapterId: 'chapter-01', zoneId: 'broadcast', collectibleKey: 'archery',
    });
  });

  it('retains the same idempotent event payload when a failed sync is retried before completion', async () => {
    let eventAttempts = 0;
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      void init;
      const url = String(input);
      if (url.endsWith('/runs')) return json({
        runId: '00000000-0000-4000-8000-000000000001',
        startChapterId: 'chapter-01',
        runMode: 'first-play',
        resumed: false,
        lastSequence: 0,
        progressStage: 0,
        pickedCollectibleKeys: [],
      });
      if (url.endsWith('/events')) {
        eventAttempts += 1;
        return eventAttempts === 1
          ? json({ error: { code: 'temporary_failure' } }, 503)
          : json({ status: 'recorded', sequence: 1, progressStage: 1 });
      }
      if (url.endsWith('/complete')) return json({ status: 'completed', claimUntil: '2026-09-01T00:00:00.000Z' });
      return json({ error: { code: 'unexpected' } }, 500);
    });
    vi.stubGlobal('fetch', fetchMock);

    const host = new VerifiedRunHost();
    await host.start('chapter-01', 'first-play');
    const snapshot = new LastBellSimulation().snapshot();
    host.record({ type: 'objective', chapterId: 'chapter-01', objectiveId: 'ch1.open-classroom-door', atSeconds: 0 }, snapshot);

    await expect(host.complete()).rejects.toThrow('temporary_failure');
    expect(host.status().state).toBe('error');
    await expect(host.complete()).resolves.toBeUndefined();

    const eventCalls = fetchMock.mock.calls.filter(([input]) => String(input).endsWith('/events'));
    expect(eventCalls).toHaveLength(2);
    expect(eventCalls[0]?.[1]?.body).toBe(eventCalls[1]?.[1]?.body);
    expect(host.status().state).toBe('completed');
  });
});
