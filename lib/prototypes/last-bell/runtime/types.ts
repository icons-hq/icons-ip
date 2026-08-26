import type { DoorSystemSnapshot } from '../engine/doors';

/** Public campaign identifiers. These are intentionally independent of scene file names. */
export const LAST_BELL_CHAPTER_IDS = ['chapter-01', 'chapter-02'] as const;
export type ChapterId = (typeof LAST_BELL_CHAPTER_IDS)[number];

export const LAST_BELL_ZONE_IDS = [
  'classroom',
  'corridor',
  'infirmary',
  'broadcast',
  'utility',
  'stairwell',
  'rooftop',
] as const;
export type ZoneId = (typeof LAST_BELL_ZONE_IDS)[number];

export const LAST_BELL_COLLECTIBLE_KEYS = [
  'idcard',
  'badge',
  'photo',
  'radio',
  'kit',
  'zipup',
  'archery',
  'postcard',
  'candle',
  'blanket',
] as const;
export type CollectibleKey = (typeof LAST_BELL_COLLECTIBLE_KEYS)[number];

export type LastBellRouteKind = 'main' | 'detour';
export type LastBellRunMode = 'first-play' | 'chapter-replay';
export type LastBellZombieState = 'patrol' | 'investigate' | 'search' | 'chase' | 'capture';
export type LastBellRooftopPhase = 'sealed' | 'approach' | 'recognition' | 'subdue' | 'black';
export type LastBellPacingBeatId =
  | 'opening-inspection'
  | 'first-encounter'
  | 'corridor-exploration'
  | 'two-zombie-passage'
  | 'bell-chase'
  | 'stairwell-search'
  | 'rooftop-approach'
  | 'complete';
/**
 * Completed spatial verbs that make the campaign route auditable without
 * turning elapsed time into a progression gate. These names point at authored
 * scene seams, never at an automatically spawned gameplay proxy.
 */
export const LAST_BELL_ROUTE_EVIDENCE_IDS = [
  'first-bay-cover',
  'infirmary-search',
  'broadcast-search',
  'heavy-obstacle',
  'fire-door-passage',
  'stairwell-candle-shelf',
  'stairwell-blanket-case',
] as const;
export type LastBellRouteEvidenceId = (typeof LAST_BELL_ROUTE_EVIDENCE_IDS)[number];
export type LastBellInfectionForeshadowing = 'strength' | 'scent-hesitation' | 'rapid-recovery';
/** Stable semantic cover state; it is never inferred from camera height. */
export type PlayerStealthState = 'standing' | 'crouched' | 'entering-hide' | 'hidden' | 'exiting-hide';
export const LAST_BELL_HIDING_SPOT_IDS = ['ch1.hide.desk', 'ch1.hide.locker'] as const;
export type HidingSpotId = (typeof LAST_BELL_HIDING_SPOT_IDS)[number];
/** One shared rig can select one of these authored material/outfit variants. */
export const LAST_BELL_ZOMBIE_VARIANTS = ['uniform-a', 'uniform-b', 'uniform-c'] as const;
export type LastBellZombieVariant = (typeof LAST_BELL_ZOMBIE_VARIANTS)[number];

export type LastBellVec2 = Readonly<{ x: number; z: number }>;

export type LastBellPlayerSnapshot = Readonly<{
  position: LastBellVec2;
  facingRadians: number;
  flashlightOn: boolean;
  /** C is a mobile crouch posture; only an authored E interaction enters cover. */
  crouching: boolean;
  stealthState: PlayerStealthState;
  hidingSpotId: HidingSpotId | null;
  /** Remaining authored enter/exit time; renderer must not invent a timer. */
  stealthTransitionSeconds: number;
  listening: boolean;
  hiding: boolean;
  running: boolean;
}>;

export type LastBellZombieSnapshot = Readonly<{
  id: string;
  variant: LastBellZombieVariant;
  position: LastBellVec2;
  facingRadians: number;
  state: LastBellZombieState;
  lastSeenPosition: LastBellVec2 | null;
  investigatePosition: LastBellVec2 | null;
}>;

export type LastBellInteractionKind =
  | 'door'
  | 'barricade'
  | 'power'
  | 'noise-device'
  | 'locker-hide'
  | 'item'
  | 'checkpoint'
  | 'bell'
  | 'character';

export type LastBellSemanticInteractionSnapshot = Readonly<{
  id: string;
  kind: LastBellInteractionKind;
  chapterId: ChapterId;
  zoneId: ZoneId;
  prompt: string;
  enabled: boolean;
  position: LastBellVec2;
  collectibleKey?: CollectibleKey;
}>;

/** The event contract consumed by a host. It contains no product or good ID. */
export type LastBellRuntimeEvent =
  /**
   * `zoneId` is an authored event location, not a client assertion. Most
   * objectives occur where the snapshot says they do; portal objectives may
   * cross a zone boundary during the same fixed step and need their semantic
   * destination recorded explicitly.
   */
  | Readonly<{ type: 'objective'; chapterId: ChapterId; objectiveId: string; atSeconds: number; zoneId?: ZoneId }>
  | Readonly<{ type: 'pickup'; chapterId: ChapterId; collectibleKey: CollectibleKey; atSeconds: number }>
  | Readonly<{ type: 'checkpoint'; chapterId: ChapterId; checkpointId: LastBellCheckpointId; atSeconds: number }>
  /** A non-failure authored cue consumed by the renderer and DOM/audio adapter. It is never a server milestone. */
  | Readonly<{ type: 'foreshadowing'; chapterId: ChapterId; cue: LastBellInfectionForeshadowing; atSeconds: number }>
  | Readonly<{ type: 'capture'; chapterId: ChapterId; actor: 'zombie' | 'namra'; atSeconds: number }>
  | Readonly<{ type: 'chapter_complete'; chapterId: ChapterId; atSeconds: number; committedCollectibles: readonly CollectibleKey[] }>
  | Readonly<{ type: 'game_complete'; atSeconds: number; committedCollectibles: readonly CollectibleKey[] }>;

export const LAST_BELL_CHECKPOINT_IDS = ['ch1_first_bay', 'ch1_power', 'ch2_stairwell'] as const;
export type LastBellCheckpointId = (typeof LAST_BELL_CHECKPOINT_IDS)[number];

export type LastBellSimulationInput = Readonly<{
  /** x is strafe; y is forward relative to facingRadians. */
  movement?: Readonly<{ x: number; y: number }>;
  facingRadians?: number;
  flashlightOn?: boolean;
  crouching?: boolean;
  listening?: boolean;
  /** Legacy callers may send this, but cover is authored E-interaction state. */
  hiding?: boolean;
  running?: boolean;
}>;

export type LastBellSimulationSnapshot = Readonly<{
  fixedStepSeconds: number;
  tick: number;
  elapsedSeconds: number;
  chapterId: ChapterId;
  runMode: LastBellRunMode;
  zoneId: ZoneId;
  objectiveId: string;
  player: LastBellPlayerSnapshot;
  doors: DoorSystemSnapshot;
  zombies: readonly LastBellZombieSnapshot[];
  availableInteractions: readonly LastBellSemanticInteractionSnapshot[];
  collectedThisRun: readonly CollectibleKey[];
  committedCollectibles: readonly CollectibleKey[];
  pendingCollectibles: readonly CollectibleKey[];
  /** Exactly the three Chapter 1 infection beats; the rooftop reveal is excluded. */
  foreshadowing: readonly LastBellInfectionForeshadowing[];
  /** The current visual/audio cue is authoritative simulation state, not a UI timer. */
  activeForeshadowing: Readonly<{ cue: LastBellInfectionForeshadowing; remainingSeconds: number }> | null;
  checkpointId: LastBellCheckpointId | null;
  rooftopPhase: LastBellRooftopPhase;
  /** Fixed-step time in the current rooftop cinematic phase. */
  rooftopPhaseElapsedSeconds: number;
  /**
   * Renderer-independent authored beat telemetry. `ready` is derived only
   * from spatial/interaction/actor evidence; the timing fields are QA targets
   * and never unlock an interaction.
   */
  pacing: Readonly<{
    beatId: LastBellPacingBeatId;
    instruction: string;
    activeSeconds: number;
    targetActiveSeconds: number;
    /** Only distance that cleared the authored collider/door contract can earn pacing. */
    movementMeters: number;
    /** Zones physically crossed while earning the active beat. */
    traversedZones: readonly ZoneId[];
    /** Listening/hiding transitions observed during the active beat. */
    stealthChanges: number;
    /** Completed authored route verbs; never populated by elapsed idle time. */
    routeEvidence: readonly LastBellRouteEvidenceId[];
    ready: boolean;
    targetElapsedSeconds: number;
  }>;
  captured: boolean;
  chapterComplete: boolean;
  gameComplete: boolean;
}>;

export type LastBellSimulationOptions = Readonly<{
  chapterId?: ChapterId;
  runMode?: LastBellRunMode;
  /**
   * Server-verified route stage used when an active run is resumed. The
   * simulation restores the matching checkpoint/objective without replaying
   * milestones the server has already accepted.
   */
  progressStage?: number;
  /** Purchase rights are host/server-owned; this only restores verified keys. */
  committedCollectibles?: readonly CollectibleKey[];
  /** Validated pickups from a resumable active run remain pending until exit. */
  pendingCollectibles?: readonly CollectibleKey[];
}>;
