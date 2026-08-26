import type { EntryDirectorPhase } from '@/lib/prototypes/last-bell/entry-director';
import type { LastBellRooftopPhase, LastBellZombieVariant, ZoneId } from '@/lib/prototypes/last-bell/runtime/types';
import {
  LAST_BELL_CAMPAIGN_NAMRA_ASSET,
  LAST_BELL_CAMPAIGN_ROUTE_ASSETS,
  LAST_BELL_CAMPAIGN_ROUTE_ZONES,
  LAST_BELL_CAMPAIGN_ZOMBIE_ASSETS,
  type LastBellCampaignRouteZone,
} from './campaignAssets';

export type LastBellCampaignAssetKey =
  | `route:${LastBellCampaignRouteZone}`
  | `zombie:${LastBellZombieVariant}`
  | 'namra:rooftop';

const PORTAL_TARGETS: Readonly<Record<ZoneId, readonly ZoneId[]>> = {
  classroom: ['corridor'],
  corridor: ['infirmary', 'broadcast', 'utility'],
  infirmary: ['corridor'],
  broadcast: ['corridor'],
  utility: ['stairwell'],
  stairwell: ['rooftop'],
  rooftop: [],
};

// Detours share a progress rank because both portals return to the corridor.
const ZONE_PROGRESS_RANK: Readonly<Record<ZoneId, number>> = {
  classroom: 0,
  corridor: 1,
  infirmary: 2,
  broadcast: 2,
  utility: 3,
  stairwell: 4,
  rooftop: 5,
};

function isRouteZone(zone: ZoneId): zone is LastBellCampaignRouteZone {
  return (LAST_BELL_CAMPAIGN_ROUTE_ZONES as readonly string[]).includes(zone);
}

function unique<T>(values: readonly T[]): T[] {
  return [...new Set(values)];
}

export type LastBellCampaignStreamingPlan = Readonly<{
  criticalZones: readonly ZoneId[];
  prefetchZones: readonly ZoneId[];
  releaseZones: readonly ZoneId[];
  requestedRouteZones: readonly LastBellCampaignRouteZone[];
  requestedZombieVariants: readonly LastBellZombieVariant[];
  requestedNamra: boolean;
  requestedAssets: readonly LastBellCampaignAssetKey[];
  requestedUrls: readonly string[];
}>;

/**
 * Decides the exact request set without touching React or Three. A zone asset
 * is retained only while it is current or reachable through the next portal;
 * entries that fall out of that set release their cache reference and dispose
 * their GPU resources. `releaseZones` records the two-progress-step boundary
 * for operational assertions and future telemetry.
 */
export function planLastBellCampaignStreaming(input: Readonly<{
  entryPhase: EntryDirectorPhase;
  zoneId: ZoneId;
  liveZombieCount: number;
  liveZombieVariants?: readonly LastBellZombieVariant[];
  rooftopPhase: LastBellRooftopPhase;
}>): LastBellCampaignStreamingPlan {
  const criticalZones = [input.zoneId] as const;
  const prefetchZones = PORTAL_TARGETS[input.zoneId];
  const currentRank = ZONE_PROGRESS_RANK[input.zoneId];
  const releaseZones = (Object.keys(ZONE_PROGRESS_RANK) as ZoneId[])
    .filter((zone) => ZONE_PROGRESS_RANK[zone] < currentRank - 1);

  if (input.entryPhase !== 'playing') {
    return {
      criticalZones,
      prefetchZones,
      releaseZones,
      requestedRouteZones: [],
      requestedZombieVariants: [],
      requestedNamra: false,
      requestedAssets: [],
      requestedUrls: [],
    };
  }

  const requestedRouteZones = unique([input.zoneId, ...prefetchZones].filter(isRouteZone));
  // The first authored infected becomes visible immediately after the
  // classroom→corridor portal. Decode that one rig while the player is still
  // in the classroom; later variants remain live-snapshot demand driven.
  const prefetchFirstVisibleZombie = prefetchZones.includes('corridor');
  const wantsZombies = input.rooftopPhase === 'sealed'
    && (input.liveZombieCount > 0 || prefetchFirstVisibleZombie || prefetchZones.includes('utility'));
  const liveZombieVariants = unique((input.liveZombieVariants ?? []).slice(0, 2));
  // A portal prefetch has no actor snapshot on a resumed run. Keep its prefetch
  // bounded to the same two-actor ceiling instead of loading every variation.
  const requestedZombieVariants = wantsZombies
    ? (liveZombieVariants.length > 0 ? liveZombieVariants : ['uniform-a'] as const)
    : [];
  // Nam-ra is a rooftop-only seam. The rooftop environment can prefetch from
  // the stairwell, but her rig stays deferred until that zone is current.
  const requestedNamra = input.zoneId === 'rooftop' && input.rooftopPhase !== 'black';
  const requestedAssets: LastBellCampaignAssetKey[] = [
    ...requestedRouteZones.map((zone) => `route:${zone}` as const),
    ...requestedZombieVariants.map((variant) => `zombie:${variant}` as const),
    ...(requestedNamra ? ['namra:rooftop' as const] : []),
  ];
  const requestedUrls = [
    ...requestedRouteZones.map((zone) => LAST_BELL_CAMPAIGN_ROUTE_ASSETS[zone]),
    ...requestedZombieVariants.map((variant) => LAST_BELL_CAMPAIGN_ZOMBIE_ASSETS[variant]),
    ...(requestedNamra ? [LAST_BELL_CAMPAIGN_NAMRA_ASSET] : []),
  ];

  return {
    criticalZones,
    prefetchZones,
    releaseZones,
    requestedRouteZones,
    requestedZombieVariants,
    requestedNamra,
    requestedAssets,
    requestedUrls,
  };
}

type CacheEntry<Value> = {
  references: number;
  promise: Promise<Value>;
  value?: Value;
};

/**
 * A failed request is removed before its rejection reaches callers. This is
 * intentionally not a forever cache: a later acquire is a real retry.
 */
export function createRecoverableAssetCache<Key, Value>(
  load: (key: Key) => Promise<Value>,
  dispose: (value: Value) => void = () => undefined,
) {
  const entries = new Map<Key, CacheEntry<Value>>();

  const acquire = (key: Key): Promise<Value> => {
    let entry = entries.get(key);
    if (!entry) {
      const next: CacheEntry<Value> = {
        references: 0,
        promise: Promise.resolve().then(() => load(key)),
      };
      entries.set(key, next);
      void next.promise.then(
        (value) => {
          if (entries.get(key) !== next) {
            dispose(value);
            return;
          }
          next.value = value;
        },
        () => {
          if (entries.get(key) === next) entries.delete(key);
        },
      );
      entry = next;
    }
    entry.references += 1;
    return entry.promise;
  };

  const release = (key: Key) => {
    const entry = entries.get(key);
    if (!entry) return;
    entry.references -= 1;
    if (entry.references > 0) return;
    entries.delete(key);
    if (entry.value) dispose(entry.value);
    else void entry.promise.then(dispose, () => undefined);
  };

  return {
    acquire,
    release,
    isCached: (key: Key) => entries.has(key),
  };
}
