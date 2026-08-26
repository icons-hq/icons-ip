import type { LastBellZombieVariant } from '@/lib/prototypes/last-bell/runtime/types';

/**
 * Zone-local, independently deliverable campaign assets. Do not point the
 * runtime back at `3d/campaign/two-chapter-route.glb`: its all-route payload
 * defeats the lifetime boundary required for a streamed run.
 */
export const LAST_BELL_CAMPAIGN_3D_ROOT = '/generated/last-bell/3d/' as const;

export const LAST_BELL_CAMPAIGN_ROUTE_ZONES = [
  'corridor', 'infirmary', 'broadcast', 'utility', 'stairwell', 'rooftop',
] as const;
export type LastBellCampaignRouteZone = (typeof LAST_BELL_CAMPAIGN_ROUTE_ZONES)[number];

export const LAST_BELL_CAMPAIGN_ROUTE_ASSETS: Readonly<Record<LastBellCampaignRouteZone, string>> = {
  corridor: `${LAST_BELL_CAMPAIGN_3D_ROOT}routes/corridor.glb`,
  infirmary: `${LAST_BELL_CAMPAIGN_3D_ROOT}routes/infirmary.glb`,
  broadcast: `${LAST_BELL_CAMPAIGN_3D_ROOT}routes/broadcast.glb`,
  utility: `${LAST_BELL_CAMPAIGN_3D_ROOT}routes/utility.glb`,
  stairwell: `${LAST_BELL_CAMPAIGN_3D_ROOT}routes/stairwell.glb`,
  rooftop: `${LAST_BELL_CAMPAIGN_3D_ROOT}routes/rooftop.glb`,
};

/** The first two authored actors are the only simultaneous zombie budget. */
export const LAST_BELL_CAMPAIGN_ZOMBIE_ASSETS: Readonly<Record<LastBellZombieVariant, string>> = {
  'uniform-a': `${LAST_BELL_CAMPAIGN_3D_ROOT}characters/zombie-student.glb`,
  'uniform-b': `${LAST_BELL_CAMPAIGN_3D_ROOT}characters/zombie-athletics.glb`,
  'uniform-c': `${LAST_BELL_CAMPAIGN_3D_ROOT}characters/zombie-staff.glb`,
};

export const LAST_BELL_CAMPAIGN_NAMRA_ASSET = `${LAST_BELL_CAMPAIGN_3D_ROOT}characters/namra-rooftop.glb`;

/**
 * Local-only visual review modes for the private image-based Nam-ra candidate.
 * They are deliberately not a release manifest entry: the development-only
 * route serving the candidate is unavailable in Preview and production.
 */
export const LAST_BELL_QA_NAMRA_HYBRID_MODES = [
  'idle-2p8',
  'idle-6',
  'idle-oblique',
  'recognition-2p8',
  'subdue-2p8',
  'sequence',
] as const;
export type LastBellQaNamraHybridMode = (typeof LAST_BELL_QA_NAMRA_HYBRID_MODES)[number];
export const LAST_BELL_QA_NAMRA_PRIVATE_ASSET = '/api/games/prototype-last-bell/qa/namra-impostor' as const;

/**
 * Route GLBs export in gameplay world coordinates. Keeping this identity map
 * prevents a streamed route from drifting away from the collider/portal seam;
 * opening/classroom remains owned by ChapterOneScene.
 */
export const LAST_BELL_CAMPAIGN_ROUTE_TRANSFORMS: Readonly<Record<LastBellCampaignRouteZone, readonly [number, number, number]>> = {
  corridor: [0, 0, 0],
  infirmary: [0, 0, 0],
  broadcast: [0, 0, 0],
  utility: [0, 0, 0],
  stairwell: [0, 0, 0],
  rooftop: [0, 0, 0],
};

export const LAST_BELL_CAMPAIGN_PERFORMANCE_BUDGET = {
  /**
   * Zone-local route/character delivery, not a forced initial transfer. The
   * target protects mobile streaming while the hard cap leaves enough PBR and
   * silhouette budget for the actual first encounter and rooftop reveal.
   */
  routeCharacterTransferTargetBytes: 20 * 1024 * 1024,
  totalTransferHardCapBytes: 24 * 1024 * 1024,
  /** Whole playable unique set: approved opening, streamable routes/actors, and products. */
  totalUniqueTransferTargetBytes: 55 * 1024 * 1024,
  totalUniqueTransferHardCapBytes: 75 * 1024 * 1024,
  maxLiveZombies: 2,
} as const;

export const LAST_BELL_CAMPAIGN_REQUIRED_NODES = {
  route: ['LOD0_Route', 'Anchor_Main', 'Anchor_Detour', 'Anchor_KitDetour', 'Anchor_Radio', 'Anchor_Power', 'Anchor_Candle', 'Anchor_Namra'],
  zombie: ['Character_Root', 'Armature_Common'],
  namra: ['Character_Root', 'Armature_Common'],
} as const;

export const LAST_BELL_CAMPAIGN_REQUIRED_ANIMATIONS = {
  zombie: ['Patrol', 'Investigate', 'Search', 'Chase', 'Capture'],
  namra: ['Idle_Rooftop', 'Detect_Threat', 'Restrain'],
} as const;
