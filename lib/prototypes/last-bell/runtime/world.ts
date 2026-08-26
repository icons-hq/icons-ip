import type {
  ChapterId,
  CollectibleKey,
  HidingSpotId,
  LastBellInteractionKind,
  LastBellRouteKind,
  LastBellRouteEvidenceId,
  LastBellVec2,
  LastBellZombieVariant,
  ZoneId,
} from './types';

export type LastBellRect = Readonly<{ min: LastBellVec2; max: LastBellVec2 }>;

export type LastBellZoneDefinition = Readonly<{
  id: ZoneId;
  chapterId: ChapterId;
  route: LastBellRouteKind;
  bounds: LastBellRect;
}>;

export type LastBellWorldInteraction = Readonly<{
  id: string;
  kind: LastBellInteractionKind;
  chapterId: ChapterId;
  zoneId: ZoneId;
  route: LastBellRouteKind;
  position: LastBellVec2;
  prompt: string;
  collectibleKey?: CollectibleKey;
  /** Authored one-way exploration time for a real optional side placement. */
  detourSeconds?: number;
}>;

/**
 * Spatial proof seams for the main route. Each source node already belongs to
 * an authored route asset; this contract intentionally does not manufacture a
 * cube, decal, or fallback prop when a DCC export is unavailable.
 */
export type LastBellRouteEvidenceDefinition = Readonly<{
  id: Exclude<LastBellRouteEvidenceId, 'first-bay-cover' | 'fire-door-passage'>;
  chapterId: ChapterId;
  zoneId: ZoneId;
  position: LastBellVec2;
  radius: number;
  semanticNode: string;
}>;

/**
 * Renderer-independent hiding anchors. `semanticNode` is the DCC animation
 * seam, while position/camera/audio keep the simulation and adapters aligned.
 */
export type HidingSpotDefinition = Readonly<{
  id: HidingSpotId;
  interactionId: string;
  semanticNode: string;
  chapterId: ChapterId;
  zoneId: ZoneId;
  position: LastBellVec2;
  entrySeconds: number;
  exitSeconds: number;
  camera: Readonly<{
    offset: LastBellVec2;
    eyeHeightMeters: number;
    yawLimitRadians: number;
    suppressFlashlight: boolean;
  }>;
  audio: Readonly<{ breathCue: string; clothRustleCue: string }>;
}>;

export type EncounterDefinition = Readonly<{
  id: string;
  chapterId: ChapterId;
  trigger:
    | Readonly<{ type: 'chapter-start' }>
    | Readonly<{ type: 'interaction'; interactionId: string }>;
  actors: readonly Readonly<{
    id: string;
    variant: LastBellZombieVariant;
    spawn: LastBellVec2;
    facingRadians: number;
    waypoints: readonly LastBellVec2[];
  }>[];
  audioCue: string;
  hidingSpotIds: readonly HidingSpotId[];
  successExit: Readonly<{ zoneId: ZoneId; minZ: number }>;
}>;

export type LastBellNavNode = Readonly<{ id: string; zoneId: ZoneId; position: LastBellVec2 }>;
export type LastBellNavEdge = Readonly<{ from: string; to: string; doorId?: string }>;

/**
 * Renderer-independent projection of the authored `COL_*` route nodes.
 *
 * These are navigable floor volumes, not convenient gameplay rectangles. The
 * bounds mirror the campaign Blender build: rooms and the rooftop are only
 * reachable through their authored breaches/door portals. Runtime movement
 * shrinks them by the actor radius so an actor cannot put its centre through a
 * visual wall or parapet.
 */
export type LastBellAuthoredCollider = Readonly<{
  id: string;
  sourceAsset: string;
  sourceNode: string;
  zoneId: ZoneId;
  bounds: LastBellRect;
}>;

export const LAST_BELL_CHAPTER_TARGET_SECONDS: Readonly<Record<ChapterId, number>> = {
  'chapter-01': 7 * 60 + 5,
  'chapter-02': 2 * 60 + 55,
};

/**
 * These authored semantic anchors are the contract between the DCC scene and
 * gameplay. A renderer can replace all meshes without moving this data.
 */
export const LAST_BELL_ZONES: readonly LastBellZoneDefinition[] = [
  { id: 'classroom', chapterId: 'chapter-01', route: 'main', bounds: { min: { x: -4, z: 0 }, max: { x: 4, z: 13 } } },
  { id: 'corridor', chapterId: 'chapter-01', route: 'main', bounds: { min: { x: -4, z: 13 }, max: { x: 4, z: 61 } } },
  { id: 'infirmary', chapterId: 'chapter-01', route: 'detour', bounds: { min: { x: 4, z: 27 }, max: { x: 10, z: 38 } } },
  { id: 'broadcast', chapterId: 'chapter-01', route: 'detour', bounds: { min: { x: -10, z: 37 }, max: { x: -4, z: 49 } } },
  { id: 'utility', chapterId: 'chapter-01', route: 'main', bounds: { min: { x: -4, z: 61 }, max: { x: 4, z: 67 } } },
  { id: 'stairwell', chapterId: 'chapter-02', route: 'main', bounds: { min: { x: -4, z: 67 }, max: { x: 4, z: 82 } } },
  { id: 'rooftop', chapterId: 'chapter-02', route: 'main', bounds: { min: { x: -10, z: 82 }, max: { x: 10, z: 108 } } },
];

export const LAST_BELL_AUTHORED_COLLIDERS: readonly LastBellAuthoredCollider[] = [
  // The start-room floor and its central exit portal come from the opening
  // pack's authored bounds/door semantic tags.
  { id: 'floor.classroom', sourceAsset: 'start-room.glb', sourceNode: 'StartRoom_Root', zoneId: 'classroom', bounds: { min: { x: -6.9, z: -1.8 }, max: { x: 6.9, z: 13 } } },
  // Floor and portal bounds overlap by one actor radius. This represents the
  // threshold volume, rather than leaving a mathematically impassable seam at
  // a mesh join.
  // The decoded door leaf/frame spans about x=-1.72..1.73. Preserve the
  // actor-radius clearance of that real opening; the previous +/-1.1 portal
  // trapped any player who had inspected the room off-centre at z=12.71 even
  // while DoorSnapshot.passable was true.
  { id: 'portal.classroom-door', sourceAsset: 'classroom-door.glb', sourceNode: 'ClassroomDoor_Root', zoneId: 'corridor', bounds: { min: { x: -1.65, z: 12.35 }, max: { x: 1.65, z: 13.75 } } },
  { id: 'floor.first-bay', sourceAsset: 'first-bay.glb', sourceNode: 'FirstBay_Root', zoneId: 'corridor', bounds: { min: { x: -3, z: 13.2 }, max: { x: 3, z: 25 } } },
  { id: 'floor.corridor', sourceAsset: 'routes/corridor.glb', sourceNode: 'COL_Corridor_Lane', zoneId: 'corridor', bounds: { min: { x: -3, z: 24 }, max: { x: 3, z: 67 } } },
  { id: 'portal.infirmary', sourceAsset: 'routes/corridor.glb', sourceNode: 'Portal_Infirmary', zoneId: 'infirmary', bounds: { min: { x: 2.48, z: 30.1 }, max: { x: 4.52, z: 34 } } },
  { id: 'floor.infirmary', sourceAsset: 'routes/infirmary.glb', sourceNode: 'COL_Infirmary', zoneId: 'infirmary', bounds: { min: { x: 4, z: 27 }, max: { x: 10, z: 38 } } },
  { id: 'portal.broadcast', sourceAsset: 'routes/corridor.glb', sourceNode: 'Portal_Broadcast', zoneId: 'broadcast', bounds: { min: { x: -4.52, z: 37.9 }, max: { x: -2.48, z: 47.4 } } },
  { id: 'floor.broadcast', sourceAsset: 'routes/broadcast.glb', sourceNode: 'COL_Broadcast', zoneId: 'broadcast', bounds: { min: { x: -10, z: 37 }, max: { x: -4, z: 49 } } },
  { id: 'floor.utility', sourceAsset: 'routes/utility.glb', sourceNode: 'COL_Utility', zoneId: 'utility', bounds: { min: { x: -3, z: 61 }, max: { x: 3, z: 67 } } },
  { id: 'portal.fire-door', sourceAsset: 'routes/stairwell.glb', sourceNode: 'Portal_Fire', zoneId: 'stairwell', bounds: { min: { x: -1.65, z: 66.4 }, max: { x: 1.65, z: 67.6 } } },
  { id: 'floor.stairwell', sourceAsset: 'routes/stairwell.glb', sourceNode: 'COL_Stairwell', zoneId: 'stairwell', bounds: { min: { x: -3.65, z: 67 }, max: { x: 3.65, z: 82 } } },
  { id: 'portal.rooftop-door', sourceAsset: 'routes/stairwell.glb', sourceNode: 'Portal_Rooftop', zoneId: 'rooftop', bounds: { min: { x: -1.65, z: 81.4 }, max: { x: 1.65, z: 82.6 } } },
  { id: 'floor.rooftop', sourceAsset: 'routes/rooftop.glb', sourceNode: 'COL_Rooftop', zoneId: 'rooftop', bounds: { min: { x: -10, z: 82 }, max: { x: 10, z: 108 } } },
];

export const LAST_BELL_INTERACTIONS: readonly LastBellWorldInteraction[] = [
  { id: 'ch1.classroom-door.open', kind: 'door', chapterId: 'chapter-01', zoneId: 'classroom', route: 'main', position: { x: 0, z: 11.8 }, prompt: '미닫이문 열기' },
  { id: 'ch1.classroom-door.lock', kind: 'door', chapterId: 'chapter-01', zoneId: 'corridor', route: 'main', position: { x: 0, z: 14.3 }, prompt: '문 닫고 잠그기' },
  { id: 'ch1.hide.desk', kind: 'locker-hide', chapterId: 'chapter-01', zoneId: 'classroom', route: 'main', position: { x: -3.35, z: 2.85 }, prompt: '책상 아래에 숨기' },
  { id: 'ch1.hide.locker', kind: 'locker-hide', chapterId: 'chapter-01', zoneId: 'corridor', route: 'main', position: { x: 2.25, z: 15.1 }, prompt: '사물함에 숨기' },
  // `HeavyObstacle` is an authored utility-room prop, not a procedural
  // interaction marker. The semantic interaction is deliberately fail-closed
  // in the runtime until its two route searches have been completed.
  { id: 'ch1.heavy-obstacle.move', kind: 'barricade', chapterId: 'chapter-01', zoneId: 'utility', route: 'main', position: { x: 0, z: 65.4 }, prompt: '무거운 잔해 밀어내기' },
  { id: 'ch1.power.panel', kind: 'power', chapterId: 'chapter-01', zoneId: 'utility', route: 'main', position: { x: 1.5, z: 64.5 }, prompt: '비상전원 복구' },
  { id: 'ch1.noise.device', kind: 'noise-device', chapterId: 'chapter-01', zoneId: 'utility', route: 'main', position: { x: -1.45, z: 64.3 }, prompt: '소음 장치 가동' },
  { id: 'ch1.fire-door.open', kind: 'door', chapterId: 'chapter-01', zoneId: 'utility', route: 'main', position: { x: 0, z: 66.1 }, prompt: '방화문 열기' },
  { id: 'ch1.fire-door.lock', kind: 'barricade', chapterId: 'chapter-01', zoneId: 'stairwell', route: 'main', position: { x: 0, z: 68.7 }, prompt: '방화문 바리케이드 잠금' },
  { id: 'ch1.last-bell', kind: 'bell', chapterId: 'chapter-01', zoneId: 'stairwell', route: 'main', position: { x: 1.25, z: 73 }, prompt: '마지막 종 울리기' },
  { id: 'ch1.idcard', kind: 'item', chapterId: 'chapter-01', zoneId: 'classroom', route: 'main', position: { x: -1.3, z: 7.4 }, prompt: '학생증 살펴보기', collectibleKey: 'idcard' },
  { id: 'ch1.badge', kind: 'item', chapterId: 'chapter-01', zoneId: 'corridor', route: 'main', position: { x: 2.8, z: 22.3 }, prompt: '명찰 뱃지 줍기', collectibleKey: 'badge' },
  { id: 'ch1.photo', kind: 'item', chapterId: 'chapter-01', zoneId: 'corridor', route: 'main', position: { x: -1.4, z: 30.7 }, prompt: '포토카드 팩 줍기', collectibleKey: 'photo' },
  { id: 'ch1.radio', kind: 'item', chapterId: 'chapter-01', zoneId: 'broadcast', route: 'main', position: { x: -7.2, z: 43.5 }, prompt: '무전기 키링 줍기', collectibleKey: 'radio' },
  { id: 'ch1.kit', kind: 'item', chapterId: 'chapter-01', zoneId: 'infirmary', route: 'detour', position: { x: 7.1, z: 31.6 }, prompt: '생존 키트 줍기', collectibleKey: 'kit', detourSeconds: 6 },
  { id: 'ch1.zipup', kind: 'item', chapterId: 'chapter-01', zoneId: 'infirmary', route: 'detour', position: { x: 8.2, z: 35.4 }, prompt: '체육복 집업 줍기', collectibleKey: 'zipup', detourSeconds: 7 },
  { id: 'ch1.archery', kind: 'item', chapterId: 'chapter-01', zoneId: 'broadcast', route: 'detour', position: { x: -7.8, z: 46.3 }, prompt: '양궁부 세트 줍기', collectibleKey: 'archery', detourSeconds: 7 },
  { id: 'ch1.postcard', kind: 'item', chapterId: 'chapter-01', zoneId: 'corridor', route: 'main', position: { x: -2.7, z: 51.2 }, prompt: '무전 엽서 줍기', collectibleKey: 'postcard' },
  { id: 'ch2.candle', kind: 'item', chapterId: 'chapter-02', zoneId: 'stairwell', route: 'main', position: { x: -1.8, z: 77.3 }, prompt: '모닥불 캔들 줍기', collectibleKey: 'candle' },
  { id: 'ch2.blanket', kind: 'item', chapterId: 'chapter-02', zoneId: 'stairwell', route: 'main', position: { x: 2.05, z: 79.25 }, prompt: 'S.O.S 블랭킷 줍기', collectibleKey: 'blanket' },
  { id: 'ch2.rooftop-door.open', kind: 'door', chapterId: 'chapter-02', zoneId: 'stairwell', route: 'main', position: { x: 0, z: 81.2 }, prompt: '옥상 문 열기' },
  { id: 'ch2.namra', kind: 'character', chapterId: 'chapter-02', zoneId: 'rooftop', route: 'main', position: { x: 0, z: 101.5 }, prompt: '남라에게 다가가기' },
];

/**
 * The route's inspection points bind runtime proof to existing meshes. Product
 * pickups at nearby placements remain optional and never satisfy these verbs.
 */
export const LAST_BELL_ROUTE_EVIDENCE: readonly LastBellRouteEvidenceDefinition[] = [
  {
    id: 'infirmary-search', chapterId: 'chapter-01', zoneId: 'infirmary',
    position: { x: 8.2, z: 35.4 }, radius: 1.05, semanticNode: 'Anchor_KitDetour',
  },
  {
    id: 'broadcast-search', chapterId: 'chapter-01', zoneId: 'broadcast',
    position: { x: -7.8, z: 46.3 }, radius: 1.05, semanticNode: 'BroadcastDesk',
  },
  {
    id: 'heavy-obstacle', chapterId: 'chapter-01', zoneId: 'utility',
    position: { x: 0, z: 65.4 }, radius: 1.35, semanticNode: 'HeavyObstacle',
  },
  {
    id: 'stairwell-candle-shelf', chapterId: 'chapter-02', zoneId: 'stairwell',
    position: { x: -1.8, z: 77.3 }, radius: 1.05, semanticNode: 'Anchor_Candle',
  },
  {
    id: 'stairwell-blanket-case', chapterId: 'chapter-02', zoneId: 'stairwell',
    position: { x: 2.05, z: 79.25 }, radius: 1.05, semanticNode: 'Anchor_Blanket',
  },
];

export const LAST_BELL_HIDING_SPOTS: readonly HidingSpotDefinition[] = [
  {
    id: 'ch1.hide.desk', interactionId: 'ch1.hide.desk', semanticNode: 'Anchor_Hide_Desk',
    chapterId: 'chapter-01', zoneId: 'classroom', position: { x: -3.35, z: 2.85 },
    entrySeconds: .35, exitSeconds: .25,
    // The camera must sit below the authored 0.76m desktop instead of using
    // the generic crouch pose, which intersects the tabletop in WebGL.
    camera: { offset: { x: 0, z: -.08 }, eyeHeightMeters: .72, yawLimitRadians: .42, suppressFlashlight: true },
    audio: { breathCue: 'audio.player.hidden-breath', clothRustleCue: 'audio.player.hide-cloth' },
  },
  {
    id: 'ch1.hide.locker', interactionId: 'ch1.hide.locker', semanticNode: 'Anchor_Hide_Locker',
    chapterId: 'chapter-01', zoneId: 'corridor', position: { x: 2.25, z: 15.1 },
    entrySeconds: .42, exitSeconds: .28,
    camera: { offset: { x: -.18, z: -.18 }, eyeHeightMeters: 1.46, yawLimitRadians: .25, suppressFlashlight: true },
    audio: { breathCue: 'audio.player.hidden-breath', clothRustleCue: 'audio.player.hide-cloth' },
  },
];

/**
 * The encounter layout is authored data rather than a renderer effect. The
 * simulation consumes these spawn/waypoint definitions; 3D and audio adapters
 * only decide how the stable actor and cue ids are presented.
 */
export const LAST_BELL_ENCOUNTERS: readonly EncounterDefinition[] = [
  {
    id: 'encounter.first-bay',
    chapterId: 'chapter-01',
    trigger: { type: 'chapter-start' },
    actors: [{
      id: 'zombie-01',
      variant: 'uniform-a',
      spawn: { x: .72, z: 23.35 },
      facingRadians: Math.PI,
      waypoints: [{ x: -.72, z: 22.35 }, { x: .86, z: 24.15 }],
    }],
    audioCue: 'audio.zombie.first-bay',
    hidingSpotIds: ['ch1.hide.desk', 'ch1.hide.locker'],
    successExit: { zoneId: 'corridor', minZ: 26.5 },
  },
  {
    id: 'encounter.fixed-noise-passage',
    chapterId: 'chapter-01',
    trigger: { type: 'interaction', interactionId: 'ch1.noise.device' },
    actors: [{
      id: 'zombie-02',
      variant: 'uniform-b',
      spawn: { x: -1.2, z: 56 },
      facingRadians: Math.PI,
      waypoints: [{ x: -1.2, z: 56 }],
    }],
    audioCue: 'audio.zombie.fixed-noise-passage',
    hidingSpotIds: ['ch1.hide.locker'],
    successExit: { zoneId: 'stairwell', minZ: 67.55 },
  },
] as const;

export function hidingSpotForInteraction(interactionId: string): HidingSpotDefinition | null {
  return LAST_BELL_HIDING_SPOTS.find((spot) => spot.interactionId === interactionId) ?? null;
}

export function hidingSpotById(id: HidingSpotId | null): HidingSpotDefinition | null {
  return id ? LAST_BELL_HIDING_SPOTS.find((spot) => spot.id === id) ?? null : null;
}

export const LAST_BELL_NAV_NODES: readonly LastBellNavNode[] = [
  { id: 'classroom', zoneId: 'classroom', position: { x: 0, z: 7 } },
  { id: 'corridor-a', zoneId: 'corridor', position: { x: 0, z: 22 } },
  { id: 'corridor-b', zoneId: 'corridor', position: { x: 0, z: 46 } },
  { id: 'infirmary-hall', zoneId: 'corridor', position: { x: 2.45, z: 32 } },
  { id: 'infirmary-portal', zoneId: 'infirmary', position: { x: 4.45, z: 32 } },
  { id: 'infirmary', zoneId: 'infirmary', position: { x: 7, z: 32 } },
  { id: 'broadcast-hall', zoneId: 'corridor', position: { x: -2.45, z: 43 } },
  { id: 'broadcast-portal', zoneId: 'broadcast', position: { x: -4.45, z: 43 } },
  { id: 'broadcast', zoneId: 'broadcast', position: { x: -7, z: 43 } },
  { id: 'utility', zoneId: 'utility', position: { x: 0, z: 64 } },
  { id: 'stairwell', zoneId: 'stairwell', position: { x: 0, z: 75 } },
  { id: 'rooftop', zoneId: 'rooftop', position: { x: 0, z: 95 } },
];

export const LAST_BELL_NAV_EDGES: readonly LastBellNavEdge[] = [
  { from: 'classroom', to: 'corridor-a', doorId: 'door.classroom.slide' },
  { from: 'corridor-a', to: 'corridor-b' },
  { from: 'corridor-a', to: 'infirmary-hall' },
  { from: 'infirmary-hall', to: 'infirmary-portal' },
  { from: 'infirmary-portal', to: 'infirmary' },
  { from: 'corridor-b', to: 'broadcast-hall' },
  { from: 'broadcast-hall', to: 'broadcast-portal' },
  { from: 'broadcast-portal', to: 'broadcast' },
  { from: 'corridor-b', to: 'utility' },
  { from: 'utility', to: 'stairwell', doorId: 'door.fire' },
  { from: 'stairwell', to: 'rooftop', doorId: 'door.rooftop' },
];

const LAST_BELL_ZONE_ROUTE_ORDER: Readonly<Record<ZoneId, number>> = {
  classroom: 0,
  corridor: 1,
  infirmary: 2,
  broadcast: 3,
  utility: 4,
  stairwell: 5,
  rooftop: 6,
};

function colliderFootprintArea(collider: LastBellAuthoredCollider): number {
  return (collider.bounds.max.x - collider.bounds.min.x) * (collider.bounds.max.z - collider.bounds.min.z);
}

/**
 * A portal or room collider may overlap the long corridor lane at an authored
 * threshold. Resolve the most-specific containing volume first; the explicit
 * route order and collider id make equal-area ties stable without changing
 * movement or nav occupancy semantics.
 */
function prefersZoneCollider(candidate: LastBellAuthoredCollider, current: LastBellAuthoredCollider): boolean {
  const candidateArea = colliderFootprintArea(candidate);
  const currentArea = colliderFootprintArea(current);
  if (candidateArea !== currentArea) return candidateArea < currentArea;

  const candidateRouteOrder = LAST_BELL_ZONE_ROUTE_ORDER[candidate.zoneId];
  const currentRouteOrder = LAST_BELL_ZONE_ROUTE_ORDER[current.zoneId];
  if (candidateRouteOrder !== currentRouteOrder) return candidateRouteOrder > currentRouteOrder;
  return candidate.id < current.id;
}

export function zoneForLastBellPosition(position: LastBellVec2): ZoneId {
  let resolved: LastBellAuthoredCollider | null = null;
  for (const collider of LAST_BELL_AUTHORED_COLLIDERS) {
    if (!contains(collider.bounds, position)) continue;
    if (!resolved || prefersZoneCollider(collider, resolved)) resolved = collider;
  }
  return resolved?.zoneId ?? 'classroom';
}

/** True only when an actor-sized footprint fits inside one authored floor/portal volume. */
export function canOccupyLastBellPosition(position: LastBellVec2, radius: number): boolean {
  const safeRadius = Number.isFinite(radius) ? Math.max(0, radius) : 0;
  return LAST_BELL_AUTHORED_COLLIDERS.some((collider) => (
    position.x - safeRadius >= collider.bounds.min.x
    && position.x + safeRadius <= collider.bounds.max.x
    && position.z - safeRadius >= collider.bounds.min.z
    && position.z + safeRadius <= collider.bounds.max.z
  ));
}

/**
 * Samples a short nav segment against the same collider contract. This keeps
 * AI sight/sound from cutting diagonally through an authored wall between two
 * otherwise valid rooms.
 */
export function isLastBellNavSegmentWalkable(from: LastBellVec2, to: LastBellVec2, radius = 0): boolean {
  const distance = Math.hypot(to.x - from.x, to.z - from.z);
  const steps = Math.max(1, Math.ceil(distance / .12));
  for (let index = 0; index <= steps; index += 1) {
    const ratio = index / steps;
    if (!canOccupyLastBellPosition({
      x: from.x + (to.x - from.x) * ratio,
      z: from.z + (to.z - from.z) * ratio,
    }, radius)) return false;
  }
  return true;
}

export function contains(bounds: LastBellRect, position: LastBellVec2): boolean {
  return position.x >= bounds.min.x && position.x <= bounds.max.x
    && position.z >= bounds.min.z && position.z <= bounds.max.z;
}
