import type { LastBellAudioId } from '../assets';
import { LAST_BELL_ENVIRONMENT_ID, type LastBellEnvironmentId } from '../environment-profile';
import { validateDoorCapabilities, type DoorBounds, type DoorCapability, type DoorVector } from '../engine/doors';

export type Chapter01ZoneId = 'start-room' | 'first-bay';
export type Chapter01AnchorId = 'player-start' | 'first-door-control' | 'first-bay-listen';
export type Chapter01LightId = 'start-room-fluorescent' | 'first-bay-emergency';
export type Chapter01AudioCueId = 'start-room-ambience' | 'first-door-pressure' | 'first-bay-distant-groan';

export type Chapter01Zone = Readonly<{
  id: Chapter01ZoneId;
  bounds: DoorBounds;
}>;

export type Chapter01Anchor = Readonly<{
  id: Chapter01AnchorId;
  zoneId: Chapter01ZoneId;
  position: DoorVector;
  role: 'spawn' | 'door-control' | 'listen';
  doorId?: string;
}>;

export type Chapter01Light = Readonly<{
  id: Chapter01LightId;
  zoneId: Chapter01ZoneId;
  position: DoorVector;
  mode: 'fluorescent' | 'emergency';
}>;

export type Chapter01AudioCue = Readonly<{
  id: Chapter01AudioCueId;
  zoneId: Chapter01ZoneId;
  assetId: LastBellAudioId;
}>;

export type Chapter01Content = Readonly<{
  id: 'chapter-01';
  environmentId: LastBellEnvironmentId;
  zones: readonly Chapter01Zone[];
  /**
   * The first human review deliberately ends in the first corridor bay. The
   * legacy Chapter 1 route data remains separately replaceable, but it must
   * not mount or expand the playable bounds of this review build.
   */
  reviewGate: Readonly<{
    maxPlayerZ: number;
    interactionAnchorIds: readonly string[];
  }>;
  spawnAnchorId: 'player-start';
  anchors: readonly Chapter01Anchor[];
  doors: readonly DoorCapability[];
  lights: readonly Chapter01Light[];
  audioCues: readonly Chapter01AudioCue[];
}>;

export type Chapter01ValidationIssue = Readonly<{
  subject: string;
  reason: string;
}>;

/** Stable frame-zero seam shared by the runtime camera and checkpoint reset. */
export const CHAPTER_01_PLAYER_START = { x: 0, y: 1.68, z: 4 } as const;

/** The slider's authored AABB is also the only legitimate crossing portal. */
export const CHAPTER_01_CLASSROOM_DOOR_PORTAL = {
  // Match the decoded door leaf/frame and the campaign collider contract.
  // The previous +/-1.1m threshold silently trapped a player who approached
  // the visibly open slider even slightly off-centre.
  min: { x: -1.65, y: 0, z: 12.85 },
  max: { x: 1.65, y: 3, z: 13.15 },
} as const;

/**
 * First human-review blockout only: the starting room, the first corridor bay,
 * and its sliding door. Route, power, bell, and later-story data stay absent
 * until their authored spaces exist.
 */
export const CHAPTER_01_CONTENT: Chapter01Content = {
  id: 'chapter-01',
  environmentId: LAST_BELL_ENVIRONMENT_ID,
  zones: [
    {
      id: 'start-room',
      bounds: { min: { x: -7, y: 0, z: -2 }, max: { x: 7, y: 4, z: 13.2 } },
    },
    {
      id: 'first-bay',
      bounds: { min: { x: -3, y: 0, z: 13.2 }, max: { x: 3, y: 4, z: 25 } },
    },
  ],
  reviewGate: {
    maxPlayerZ: 24.6,
    interactionAnchorIds: ['classroom_door'],
  },
  spawnAnchorId: 'player-start',
  anchors: [
    { id: 'player-start', zoneId: 'start-room', position: CHAPTER_01_PLAYER_START, role: 'spawn' },
    { id: 'first-door-control', zoneId: 'start-room', position: { x: 0, y: 1.68, z: 12.2 }, role: 'door-control', doorId: 'door.classroom.slide' },
    { id: 'first-bay-listen', zoneId: 'first-bay', position: { x: 0, y: 1.68, z: 20 }, role: 'listen' },
  ],
  doors: [
    {
      id: 'door.classroom.slide',
      kind: 'slide',
      closedTransform: { position: { x: 0, y: 1.5, z: 13 }, rotation: { x: 0, y: 0, z: 0 } },
      pivot: { x: 0, y: 1.5, z: 13 },
      axis: { x: 1, y: 0, z: 0 },
      openAmount: 2.1,
      durationSeconds: .85,
      passableThreshold: .5,
      blockerBounds: CHAPTER_01_CLASSROOM_DOOR_PORTAL,
      lockId: 'lock.classroom.slide',
      pressureId: 'pressure.classroom.slide',
      cueIds: {
        opening: 'cue.classroom-door.opening',
        opened: 'cue.classroom-door.opened',
        closing: 'cue.classroom-door.closing',
        closed: 'cue.classroom-door.closed',
      },
    },
  ],
  lights: [
    { id: 'start-room-fluorescent', zoneId: 'start-room', position: { x: 0, y: 3.35, z: 6 }, mode: 'fluorescent' },
    { id: 'first-bay-emergency', zoneId: 'first-bay', position: { x: 0, y: 3.35, z: 18 }, mode: 'emergency' },
  ],
  audioCues: [
    { id: 'start-room-ambience', zoneId: 'start-room', assetId: 'classroomAmbience' },
    { id: 'first-door-pressure', zoneId: 'start-room', assetId: 'doorPounding' },
    { id: 'first-bay-distant-groan', zoneId: 'first-bay', assetId: 'groan' },
  ],
};

export function validateChapter01Content(content: Chapter01Content): Chapter01ValidationIssue[] {
  const issues: Chapter01ValidationIssue[] = [];
  const zoneById = new Map<Chapter01ZoneId, Chapter01Zone>();
  for (const zone of content.zones) {
    if (zoneById.has(zone.id)) issues.push({ subject: zone.id, reason: 'zone id must be unique' });
    zoneById.set(zone.id, zone);
    if (!contains(zone.bounds, zone.bounds.min) || !contains(zone.bounds, zone.bounds.max)) {
      issues.push({ subject: zone.id, reason: 'zone bounds must be ordered and finite' });
    }
  }
  for (const requiredZoneId of ['start-room', 'first-bay'] as const) {
    if (!zoneById.has(requiredZoneId)) issues.push({ subject: requiredZoneId, reason: 'review zone is required' });
  }

  const anchorIds = new Set<string>();
  for (const anchor of content.anchors) {
    if (anchorIds.has(anchor.id)) issues.push({ subject: anchor.id, reason: 'anchor id must be unique' });
    anchorIds.add(anchor.id);
    const zone = zoneById.get(anchor.zoneId);
    if (!zone) issues.push({ subject: anchor.id, reason: 'anchor zone must exist' });
    else if (!contains(zone.bounds, anchor.position)) issues.push({ subject: anchor.id, reason: 'anchor must sit inside its zone' });
  }
  if (!anchorIds.has(content.spawnAnchorId)) issues.push({ subject: content.spawnAnchorId, reason: 'spawn anchor must exist' });

  const doorIds = new Set(content.doors.map((door) => door.id));
  for (const anchor of content.anchors) {
    if (anchor.role === 'door-control' && (!anchor.doorId || !doorIds.has(anchor.doorId))) {
      issues.push({ subject: anchor.id, reason: 'door-control anchor must reference an authored door' });
    }
  }
  for (const issue of validateDoorCapabilities(content.doors)) issues.push({ subject: issue.doorId, reason: issue.reason });
  if (content.doors.length !== 1 || content.doors[0]?.kind !== 'slide') {
    issues.push({ subject: 'doors', reason: 'the review blockout contains exactly one sliding classroom door' });
  }

  const lightIds = new Set<string>();
  for (const light of content.lights) {
    if (lightIds.has(light.id)) issues.push({ subject: light.id, reason: 'light id must be unique' });
    lightIds.add(light.id);
    if (!zoneById.has(light.zoneId)) issues.push({ subject: light.id, reason: 'light zone must exist' });
  }
  const audioCueIds = new Set<string>();
  for (const cue of content.audioCues) {
    if (audioCueIds.has(cue.id)) issues.push({ subject: cue.id, reason: 'audio cue id must be unique' });
    audioCueIds.add(cue.id);
    if (!zoneById.has(cue.zoneId)) issues.push({ subject: cue.id, reason: 'audio cue zone must exist' });
  }
  return issues;
}

function contains(bounds: DoorBounds, position: DoorVector): boolean {
  return Number.isFinite(position.x)
    && Number.isFinite(position.y)
    && Number.isFinite(position.z)
    && Number.isFinite(bounds.min.x)
    && Number.isFinite(bounds.min.y)
    && Number.isFinite(bounds.min.z)
    && Number.isFinite(bounds.max.x)
    && Number.isFinite(bounds.max.y)
    && Number.isFinite(bounds.max.z)
    && bounds.min.x <= bounds.max.x
    && bounds.min.y <= bounds.max.y
    && bounds.min.z <= bounds.max.z
    && position.x >= bounds.min.x
    && position.x <= bounds.max.x
    && position.y >= bounds.min.y
    && position.y <= bounds.max.y
    && position.z >= bounds.min.z
    && position.z <= bounds.max.z;
}
