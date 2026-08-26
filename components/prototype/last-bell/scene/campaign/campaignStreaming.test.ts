import { describe, expect, it } from 'vitest';
import {
  LAST_BELL_CAMPAIGN_NAMRA_ASSET,
  LAST_BELL_CAMPAIGN_ROUTE_ASSETS,
  LAST_BELL_CAMPAIGN_ZOMBIE_ASSETS,
} from './campaignAssets';
import {
  createRecoverableAssetCache,
  planLastBellCampaignStreaming,
} from './campaignStreaming';

describe('Last Bell campaign asset streaming', () => {
  it('does not request campaign bytes before entry, then requests only the current route and next portal routes', () => {
    const preflight = planLastBellCampaignStreaming({
      entryPhase: 'preflight',
      zoneId: 'classroom',
      liveZombieCount: 0,
      rooftopPhase: 'sealed',
    });
    expect(preflight.criticalZones).toEqual(['classroom']);
    expect(preflight.prefetchZones).toEqual(['corridor']);
    expect(preflight.requestedUrls).toEqual([]);

    const classroom = planLastBellCampaignStreaming({
      entryPhase: 'playing',
      zoneId: 'classroom',
      liveZombieCount: 0,
      rooftopPhase: 'sealed',
    });
    // The first visible infected must already be decoded before the classroom
    // portal is crossed; later variants remain demand-driven.
    expect(classroom.requestedUrls).toEqual([
      LAST_BELL_CAMPAIGN_ROUTE_ASSETS.corridor,
      LAST_BELL_CAMPAIGN_ZOMBIE_ASSETS['uniform-a'],
    ]);

    const corridor = planLastBellCampaignStreaming({
      entryPhase: 'playing',
      zoneId: 'corridor',
      liveZombieCount: 1,
      liveZombieVariants: ['uniform-a'],
      rooftopPhase: 'sealed',
    });
    expect(corridor.requestedRouteZones).toEqual(['corridor', 'infirmary', 'broadcast', 'utility']);
    expect(corridor.requestedUrls).toEqual([
      LAST_BELL_CAMPAIGN_ROUTE_ASSETS.corridor,
      LAST_BELL_CAMPAIGN_ROUTE_ASSETS.infirmary,
      LAST_BELL_CAMPAIGN_ROUTE_ASSETS.broadcast,
      LAST_BELL_CAMPAIGN_ROUTE_ASSETS.utility,
      LAST_BELL_CAMPAIGN_ZOMBIE_ASSETS['uniform-a'],
    ]);
    expect(corridor.requestedUrls).not.toContain(LAST_BELL_CAMPAIGN_ROUTE_ASSETS.stairwell);
    expect(corridor.requestedUrls).not.toContain(LAST_BELL_CAMPAIGN_ROUTE_ASSETS.rooftop);
    expect(corridor.requestedUrls).not.toContain(LAST_BELL_CAMPAIGN_NAMRA_ASSET);
  });

  it('releases the two-zones-behind route leases and disposes their decoded GPU assets', async () => {
    const loaded: string[] = [];
    const disposed: string[] = [];
    const cache = createRecoverableAssetCache(async (url: string) => {
      loaded.push(url);
      return url;
    }, (url) => disposed.push(url));
    const active = new Set<string>();
    const reconcile = async (urls: readonly string[]) => {
      const next = new Set(urls);
      for (const url of active) {
        if (!next.has(url)) {
          cache.release(url);
          active.delete(url);
        }
      }
      await Promise.all([...next].filter((url) => !active.has(url)).map(async (url) => {
        active.add(url);
        await cache.acquire(url);
      }));
    };
    const corridor = planLastBellCampaignStreaming({
      entryPhase: 'playing',
      zoneId: 'corridor',
      liveZombieCount: 1,
      liveZombieVariants: ['uniform-a'],
      rooftopPhase: 'sealed',
    });
    await reconcile(corridor.requestedUrls);
    expect(loaded).toEqual(corridor.requestedUrls);

    const stairwell = planLastBellCampaignStreaming({
      entryPhase: 'playing',
      zoneId: 'stairwell',
      liveZombieCount: 0,
      rooftopPhase: 'sealed',
    });
    expect(stairwell.releaseZones).toEqual(['classroom', 'corridor', 'infirmary', 'broadcast']);
    expect(stairwell.requestedRouteZones).toEqual(['stairwell', 'rooftop']);
    expect(stairwell.requestedNamra).toBe(false);
    await reconcile(stairwell.requestedUrls);

    expect(disposed).toEqual(expect.arrayContaining([
      LAST_BELL_CAMPAIGN_ROUTE_ASSETS.corridor,
      LAST_BELL_CAMPAIGN_ROUTE_ASSETS.infirmary,
      LAST_BELL_CAMPAIGN_ROUTE_ASSETS.broadcast,
      LAST_BELL_CAMPAIGN_ROUTE_ASSETS.utility,
      LAST_BELL_CAMPAIGN_ZOMBIE_ASSETS['uniform-a'],
    ]));
    expect([...active]).toEqual(stairwell.requestedUrls);
    for (const url of disposed) expect(cache.isCached(url)).toBe(false);
  });

  it('keeps Nam-ra deferred until the rooftop and never exceeds two zombie source leases', () => {
    const rooftopPrefetch = planLastBellCampaignStreaming({
      entryPhase: 'playing',
      zoneId: 'stairwell',
      liveZombieCount: 3,
      liveZombieVariants: ['uniform-a', 'uniform-b', 'uniform-c'],
      rooftopPhase: 'sealed',
    });
    expect(rooftopPrefetch.requestedNamra).toBe(false);
    expect(rooftopPrefetch.requestedZombieVariants).toEqual(['uniform-a', 'uniform-b']);
    expect(rooftopPrefetch.requestedUrls).not.toContain(LAST_BELL_CAMPAIGN_NAMRA_ASSET);

    const rooftop = planLastBellCampaignStreaming({
      entryPhase: 'playing',
      zoneId: 'rooftop',
      liveZombieCount: 0,
      rooftopPhase: 'approach',
    });
    expect(rooftop.requestedRouteZones).toEqual(['rooftop']);
    expect(rooftop.requestedNamra).toBe(true);
    expect(rooftop.requestedUrls).toEqual([
      LAST_BELL_CAMPAIGN_ROUTE_ASSETS.rooftop,
      LAST_BELL_CAMPAIGN_NAMRA_ASSET,
    ]);
  });

  it('evicts a rejected promise so a later acquire performs a real retry', async () => {
    let attempts = 0;
    const disposed: string[] = [];
    const cache = createRecoverableAssetCache(async () => {
      attempts += 1;
      if (attempts === 1) throw new Error('temporary decode failure');
      return 'decoded-route';
    }, (value) => disposed.push(value));

    await expect(cache.acquire('route')).rejects.toThrow('temporary decode failure');
    expect(cache.isCached('route')).toBe(false);

    await expect(cache.acquire('route')).resolves.toBe('decoded-route');
    expect(attempts).toBe(2);
    cache.release('route');
    expect(disposed).toEqual(['decoded-route']);
  });
});
