import {
  createDoorSystem,
  type DoorCapability,
  type DoorSnapshot,
  type DoorSystem,
} from '../engine/doors';
import { movementBasisFromFacing } from '../engine/movement-basis';
import {
  canOccupyLastBellPosition,
  hidingSpotForInteraction,
  isLastBellNavSegmentWalkable,
  LAST_BELL_CHAPTER_TARGET_SECONDS,
  LAST_BELL_ENCOUNTERS,
  LAST_BELL_INTERACTIONS,
  LAST_BELL_NAV_EDGES,
  LAST_BELL_NAV_NODES,
  LAST_BELL_ROUTE_EVIDENCE,
  zoneForLastBellPosition,
} from './world';
import type {
  ChapterId,
  CollectibleKey,
  LastBellCheckpointId,
  LastBellInfectionForeshadowing,
  LastBellInteractionKind,
  LastBellPlayerSnapshot,
  LastBellPacingBeatId,
  LastBellRouteEvidenceId,
  LastBellRooftopPhase,
  LastBellRuntimeEvent,
  LastBellSimulationInput,
  LastBellSimulationOptions,
  LastBellSimulationSnapshot,
  LastBellVec2,
  LastBellZombieSnapshot,
  LastBellZombieState,
  HidingSpotId,
  PlayerStealthState,
  ZoneId,
} from './types';

/** The gameplay clock is fixed; R3F, React and requestAnimationFrame only render snapshots. */
export const LAST_BELL_SIMULATION_HZ = 30;
export const LAST_BELL_SIMULATION_STEP_SECONDS = 1 / LAST_BELL_SIMULATION_HZ;
// The authored campfire mark sits just beyond the controlled approach cap;
// preserve a small readable E affordance instead of requiring an invisible
// last centimetre of forward movement.
const INTERACTION_RADIUS = 2.3;
const PLAYER_RADIUS = .26;
const WALK_SPEED = 1.85;
const RUN_SPEED = 3.35;
const CROUCH_SPEED = 1.12;
const ZOMBIE_SPEED = 1.52;
// The final approach is intentionally a controlled walk, not a wall-clock
// pause. Traversing the authored roof distance is the 85-second Chapter 2
// beat; the player continues to hold forward and may stop at any time.
const ROOFTOP_APPROACH_SPEED = .2;

/**
 * Checkpoint rehydration and the authored closing sequence use this timeline.
 * It is deliberately not an interaction lock: normal progression is driven
 * by spatial verbs and completed beats, while the target session length stays
 * available through `targetDurationSeconds()`.
 */
/**
 * Active-route milestones mirrored by the verified-run SQL rules. The natural
 * 18-second cold-open happens before this simulation advances; a ready-gated
 * skip uses this exact same route without making a client skip flag trusted.
 */
export const LAST_BELL_VERIFIED_STAGE_TIMELINE_SECONDS = {
  stage1: 0,
  // These are conservative physical lower bounds for the verified service,
  // not the authored ten-minute targets. The session target is measured in
  // playtests; it must never be manufactured by holding a nearby E prompt.
  stage2: 1,
  stage3: 4,
  stage4: 15,
  stage5: 18,
  stage6: 20,
  stage7: 20,
  stage8: 20,
  stage9: 23,
  stage10: 128,
  stage11: 138,
} as const;

export const LAST_BELL_PACING_SECONDS = {
  chapter01: {
    classroomDoor: 18,
    firstBayLock: LAST_BELL_VERIFIED_STAGE_TIMELINE_SECONDS.stage2,
    restoreObjective: LAST_BELL_VERIFIED_STAGE_TIMELINE_SECONDS.stage3,
    power: LAST_BELL_VERIFIED_STAGE_TIMELINE_SECONDS.stage4,
    fireDoorLock: LAST_BELL_VERIFIED_STAGE_TIMELINE_SECONDS.stage5,
    exit: LAST_BELL_VERIFIED_STAGE_TIMELINE_SECONDS.stage6,
  },
  chapter02: {
    stairwellObjective: LAST_BELL_VERIFIED_STAGE_TIMELINE_SECONDS.stage7 - LAST_BELL_VERIFIED_STAGE_TIMELINE_SECONDS.stage6,
    stairwellCheckpoint: LAST_BELL_VERIFIED_STAGE_TIMELINE_SECONDS.stage8 - LAST_BELL_VERIFIED_STAGE_TIMELINE_SECONDS.stage6,
    rooftopDoor: LAST_BELL_VERIFIED_STAGE_TIMELINE_SECONDS.stage9 - LAST_BELL_VERIFIED_STAGE_TIMELINE_SECONDS.stage6,
    namraRecognition: 120,
    recognitionDuration: 30,
    subdueDuration: 15,
    blackDuration: 10,
  },
} as const;

/** Cumulative first-play targets shared conceptually with the verified-run rules. */
export const LAST_BELL_VERIFIED_MILESTONE_SECONDS = {
  firstDoor: LAST_BELL_PACING_SECONDS.chapter01.classroomDoor,
  firstBay: LAST_BELL_VERIFIED_STAGE_TIMELINE_SECONDS.stage2,
  restoreObjective: LAST_BELL_VERIFIED_STAGE_TIMELINE_SECONDS.stage3,
  power: LAST_BELL_VERIFIED_STAGE_TIMELINE_SECONDS.stage4,
  lastBell: LAST_BELL_VERIFIED_STAGE_TIMELINE_SECONDS.stage5,
  chapter01Complete: LAST_BELL_VERIFIED_STAGE_TIMELINE_SECONDS.stage6,
  stairwellObjective: LAST_BELL_VERIFIED_STAGE_TIMELINE_SECONDS.stage7,
  stairwellCheckpoint: LAST_BELL_VERIFIED_STAGE_TIMELINE_SECONDS.stage8,
  rooftopDoor: LAST_BELL_VERIFIED_STAGE_TIMELINE_SECONDS.stage9,
  chapter02Complete: LAST_BELL_VERIFIED_STAGE_TIMELINE_SECONDS.stage10,
  gameComplete: LAST_BELL_VERIFIED_STAGE_TIMELINE_SECONDS.stage11,
} as const;

type PacingBeatDefinition = Readonly<{
  instruction: string;
  /** Design/QA target only. It is never consulted by `isPacingReady`. */
  targetActiveSeconds: number;
  targetElapsedSeconds: number;
}>;

/**
 * Timing below is telemetry for the 10-minute playtest target. Progression is
 * exclusively evidence-driven: authored door snapshots, positions, stealth
 * verbs and actor state transitions. No entry in this table is a timer gate.
 */
const LAST_BELL_PACING_BEATS: Readonly<Record<LastBellPacingBeatId, PacingBeatDefinition>> = {
  // The cold-open owns the first 18 seconds. Do not add a second invisible
  // gate here: both a completed cold-open and a ready-gated skip may use E.
  'opening-inspection': { instruction: '문 앞에서 E로 미닫이문을 여세요.', targetActiveSeconds: 0, targetElapsedSeconds: 18 },
  'first-encounter': { instruction: '첫 감염자를 피해 C로 낮추거나 Q로 소리를 들으며 첫 구간을 통과하세요.', targetActiveSeconds: 47, targetElapsedSeconds: 65 },
  'corridor-exploration': { instruction: '복도와 샛길을 이동하며 전원실까지 안전한 길을 찾으세요.', targetActiveSeconds: 185, targetElapsedSeconds: 250 },
  'two-zombie-passage': { instruction: '소음에 반응한 두 감염자를 피해 방화문 너머로 이동하세요.', targetActiveSeconds: 130, targetElapsedSeconds: 380 },
  'bell-chase': { instruction: '종소리를 등지고 계단까지 계속 달리세요.', targetActiveSeconds: 45, targetElapsedSeconds: 425 },
  'stairwell-search': { instruction: '옥상 문까지 계단실을 수색하세요.', targetActiveSeconds: 35, targetElapsedSeconds: 35 },
  'rooftop-approach': { instruction: '달리지 말고 모닥불 쪽으로 천천히 다가가세요.', targetActiveSeconds: 85, targetElapsedSeconds: 120 },
  complete: { instruction: '기록이 완료되었습니다.', targetActiveSeconds: 0, targetElapsedSeconds: 175 },
};

const LAST_BELL_DOORS: readonly DoorCapability[] = [
  {
    id: 'door.classroom.slide', kind: 'slide',
    closedTransform: { position: { x: 0, y: 1.5, z: 13 }, rotation: { x: 0, y: 0, z: 0 } },
    pivot: { x: 0, y: 1.5, z: 13 }, axis: { x: 1, y: 0, z: 0 }, openAmount: 2.1, durationSeconds: .3,
    passableThreshold: .5, blockerBounds: box(-4, 12.72, 4, 13.28), lockId: 'lock.classroom.slide', pressureId: 'pressure.classroom.slide',
    cueIds: { opening: 'cue.classroom-door.opening', opened: 'cue.classroom-door.opened', closing: 'cue.classroom-door.closing', closed: 'cue.classroom-door.closed' },
  },
  {
    id: 'door.fire', kind: 'hinge',
    closedTransform: { position: { x: 0, y: 1.5, z: 67 }, rotation: { x: 0, y: 0, z: 0 } },
    pivot: { x: -1.65, y: 1.5, z: 67 }, axis: { x: 0, y: 1, z: 0 }, openAmount: Math.PI / 2, durationSeconds: .2,
    passableThreshold: .55, blockerBounds: box(-4, 66.72, 4, 67.28), lockId: 'lock.fire', pressureId: 'pressure.fire',
    cueIds: { opening: 'cue.fire-door.opening', opened: 'cue.fire-door.opened', closing: 'cue.fire-door.closing', closed: 'cue.fire-door.closed' },
  },
  {
    id: 'door.rooftop', kind: 'hinge',
    closedTransform: { position: { x: 0, y: 1.5, z: 82 }, rotation: { x: 0, y: 0, z: 0 } },
    pivot: { x: -1.65, y: 1.5, z: 82 }, axis: { x: 0, y: 1, z: 0 }, openAmount: Math.PI / 2, durationSeconds: .85,
    passableThreshold: .55, blockerBounds: box(-4, 81.72, 4, 82.28), lockId: 'lock.rooftop', pressureId: 'pressure.rooftop',
    cueIds: { opening: 'cue.rooftop-door.opening', opened: 'cue.rooftop-door.opened', closing: 'cue.rooftop-door.closing', closed: 'cue.rooftop-door.closed' },
  },
];

type MutablePlayer = {
  position: LastBellVec2;
  facingRadians: number;
  flashlightOn: boolean;
  crouching: boolean;
  stealthState: PlayerStealthState;
  hidingSpotId: HidingSpotId | null;
  stealthTransitionSeconds: number;
  listening: boolean;
  hiding: boolean;
  running: boolean;
};

type MutableZombie = {
  id: string;
  variant: LastBellZombieSnapshot['variant'];
  position: LastBellVec2;
  facingRadians: number;
  state: LastBellZombieState;
  lastSeenPosition: LastBellVec2 | null;
  investigatePosition: LastBellVec2 | null;
  /** A short authored loop keeps the first infected inside the visible bay. */
  patrolWaypoints: readonly LastBellVec2[];
  patrolWaypointIndex: number;
  searchSeconds: number;
  lostSeconds: number;
  lightSeconds: number;
  /** One authored sniff/recognition pause before the first doorway pursuit. */
  hesitationSeconds: number;
  active: boolean;
};

type NoiseSource = { position: LastBellVec2; intensity: number; remainingSeconds: number };

type Progress = {
  classroomDoorOpened: boolean;
  classroomLocked: boolean;
  /** The first zombie has searched a real desk/locker while the player hides. */
  firstBayCoverResolved: boolean;
  /** Both mandatory authored detours have been physically reached. */
  infirmarySearched: boolean;
  broadcastSearched: boolean;
  /** HeavyObstacle was moved by an E interaction, producing the strength cue. */
  heavyObstacleMoved: boolean;
  powerRestored: boolean;
  noiseActivated: boolean;
  fireDoorOpened: boolean;
  /** The player crossed the opened fire door before the barrier can lock. */
  fireDoorCrossed: boolean;
  fireDoorLocked: boolean;
  bellTriggered: boolean;
  stairwellCandleInspected: boolean;
  stairwellBlanketInspected: boolean;
  rooftopDoorOpened: boolean;
  chapterComplete: boolean;
  gameComplete: boolean;
  captured: boolean;
  rooftopPhase: LastBellRooftopPhase;
  rooftopPhaseSeconds: number;
  activeForeshadowing: LastBellInfectionForeshadowing | null;
  foreshadowingSeconds: number;
};

type PacingState = {
  beatId: LastBellPacingBeatId;
  activeSeconds: number;
  movementMeters: number;
  traversedZones: Set<ZoneId>;
  stealthChanges: number;
  /** Actors that demonstrably transitioned because of the fixed noise lure. */
  respondedZombieIds: Set<string>;
};

export type LastBellSimulationFrame = Readonly<{
  snapshot: LastBellSimulationSnapshot;
  events: readonly LastBellRuntimeEvent[];
}>;

/**
 * Renderer-independent owner for the entire two-chapter playable route.
 * It exposes serializable snapshots only; visual meshes and React state are
 * deliberately outside this module.
 */
export class LastBellSimulation {
  private readonly runMode: 'first-play' | 'chapter-replay';
  private chapterId: ChapterId;
  private tick = 0;
  private elapsedSeconds = 0;
  private accumulatorSeconds = 0;
  private readonly player: MutablePlayer;
  private readonly zombies: MutableZombie[];
  private doors: DoorSystem;
  private currentInput: LastBellSimulationInput = {};
  private queuedInteractions: string[] = [];
  private readonly collected = new Set<CollectibleKey>();
  private readonly committed = new Set<CollectibleKey>();
  private readonly pending = new Set<CollectibleKey>();
  private readonly completedChapters = new Set<ChapterId>();
  private checkpointId: LastBellCheckpointId | null = null;
  private objectiveId = 'ch1.open-classroom-door';
  private initialObjectiveEventPending = true;
  private initialCheckpointEventPending = false;
  private readonly progress: Progress;
  private pacing: PacingState = {
    beatId: 'opening-inspection', activeSeconds: 0, movementMeters: 0,
    traversedZones: new Set(), stealthChanges: 0, respondedZombieIds: new Set(),
  };
  private noises: NoiseSource[] = [];
  private readonly foreshadowing = new Set<LastBellInfectionForeshadowing>();
  /** A checkpoint can never outrun the actual DoorSystem close/lock state. */
  private readonly pendingDoorLocks = new Set<'door.classroom.slide' | 'door.fire'>();
  /**
   * The first-bay checkpoint is allowed as soon as the physical slider is
   * locked. The verified restore-power objective is emitted only after the
   * observable first-infected stealth traversal reaches its evidence floor.
   */
  private restoreObjectiveEventPending = false;
  /**
   * A retry may place the player back in the first bay with their flashlight
   * still enabled. Keep the freshly reset patrol still until the player makes
   * a deliberate movement, otherwise the actor observes a stale render-frame
   * input and immediately re-enters chase before the retry UI has closed.
   */
  private zombieRecoveryHold = false;

  constructor(options: LastBellSimulationOptions = {}) {
    this.chapterId = options.chapterId ?? 'chapter-01';
    this.runMode = options.runMode ?? 'first-play';
    for (const key of options.committedCollectibles ?? []) this.committed.add(key);
    for (const key of options.pendingCollectibles ?? []) {
      if (this.committed.has(key)) continue;
      this.collected.add(key);
      this.pending.add(key);
    }
    this.player = {
      position: this.chapterId === 'chapter-02' ? { x: 0, z: 70 } : { x: 0, z: 4 },
      facingRadians: 0,
      flashlightOn: true,
      crouching: false,
      stealthState: 'standing',
      hidingSpotId: null,
      stealthTransitionSeconds: 0,
      listening: false,
      hiding: false,
      running: false,
    };
    this.zombies = createZombies(this.chapterId);
    this.doors = createDoorSystem(LAST_BELL_DOORS);
    this.progress = {
      classroomDoorOpened: false,
      classroomLocked: false,
      firstBayCoverResolved: false,
      infirmarySearched: false,
      broadcastSearched: false,
      heavyObstacleMoved: false,
      powerRestored: false,
      noiseActivated: false,
      fireDoorOpened: false,
      fireDoorCrossed: false,
      fireDoorLocked: false,
      bellTriggered: false,
      stairwellCandleInspected: false,
      stairwellBlanketInspected: false,
      rooftopDoorOpened: false,
      chapterComplete: false,
      gameComplete: false,
      captured: false,
      rooftopPhase: this.chapterId === 'chapter-02' ? 'sealed' : 'sealed',
      rooftopPhaseSeconds: 0,
      activeForeshadowing: null,
      foreshadowingSeconds: 0,
    };
    if (this.chapterId === 'chapter-02') {
      this.checkpointId = 'ch2_stairwell';
      this.objectiveId = 'ch2.search-stairwell';
      this.completedChapters.add('chapter-01');
      this.initialCheckpointEventPending = true;
    }
    const defaultProgressStage = this.chapterId === 'chapter-02' ? 6 : 0;
    this.restoreVerifiedProgressStage(options.progressStage ?? defaultProgressStage);
  }

  /** Queue a semantic interaction. It is range- and progression-checked on the next 30Hz tick. */
  queueInteraction(interactionId: string): void {
    if (interactionId.trim()) this.queuedInteractions.push(interactionId);
  }

  setInput(input: LastBellSimulationInput): void {
    this.currentInput = input;
  }

  /**
   * Consumes arbitrary render cadence without changing simulation results.
   * A 200ms frame runs six fixed steps rather than skipping AI, door or noise state.
   */
  advance(deltaSeconds: number, input?: LastBellSimulationInput): LastBellSimulationFrame {
    if (input) this.currentInput = input;
    const events: LastBellRuntimeEvent[] = [];
    this.accumulatorSeconds += Math.max(0, Number.isFinite(deltaSeconds) ? deltaSeconds : 0);
    while (this.accumulatorSeconds + 1e-10 >= LAST_BELL_SIMULATION_STEP_SECONDS) {
      this.step(events);
      this.accumulatorSeconds -= LAST_BELL_SIMULATION_STEP_SECONDS;
    }
    return { snapshot: this.snapshot(), events };
  }

  snapshot(): LastBellSimulationSnapshot {
    const zoneId = zoneForLastBellPosition(this.player.position);
    const pacing = LAST_BELL_PACING_BEATS[this.pacing.beatId];
    return {
      fixedStepSeconds: LAST_BELL_SIMULATION_STEP_SECONDS,
      tick: this.tick,
      elapsedSeconds: round(this.elapsedSeconds),
      chapterId: this.chapterId,
      runMode: this.runMode,
      zoneId,
      objectiveId: this.objectiveId,
      player: { ...this.player, position: { ...this.player.position } } satisfies LastBellPlayerSnapshot,
      doors: this.doors.advance({ deltaSeconds: 0, occupants: this.doorOccupants() }),
      zombies: this.zombies.filter((zombie) => zombie.active).map(toZombieSnapshot),
      availableInteractions: this.availableInteractions(),
      collectedThisRun: [...this.collected].sort(),
      committedCollectibles: [...this.committed].sort(),
      pendingCollectibles: [...this.pending].sort(),
      foreshadowing: [...this.foreshadowing].sort(),
      activeForeshadowing: this.progress.activeForeshadowing
        ? { cue: this.progress.activeForeshadowing, remainingSeconds: round(this.progress.foreshadowingSeconds) }
        : null,
      checkpointId: this.checkpointId,
      rooftopPhase: this.progress.rooftopPhase,
      rooftopPhaseElapsedSeconds: round(this.progress.rooftopPhaseSeconds),
      pacing: {
        beatId: this.pacing.beatId,
        instruction: this.pacingInstruction(pacing.instruction),
        activeSeconds: round(this.pacing.activeSeconds),
        targetActiveSeconds: pacing.targetActiveSeconds,
        movementMeters: round(this.pacing.movementMeters),
        traversedZones: [...this.pacing.traversedZones].sort(),
        stealthChanges: this.pacing.stealthChanges,
        routeEvidence: this.routeEvidence(),
        ready: this.isPacingReady(),
        targetElapsedSeconds: pacing.targetElapsedSeconds,
      },
      captured: this.progress.captured,
      chapterComplete: this.progress.chapterComplete,
      gameComplete: this.progress.gameComplete,
    };
  }

  /** A host can use this metadata for planned-session QA without coupling simulation to a clock gate. */
  targetDurationSeconds(): number {
    return LAST_BELL_CHAPTER_TARGET_SECONDS[this.chapterId];
  }

  /**
   * Completes only the authored camera handoff for a ready-gated cold-open.
   * The player still owns the real E interaction and the DoorSystem remains
   * closed, occupied and authoritative.
   */
  prepareOpeningDoorInteraction(): LastBellSimulationSnapshot {
    if (
      this.chapterId === 'chapter-01'
      && this.objectiveId === 'ch1.open-classroom-door'
      && !this.progress.classroomDoorOpened
    ) {
      this.player.position = { x: 0, z: 10.8 };
      this.player.facingRadians = 0;
      this.currentInput = {};
      this.clearStealth();
    }
    return this.snapshot();
  }

  /**
   * Restores the retry anchor and reports only a recovery checkpoint that the
   * simulation has physically sealed itself. The frame form is what the R3F
   * retry-nonce effect consumes so a verified host observes the same restored
   * checkpoint as the rendered camera.
   */
  retryFrameFromCheckpoint(): LastBellSimulationFrame {
    const events: LastBellRuntimeEvent[] = [];
    this.doors = createDoorSystem(LAST_BELL_DOORS);
    this.noises = [];
    this.pendingDoorLocks.clear();
    this.progress.captured = false;
    const crossedUnsealedFirstDoor = this.checkpointId === null
      && this.chapterId === 'chapter-01'
      && this.progress.classroomDoorOpened
      && this.player.position.z > 13.55;
    const caughtInsideFirstDoorSensor = this.checkpointId === null
      && this.chapterId === 'chapter-01'
      && this.progress.classroomDoorOpened
      && !this.progress.classroomLocked
      && this.player.position.z <= 13.55;
    if (crossedUnsealedFirstDoor) {
      // A capture can happen in the brief physical interval after the player
      // crosses the slider and before their E lock command completes. Without
      // a fallback the previous implementation only cleared `captured`,
      // leaving the actor in `capture` on top of the old player position.
      // Recovery seals that already-crossed door, then emits the same safe
      // first-bay checkpoint snapshot used by the normal close/lock route.
      this.player.position = { x: 0, z: 15.2 };
      Object.assign(this.progress, {
        classroomDoorOpened: true, classroomLocked: true, firstBayCoverResolved: false,
        infirmarySearched: false, broadcastSearched: false, heavyObstacleMoved: false,
        powerRestored: false, noiseActivated: false, fireDoorOpened: false,
        fireDoorCrossed: false, fireDoorLocked: false, bellTriggered: false,
      });
      this.objectiveId = 'ch1.restore-emergency-power';
      this.restoreObjectiveEventPending = true;
      this.setPacingBeat('first-encounter');
      this.doors.advance({ deltaSeconds: 0, commands: [{ doorId: 'door.classroom.slide', type: 'lock' }] });
      resetZombies(this.zombies, 'chapter-01');
      this.zombieRecoveryHold = true;
      this.checkpoint('ch1_first_bay', events);
    } else if (caughtInsideFirstDoorSensor) {
      // Captures can also happen before the player clears the passage sensor.
      // Recreating the DoorSystem alone used to close the slider on top of the
      // player while leaving the actor in `capture`, producing an unrecoverable
      // retry. Keep the already-recorded cross/lock objective, restore the
      // player to the classroom side, and reopen the real door without
      // granting the first-bay checkpoint or emitting a duplicate verified
      // objective.
      this.player.position = { x: 0, z: 10.8 };
      Object.assign(this.progress, {
        classroomDoorOpened: true, classroomLocked: false, firstBayCoverResolved: false,
        infirmarySearched: false, broadcastSearched: false, heavyObstacleMoved: false,
        powerRestored: false, noiseActivated: false, fireDoorOpened: false,
        fireDoorCrossed: false, fireDoorLocked: false, bellTriggered: false,
      });
      this.objectiveId = 'ch1.cross-and-lock-classroom-door';
      this.setPacingBeat('first-encounter');
      this.doors.advance({
        deltaSeconds: .3,
        commands: [{ doorId: 'door.classroom.slide', type: 'open' }],
        occupants: [],
      });
      resetZombies(this.zombies, 'chapter-01');
      this.zombieRecoveryHold = true;
    } else if (this.checkpointId === 'ch1_first_bay') {
      this.player.position = { x: 0, z: 15.2 };
      Object.assign(this.progress, {
        classroomDoorOpened: true, classroomLocked: true, firstBayCoverResolved: false,
        infirmarySearched: false, broadcastSearched: false, heavyObstacleMoved: false,
        powerRestored: false, noiseActivated: false, fireDoorOpened: false,
        fireDoorCrossed: false, fireDoorLocked: false, bellTriggered: false,
      });
      this.objectiveId = 'ch1.restore-emergency-power';
      this.setPacingBeat(this.restoreObjectiveEventPending ? 'first-encounter' : 'corridor-exploration');
      this.doors.advance({ deltaSeconds: 0, commands: [{ doorId: 'door.classroom.slide', type: 'lock' }] });
      resetZombies(this.zombies, 'chapter-01');
      this.zombieRecoveryHold = true;
    } else if (this.checkpointId === 'ch1_power') {
      this.player.position = { x: 0, z: 63 };
      Object.assign(this.progress, {
        classroomDoorOpened: true, classroomLocked: true, firstBayCoverResolved: true,
        infirmarySearched: true, broadcastSearched: true, heavyObstacleMoved: true,
        powerRestored: true, noiseActivated: false, fireDoorOpened: false,
        fireDoorCrossed: false, fireDoorLocked: false, bellTriggered: false,
      });
      this.objectiveId = 'ch1.deploy-noise-device';
      this.setPacingBeat('two-zombie-passage');
      this.doors.advance({ deltaSeconds: 0, commands: [{ doorId: 'door.classroom.slide', type: 'lock' }] });
      resetZombies(this.zombies, 'chapter-01');
    } else if (this.checkpointId === 'ch2_stairwell') {
      this.chapterId = 'chapter-02';
      this.player.position = { x: 0, z: 70 };
      Object.assign(this.progress, {
        rooftopDoorOpened: false, rooftopPhase: 'sealed', rooftopPhaseSeconds: 0,
        chapterComplete: false, gameComplete: false,
        stairwellCandleInspected: false, stairwellBlanketInspected: false,
      });
      this.objectiveId = 'ch2.search-stairwell';
      this.setPacingBeat('stairwell-search');
      this.zombies.forEach((zombie) => { zombie.active = false; });
    }
    this.currentInput = {};
    this.clearStealth();
    return { snapshot: this.snapshot(), events };
  }

  /** Backward-compatible snapshot helper for non-renderer callers. */
  retryFromCheckpoint(): LastBellSimulationSnapshot {
    return this.retryFrameFromCheckpoint().snapshot;
  }

  private step(events: LastBellRuntimeEvent[]): void {
    this.tick += 1;
    this.elapsedSeconds = this.tick * LAST_BELL_SIMULATION_STEP_SECONDS;
    this.emitInitialRouteEvents(events);
    this.updateStealthState();
    this.applyInput();
    this.applyQueuedInteractions(events);

    const doorFrame = this.doors.advance({
      deltaSeconds: LAST_BELL_SIMULATION_STEP_SECONDS,
      occupants: this.doorOccupants(),
    });
    this.completePendingDoorLocks(doorFrame.doors, events);
    const movedMeters = this.movePlayer(doorFrame.doors);
    this.observeRouteEvidence();
    this.advancePacing(movedMeters, events);
    this.updateCheckpoints(events);
    this.updateNoises();
    this.updateForeshadowing(events);
    this.updateZombies(doorFrame.doors, events);
    this.updateRooftopSequence(events);
    this.advanceChapterWhenEligible(events);
  }

  /**
   * Rehydrates only milestones that the service has already verified. Exact
   * free-roam coordinates are deliberately not trusted or persisted; each
   * stage resumes from its authored safe anchor.
   */
  private restoreVerifiedProgressStage(rawStage: number): void {
    const stage = Number.isSafeInteger(rawStage) ? Math.min(11, Math.max(0, rawStage)) : 0;
    this.initialObjectiveEventPending = false;
    this.initialCheckpointEventPending = false;

    if (stage <= 1) {
      this.chapterId = 'chapter-01';
      this.objectiveId = 'ch1.open-classroom-door';
      this.player.position = { x: 0, z: 4 };
      this.setPacingBeat('opening-inspection');
      this.initialObjectiveEventPending = stage === 0;
      return;
    }

    if (stage === 2) {
      this.setElapsedSeconds(LAST_BELL_PACING_SECONDS.chapter01.firstBayLock);
      this.chapterId = 'chapter-01';
      this.player.position = { x: 0, z: 15.2 };
      this.checkpointId = 'ch1_first_bay';
      this.objectiveId = 'ch1.restore-emergency-power';
      Object.assign(this.progress, {
        classroomDoorOpened: true, classroomLocked: true,
        firstBayCoverResolved: false,
      });
      this.lockDoor('door.classroom.slide');
      this.setPacingBeat('first-encounter');
      this.restoreObjectiveEventPending = true;
      return;
    }

    if (stage === 3) {
      this.setElapsedSeconds(LAST_BELL_PACING_SECONDS.chapter01.restoreObjective);
      this.chapterId = 'chapter-01';
      this.player.position = { x: 0, z: 15.2 };
      this.checkpointId = 'ch1_first_bay';
      this.objectiveId = 'ch1.restore-emergency-power';
      Object.assign(this.progress, {
        classroomDoorOpened: true, classroomLocked: true,
        firstBayCoverResolved: true,
      });
      this.lockDoor('door.classroom.slide');
      this.setPacingBeat('corridor-exploration');
      return;
    }

    if (stage === 4) {
      this.setElapsedSeconds(LAST_BELL_PACING_SECONDS.chapter01.power);
      this.chapterId = 'chapter-01';
      this.player.position = { x: 0, z: 63 };
      this.checkpointId = 'ch1_power';
      this.objectiveId = 'ch1.deploy-noise-device';
      Object.assign(this.progress, {
        classroomDoorOpened: true, classroomLocked: true,
        firstBayCoverResolved: true, infirmarySearched: true,
        broadcastSearched: true, heavyObstacleMoved: true, powerRestored: true,
      });
      this.foreshadowing.add('strength');
      this.lockDoor('door.classroom.slide');
      this.setPacingBeat('two-zombie-passage');
      return;
    }

    if (stage === 5) {
      this.setElapsedSeconds(LAST_BELL_PACING_SECONDS.chapter01.fireDoorLock);
      this.chapterId = 'chapter-01';
      // Stage 5 is emitted by the bell interaction itself. A resumed run is
      // therefore already on the escape side of that prop, never forced to
      // replay the verified prompt and lose the server's 425s handoff.
      this.player.position = { x: 0, z: 73 };
      this.checkpointId = 'ch1_power';
      this.objectiveId = 'ch1.reach-rooftop-stairwell';
      Object.assign(this.progress, {
        classroomDoorOpened: true,
        classroomLocked: true,
        firstBayCoverResolved: true,
        infirmarySearched: true,
        broadcastSearched: true,
        heavyObstacleMoved: true,
        powerRestored: true,
        noiseActivated: true,
        fireDoorOpened: true,
        fireDoorCrossed: true,
        fireDoorLocked: true,
        bellTriggered: true,
      });
      this.foreshadowing.add('strength');
      this.lockDoor('door.classroom.slide');
      this.lockDoor('door.fire');
      this.zombies.forEach((zombie) => { zombie.active = true; });
      this.setPacingBeat('bell-chase');
      return;
    }

    if (stage === 6 && this.runMode === 'chapter-replay' && this.chapterId === 'chapter-01') {
      this.setElapsedSeconds(LAST_BELL_PACING_SECONDS.chapter01.exit);
      this.player.position = { x: 0, z: 78 };
      this.checkpointId = 'ch1_power';
      this.objectiveId = 'ch1.reach-rooftop-stairwell';
      Object.assign(this.progress, {
        classroomDoorOpened: true,
        classroomLocked: true,
        firstBayCoverResolved: true,
        infirmarySearched: true,
        broadcastSearched: true,
        heavyObstacleMoved: true,
        powerRestored: true,
        noiseActivated: true,
        fireDoorOpened: true,
        fireDoorCrossed: true,
        fireDoorLocked: true,
        bellTriggered: true,
        chapterComplete: true,
      });
      this.completedChapters.add('chapter-01');
      this.foreshadowing.add('strength');
      this.lockDoor('door.classroom.slide');
      this.lockDoor('door.fire');
      this.zombies.forEach((zombie) => { zombie.active = false; });
      this.setPacingBeat('complete');
      return;
    }

    this.chapterId = 'chapter-02';
    this.completedChapters.add('chapter-01');
    this.checkpointId = null;
    this.objectiveId = 'ch2.enter-stairwell';
    this.player.position = { x: 0, z: 70 };
    this.zombies.forEach((zombie) => { zombie.active = false; });

    if (stage === 6) {
      this.setElapsedSeconds(0);
      this.objectiveId = 'ch2.search-stairwell';
      this.checkpointId = 'ch2_stairwell';
      this.setPacingBeat('stairwell-search');
      this.initialObjectiveEventPending = true;
      this.initialCheckpointEventPending = true;
      return;
    }
    if (stage === 7) {
      this.setElapsedSeconds(LAST_BELL_PACING_SECONDS.chapter02.stairwellCheckpoint);
      this.objectiveId = 'ch2.search-stairwell';
      this.checkpointId = 'ch2_stairwell';
      this.setPacingBeat('stairwell-search');
      this.initialCheckpointEventPending = true;
      return;
    }
    if (stage === 8) {
      this.setElapsedSeconds(LAST_BELL_PACING_SECONDS.chapter02.stairwellCheckpoint);
      this.objectiveId = 'ch2.search-stairwell';
      this.checkpointId = 'ch2_stairwell';
      this.setPacingBeat('stairwell-search');
      return;
    }

    this.progress.stairwellCandleInspected = true;
    this.progress.stairwellBlanketInspected = true;
    this.progress.rooftopDoorOpened = true;
    this.progress.rooftopPhase = 'approach';
    this.objectiveId = 'ch2.approach-namra';
    this.player.position = { x: 0, z: 84 };
    // Stage 9 means the server has already accepted the rooftop-door verb.
    // Rehydrate that completed state through DoorSystem fixed steps; normal E
    // interactions always expose the opening animation to the renderer.
    this.restoreVerifiedOpenDoor('door.rooftop');
    this.setElapsedSeconds(LAST_BELL_PACING_SECONDS.chapter02.rooftopDoor);
    this.setPacingBeat('rooftop-approach');

    if (stage === 9) return;

    this.player.position = { x: 0, z: 101.5 };
    this.progress.rooftopPhase = 'black';
    this.progress.chapterComplete = true;
    this.objectiveId = 'ch2.cut-to-black';
    this.setElapsedSeconds(
      LAST_BELL_PACING_SECONDS.chapter02.namraRecognition
        + LAST_BELL_PACING_SECONDS.chapter02.recognitionDuration
        + LAST_BELL_PACING_SECONDS.chapter02.subdueDuration,
    );
    if (stage === 10) return;

    this.progress.rooftopPhaseSeconds = LAST_BELL_PACING_SECONDS.chapter02.blackDuration;
    this.progress.gameComplete = true;
    this.setPacingBeat('complete');
    for (const key of this.pending) this.committed.add(key);
    this.pending.clear();
  }

  private setElapsedSeconds(seconds: number): void {
    this.tick = Math.round(seconds * LAST_BELL_SIMULATION_HZ);
    this.elapsedSeconds = this.tick * LAST_BELL_SIMULATION_STEP_SECONDS;
  }

  private setPacingBeat(beatId: LastBellPacingBeatId): void {
    this.pacing = {
      beatId,
      activeSeconds: 0,
      movementMeters: 0,
      traversedZones: new Set(),
      stealthChanges: 0,
      respondedZombieIds: new Set(),
    };
  }

  /**
   * The objective contract remains stable for verified runs, while this text
   * names the next concrete authored verb. It never changes a server-trusted
   * objective ID or unlocks an E prompt by elapsed time.
   */
  private pacingInstruction(fallback: string): string {
    if (this.pacing.beatId === 'first-encounter' && !this.progress.firstBayCoverResolved) {
      return '감염자가 가까이 수색할 때 사물함이나 책상 아래에 실제로 숨으세요.';
    }
    if (this.pacing.beatId === 'corridor-exploration') {
      if (!this.progress.infirmarySearched) return '보건실 안쪽까지 들어가 길을 확인하세요.';
      if (!this.progress.broadcastSearched) return '방송실 책상까지 들어가 길을 확인하세요.';
      if (!this.progress.heavyObstacleMoved) return '설비실의 무거운 잔해를 밀어 전원반으로 가세요.';
    }
    if (this.pacing.beatId === 'two-zombie-passage' && !this.progress.fireDoorCrossed) {
      return '고정 소음에 두 감염자가 반응한 틈에 열린 방화문을 통과하세요.';
    }
    if (this.pacing.beatId === 'stairwell-search') {
      if (!this.progress.stairwellCandleInspected) return '계단실 선반의 불빛 흔적을 확인하세요.';
      if (!this.progress.stairwellBlanketInspected) return '옥상 출입구 비상함을 확인하세요.';
    }
    return fallback;
  }

  private routeEvidence(): LastBellRouteEvidenceId[] {
    const evidence: LastBellRouteEvidenceId[] = [];
    if (this.progress.firstBayCoverResolved) evidence.push('first-bay-cover');
    if (this.progress.infirmarySearched) evidence.push('infirmary-search');
    if (this.progress.broadcastSearched) evidence.push('broadcast-search');
    if (this.progress.heavyObstacleMoved) evidence.push('heavy-obstacle');
    if (this.progress.fireDoorCrossed) evidence.push('fire-door-passage');
    if (this.progress.stairwellCandleInspected) evidence.push('stairwell-candle-shelf');
    if (this.progress.stairwellBlanketInspected) evidence.push('stairwell-blanket-case');
    return evidence;
  }

  private isPacingReady(beatId = this.pacing.beatId): boolean {
    return this.pacing.beatId !== beatId || this.hasPacingRouteEvidence(beatId);
  }

  private advancePacing(movedMeters: number, events: LastBellRuntimeEvent[]): void {
    if (this.progress.captured || this.progress.gameComplete || this.pacing.beatId === 'complete' || !this.isPacingActive(movedMeters)) return;
    const beat = LAST_BELL_PACING_BEATS[this.pacing.beatId];
    this.pacing.movementMeters += movedMeters;
    this.pacing.traversedZones.add(zoneForLastBellPosition(this.player.position));
    this.pacing.activeSeconds = Math.min(
      beat.targetActiveSeconds,
      this.pacing.activeSeconds + LAST_BELL_SIMULATION_STEP_SECONDS,
    );
    if (!this.isPacingReady()) return;
    if (this.pacing.beatId === 'first-encounter' && this.restoreObjectiveEventPending) {
      this.restoreObjectiveEventPending = false;
      // The UI already points toward the power route after the door locks;
      // this event is the authoritative stage-3 proof, not a second prompt.
      events.push({
        type: 'objective',
        chapterId: 'chapter-01',
        objectiveId: 'ch1.restore-emergency-power',
        zoneId: zoneForLastBellPosition(this.player.position),
        atSeconds: round(this.elapsedSeconds),
      });
      this.setPacingBeat('corridor-exploration');
    }
  }

  private hasPacingRouteEvidence(beatId: LastBellPacingBeatId): boolean {
    const zones = this.pacing.traversedZones;
    switch (beatId) {
      case 'opening-inspection': return true;
      case 'first-encounter': return this.progress.firstBayCoverResolved
        && zones.has('corridor')
        && this.player.position.z >= 26.5;
      case 'corridor-exploration': return this.progress.infirmarySearched
        && this.progress.broadcastSearched
        && this.progress.heavyObstacleMoved
        && zones.has('utility');
      case 'two-zombie-passage': return this.progress.fireDoorLocked
        && this.progress.fireDoorCrossed
        && this.pacing.respondedZombieIds.size >= 2
        && zones.has('stairwell');
      case 'bell-chase': return this.player.position.z >= 75;
      case 'stairwell-search': return this.progress.stairwellCandleInspected
        && this.progress.stairwellBlanketInspected
        && zones.has('stairwell')
        && this.player.position.z >= 80.5;
      case 'rooftop-approach': return zones.has('rooftop') && this.player.position.z >= 99.1;
      case 'complete': return true;
    }
  }

  private isPacingActive(movedMeters: number): boolean {
    const zoneId = zoneForLastBellPosition(this.player.position);
    const quietTraversal = this.player.listening || this.player.crouching;
    const protectedHideDwell = this.hasFirstEncounterHideDwellEvidence();
    // Intent is deliberately insufficient: a blocked collider, a stationary
    // Q hold, a single C toggle, or an empty hiding spot must not turn into
    // elapsed pacing time. The one stationary exception is an actual hidden
    // wait while a nearby actor is visibly investigating/searching cover.
    if (movedMeters < .001 && !protectedHideDwell) return false;
    switch (this.pacing.beatId) {
      case 'opening-inspection': return false;
      case 'first-encounter': return this.progress.classroomDoorOpened
        && this.progress.firstBayCoverResolved
        && (quietTraversal || protectedHideDwell || this.player.stealthState === 'hidden');
      case 'corridor-exploration': return ['corridor', 'infirmary', 'broadcast', 'utility'].includes(zoneId);
      case 'two-zombie-passage': return this.progress.noiseActivated && this.zombies.filter((zombie) => zombie.active).length === 2;
      case 'bell-chase': return this.progress.bellTriggered;
      case 'stairwell-search': return !this.progress.rooftopDoorOpened;
      // The cinematic approach starts at the opened portal, including its
      // short stairwell-side door animation. Requiring a post-portal zone
      // would discard valid forward input from a player who opened while
      // hidden; actual cleared displacement remains mandatory above.
      case 'rooftop-approach': return !this.player.running;
      case 'complete': return false;
    }
  }

  /**
   * Cover can earn a brief first-encounter dwell only when the authored actor
   * is actually near the same hiding beat. This deliberately rejects AFK time
   * in an empty locker or a desk far behind the classroom door.
   */
  private hasFirstEncounterHideDwellEvidence(): boolean {
    if (this.pacing.beatId !== 'first-encounter' || this.player.stealthState !== 'hidden') return false;
    return this.zombies.some((zombie) => (
      zombie.active
      && (zombie.state === 'investigate' || zombie.state === 'search')
      && distance(zombie.position, this.player.position) <= 4.8
    ));
  }

  /**
   * Reaching an inspection seam is spatial proof, not a pickup surrogate. The
   * route assets own these named locations; if an asset contract is absent the
   * interaction remains unavailable rather than receiving a primitive stand-in.
   */
  private observeRouteEvidence(): void {
    for (const evidence of LAST_BELL_ROUTE_EVIDENCE) {
      if (evidence.chapterId !== this.chapterId || distance(this.player.position, evidence.position) > evidence.radius) continue;
      if (evidence.id === 'infirmary-search') this.progress.infirmarySearched = true;
      else if (evidence.id === 'broadcast-search') this.progress.broadcastSearched = true;
      else if (evidence.id === 'stairwell-candle-shelf') this.progress.stairwellCandleInspected = true;
      else if (evidence.id === 'stairwell-blanket-case') this.progress.stairwellBlanketInspected = true;
    }
    if (this.progress.fireDoorOpened && this.player.position.z > 67.55) this.progress.fireDoorCrossed = true;
  }

  /** A first-bay cover verb is only valid when the visible actor is investigating it. */
  private resolveFirstBayCover(): void {
    if (
      this.progress.firstBayCoverResolved
      || this.chapterId !== 'chapter-01'
      || !this.progress.classroomLocked
      || this.player.hidingSpotId !== 'ch1.hide.locker'
    ) return;
    const firstZombie = this.zombies.find((zombie) => zombie.id === 'zombie-01' && zombie.active);
    if (!firstZombie) return;
    const nearbySearch = (firstZombie.state === 'investigate' || firstZombie.state === 'search')
      && distance(firstZombie.position, this.player.position) <= 6.2;
    if (nearbySearch) this.progress.firstBayCoverResolved = true;
  }

  private lockDoor(doorId: string): void {
    this.doors.advance({ deltaSeconds: 0, commands: [{ doorId, type: 'close' }, { doorId, type: 'lock' }] });
  }

  private openDoor(doorId: string): void {
    // A command is accepted immediately, but the DoorSystem is the only
    // authority that may progress it.  In particular, never use a synthetic
    // large delta here: it skips the visible opening state and causes render,
    // collision, LOS, and nav to disagree for a frame.
    this.doors.advance({ deltaSeconds: 0, commands: [{ doorId, type: 'open' }] });
  }

  /**
   * A verified resume starts after a previously completed door interaction.
   * Keep it separate from `openDoor` so an input command can never fast-forward
   * visual motion, while restoration still derives collision/LOS/nav from the
   * exact same fixed-step DoorSystem lifecycle.
   */
  private restoreVerifiedOpenDoor(doorId: string): void {
    this.openDoor(doorId);
    for (let step = 0; step < 32; step += 1) {
      const frame = this.doors.advance({
        deltaSeconds: LAST_BELL_SIMULATION_STEP_SECONDS,
        occupants: [],
      });
      if (frame.doors.find((door) => door.id === doorId)?.state === 'open') return;
    }
    throw new Error(`Unable to restore verified open door: ${doorId}`);
  }

  private applyInput(): void {
    const input = this.currentInput;
    if (Number.isFinite(input.facingRadians)) this.player.facingRadians = input.facingRadians!;
    if (typeof input.flashlightOn === 'boolean') this.player.flashlightOn = input.flashlightOn;
    if (typeof input.crouching === 'boolean'
      && (this.player.stealthState === 'standing' || this.player.stealthState === 'crouched')) {
      if (input.crouching !== this.player.crouching) this.pacing.stealthChanges += 1;
      this.player.crouching = input.crouching;
      this.player.stealthState = input.crouching ? 'crouched' : 'standing';
    }
    if (typeof input.listening === 'boolean' && input.listening !== this.player.listening) {
      this.player.listening = input.listening;
      this.pacing.stealthChanges += 1;
    }
    // Cover is an authored place, not a holdable client input. In particular,
    // a C toggle cannot make a player invisible away from a locker or desk.
    if (typeof input.running === 'boolean') this.player.running = input.running;
  }

  private updateStealthState(): void {
    if (this.player.stealthState === 'hidden') {
      // The actor can begin investigating one or two fixed steps after the
      // locker curtain closes. Sample the authored hidden state each tick so
      // this is a real AI response, not a race against the enter animation.
      this.resolveFirstBayCover();
      return;
    }
    if (this.player.stealthState !== 'entering-hide' && this.player.stealthState !== 'exiting-hide') return;
    this.player.stealthTransitionSeconds = Math.max(0, this.player.stealthTransitionSeconds - LAST_BELL_SIMULATION_STEP_SECONDS);
    if (this.player.stealthTransitionSeconds > 0) return;
    if (this.player.stealthState === 'entering-hide') {
      this.player.stealthState = 'hidden';
      this.player.hiding = true;
      this.resolveFirstBayCover();
      return;
    }
    this.player.stealthState = 'standing';
    this.player.hiding = false;
    this.player.hidingSpotId = null;
  }

  /** Leaves all general stealth affordances before a checkpoint/cinematic seam. */
  private clearStealth(): void {
    this.player.crouching = false;
    this.player.hiding = false;
    this.player.listening = false;
    this.player.running = false;
    this.player.stealthState = 'standing';
    this.player.hidingSpotId = null;
    this.player.stealthTransitionSeconds = 0;
  }

  private doorOccupants() {
    return [
      toDoorOccupant('player', this.player.position),
      ...this.zombies.filter((zombie) => zombie.active).map((zombie) => toDoorOccupant(zombie.id, zombie.position)),
    ];
  }

  private applyQueuedInteractions(events: LastBellRuntimeEvent[]): void {
    const interactions = this.queuedInteractions.splice(0);
    for (const id of interactions) {
      const interaction = LAST_BELL_INTERACTIONS.find((candidate) => candidate.id === id);
      if (
        !interaction
        || interaction.chapterId !== this.chapterId
        || !this.isInteractionEnabled(interaction.id, interaction.kind)
        || distance(this.player.position, interaction.position) > INTERACTION_RADIUS
      ) continue;
      this.applyInteraction(interaction.id, interaction.kind, interaction.collectibleKey, events);
    }
  }

  private applyInteraction(id: string, kind: LastBellInteractionKind, collectibleKey: CollectibleKey | undefined, events: LastBellRuntimeEvent[]): void {
    if (kind === 'item' && collectibleKey) {
      if (this.collected.has(collectibleKey) || this.committed.has(collectibleKey)) return;
      this.collected.add(collectibleKey);
      this.pending.add(collectibleKey);
      events.push({ type: 'pickup', chapterId: this.chapterId, collectibleKey, atSeconds: round(this.elapsedSeconds) });
      return;
    }
    if (id === 'ch1.classroom-door.open') {
      this.openDoor('door.classroom.slide');
      this.progress.classroomDoorOpened = true;
      this.setPacingBeat('first-encounter');
      this.setObjective('ch1.cross-and-lock-classroom-door', events);
      return;
    }
    if (id === 'ch1.classroom-door.lock') {
      this.lockDoor('door.classroom.slide');
      this.pendingDoorLocks.add('door.classroom.slide');
      return;
    }
    if (kind === 'locker-hide') {
      const spot = hidingSpotForInteraction(id);
      if (!spot) return;
      if (this.player.stealthState === 'hidden' && this.player.hidingSpotId === spot.id) {
        this.player.stealthState = 'exiting-hide';
        this.player.stealthTransitionSeconds = spot.exitSeconds;
        this.player.hiding = false;
      } else if (this.player.stealthState === 'standing' || this.player.stealthState === 'crouched') {
        this.player.stealthState = 'entering-hide';
        this.player.hidingSpotId = spot.id;
        this.player.stealthTransitionSeconds = spot.entrySeconds;
        this.player.hiding = false;
        this.player.crouching = false;
        this.player.listening = false;
        this.player.running = false;
        this.pacing.stealthChanges += 1;
        if (spot.id === 'ch1.hide.locker' && this.progress.classroomLocked) {
          // The locker door/cloth is a spatial audio cue, so the first actor
          // has a readable reason to inspect this real hiding place. This
          // cannot exist away from the authored interaction seam.
          this.noises.push({ position: { ...spot.position }, intensity: .62, remainingSeconds: .85 });
          const firstZombie = this.zombies.find((zombie) => zombie.id === 'zombie-01' && zombie.active);
          if (firstZombie && firstZombie.state !== 'capture' && distance(firstZombie.position, spot.position) <= 10) {
            // An authored locker slam overrides an abandoned footstep search;
            // otherwise the actor could keep inspecting an old noise while
            // visibly ignoring the hiding prop beside the player.
            firstZombie.state = 'investigate';
            firstZombie.investigatePosition = { ...spot.position };
            firstZombie.searchSeconds = 0;
          }
        }
      }
      return;
    }
    if (id === 'ch1.heavy-obstacle.move') {
      this.progress.heavyObstacleMoved = true;
      // This is the first of the three infection hints. It is attached to the
      // physical authored obstacle rather than a generic power-panel success.
      this.emitForeshadowing('strength', events);
      return;
    }
    if (id === 'ch1.power.panel') {
      this.progress.powerRestored = true;
      this.checkpoint('ch1_power', events);
      this.setObjective('ch1.deploy-noise-device', events);
      return;
    }
    if (id === 'ch1.noise.device') {
      this.progress.noiseActivated = true;
      // The fixed alarm is deliberately loud enough for both authored actors;
      // positional rendering still attenuates each actor's own response audio.
      this.noises.push({ position: { x: -1.45, z: 64.3 }, intensity: 1.35, remainingSeconds: 8 });
      this.zombies.forEach((zombie) => { zombie.active = true; });
      this.setObjective('ch1.open-fire-door', events);
      this.setPacingBeat('two-zombie-passage');
      return;
    }
    if (id === 'ch1.fire-door.open') {
      this.openDoor('door.fire');
      this.progress.fireDoorOpened = true;
      this.setObjective('ch1.cross-and-lock-fire-door', events);
      return;
    }
    if (id === 'ch1.fire-door.lock') {
      this.lockDoor('door.fire');
      this.pendingDoorLocks.add('door.fire');
      return;
    }
    if (id === 'ch1.last-bell') {
      this.progress.bellTriggered = true;
      this.noises.push({ position: { x: 1.25, z: 73 }, intensity: 1, remainingSeconds: 9 });
      this.setObjective('ch1.ring-last-bell', events);
      this.setPacingBeat('bell-chase');
      return;
    }
    if (id === 'ch2.rooftop-door.open') {
      this.openDoor('door.rooftop');
      this.progress.rooftopDoorOpened = true;
      this.progress.rooftopPhase = 'approach';
      // The post-door seam removes the normal C/Q/Shift affordances. Clear
      // their simulation state before movement is evaluated so a player who
      // opened the door while hidden can immediately use cinematic walk/E.
      this.clearStealth();
      this.setPacingBeat('rooftop-approach');
      // Past this seam the story has no zombie, pickup, or commerce-facing surface.
      this.zombies.forEach((zombie) => { zombie.active = false; });
      this.noises = [];
      // The avatar is still physically in the stairwell for this fixed step,
      // but the objective is the rooftop-side portal milestone. The verified
      // ledger consequently receives the authored destination zone instead
      // of a stale snapshot zone and can accept stage 9.
      this.setObjective('ch2.approach-namra', events, 'rooftop');
      return;
    }
    if (id === 'ch2.namra' && this.progress.rooftopDoorOpened && this.isPacingReady('rooftop-approach')) {
      this.progress.rooftopPhase = 'recognition';
      this.progress.rooftopPhaseSeconds = 0;
      this.setObjective('ch2.namra-recognizes-danger', events);
    }
  }

  private movePlayer(doors: readonly DoorSnapshot[]): number {
    if (this.progress.captured || this.progress.gameComplete || this.progress.rooftopPhase === 'recognition' || this.progress.rooftopPhase === 'subdue' || this.progress.rooftopPhase === 'black') return 0;
    if (this.player.stealthState === 'entering-hide' || this.player.stealthState === 'hidden' || this.player.stealthState === 'exiting-hide') return 0;
    const input = this.currentInput.movement ?? { x: 0, y: 0 };
    const magnitude = Math.hypot(input.x, input.y);
    if (magnitude < .001) return 0;
    const normalizedX = input.x / Math.max(1, magnitude);
    const normalizedY = input.y / Math.max(1, magnitude);
    const { forward, right } = movementBasisFromFacing(this.player.facingRadians);
    const speed = this.pacing.beatId === 'rooftop-approach'
      ? ROOFTOP_APPROACH_SPEED
      : this.player.crouching ? CROUCH_SPEED : this.player.running ? RUN_SPEED : WALK_SPEED;
    const candidate = {
      x: this.player.position.x + (right.x * normalizedX + forward.x * normalizedY) * speed * LAST_BELL_SIMULATION_STEP_SECONDS,
      z: this.player.position.z + (right.z * normalizedX + forward.z * normalizedY) * speed * LAST_BELL_SIMULATION_STEP_SECONDS,
    };
    // The final approach is deliberately camera/actor controlled. Keeping the
    // player at the campfire mark still requires held walking input to earn
    // the beat; idle at Nam-ra never starts recognition.
    if (this.pacing.beatId === 'rooftop-approach') candidate.z = Math.min(candidate.z, 99.4);
    const previous = this.player.position;
    if (isWalkable(candidate) && !crossesBlockedDoor(previous, candidate, doors)) this.player.position = candidate;
    if (!this.player.hiding && magnitude > .1) {
      this.noises.push({
        position: { ...this.player.position },
        intensity: this.player.crouching ? .18 : this.player.running ? .85 : .42,
        remainingSeconds: .18,
      });
    }
    return distance(previous, this.player.position);
  }

  private updateCheckpoints(events: LastBellRuntimeEvent[]): void {
    if (this.chapterId === 'chapter-01' && this.progress.classroomLocked && this.player.position.z > 15 && this.checkpointId === null) {
      this.checkpoint('ch1_first_bay', events);
    }
  }

  private completePendingDoorLocks(doors: readonly DoorSnapshot[], events: LastBellRuntimeEvent[]): void {
    const locked = (doorId: 'door.classroom.slide' | 'door.fire') => doors.find((door) => door.id === doorId)?.state === 'locked';
    if (this.pendingDoorLocks.has('door.classroom.slide') && locked('door.classroom.slide')) {
      this.pendingDoorLocks.delete('door.classroom.slide');
      this.progress.classroomLocked = true;
      this.checkpoint('ch1_first_bay', events);
      // The screen may immediately direct the player toward the power route,
      // but the server-facing stage-3 event waits for the active first-zombie
      // traversal. No wall-clock gate blocks the close/lock verb itself.
      this.objectiveId = 'ch1.restore-emergency-power';
      this.restoreObjectiveEventPending = true;
    }
    if (this.pendingDoorLocks.has('door.fire') && locked('door.fire')) {
      this.pendingDoorLocks.delete('door.fire');
      this.progress.fireDoorLocked = true;
      this.setObjective('ch1.survive-two-zombie-passage', events);
    }
  }

  private updateNoises(): void {
    this.noises = this.noises
      .map((noise) => ({ ...noise, remainingSeconds: noise.remainingSeconds - LAST_BELL_SIMULATION_STEP_SECONDS }))
      .filter((noise) => noise.remainingSeconds > 0);
  }

  private emitForeshadowing(cue: LastBellInfectionForeshadowing, events: LastBellRuntimeEvent[]): void {
    if (this.foreshadowing.has(cue)) return;
    this.foreshadowing.add(cue);
    this.progress.activeForeshadowing = cue;
    this.progress.foreshadowingSeconds = cue === 'rapid-recovery' ? 1.15 : 1.6;
    events.push({ type: 'foreshadowing', chapterId: this.chapterId, cue, atSeconds: round(this.elapsedSeconds) });
  }

  private updateForeshadowing(events: LastBellRuntimeEvent[]): void {
    if (this.progress.foreshadowingSeconds > 0) {
      this.progress.foreshadowingSeconds = Math.max(0, this.progress.foreshadowingSeconds - LAST_BELL_SIMULATION_STEP_SECONDS);
      if (this.progress.foreshadowingSeconds === 0) this.progress.activeForeshadowing = null;
    }
    // This is a forced-but-non-failure recovery beat on the successful bell
    // route: the camera/audio cue lands as the player clears the stairwell,
    // then gameplay continues into the Chapter 2 handoff.
    if (this.chapterId === 'chapter-01' && this.progress.bellTriggered && this.player.position.z >= 75) {
      this.emitForeshadowing('rapid-recovery', events);
    }
  }

  private updateZombies(doors: readonly DoorSnapshot[], events: LastBellRuntimeEvent[]): void {
    if (this.chapterId !== 'chapter-01' || this.progress.rooftopDoorOpened || this.progress.captured) return;
    if (this.zombieRecoveryHold) {
      const movement = this.currentInput.movement;
      if (!movement || Math.hypot(movement.x, movement.y) < .05) return;
      this.zombieRecoveryHold = false;
    }
    if (this.progress.noiseActivated && this.progress.fireDoorOpened && this.player.position.z >= 67.3) {
      // The infected halt at the scent/noise conflict as the player clears
      // the fire-door breach. It is a readable AI beat, not a static flag.
      this.emitForeshadowing('scent-hesitation', events);
    }
    for (const zombie of this.zombies) {
      if (!zombie.active) continue;
      const lineOfSight = hasLineOfSight(zombie.position, this.player.position, doors)
        && navReachable(zombie.position, this.player.position, doors);
      const playerDistance = distance(zombie.position, this.player.position);
      const beamExposure = this.player.flashlightOn && lineOfSight && playerDistance <= 10
        && angleDegrees(this.player.facingRadians, this.player.position, zombie.position) <= 24;
      // Focused listening and crouching are the playable quiet-traversal
      // states: both still need real cleared movement to earn pacing. Hiding
      // is stationary cover and needs the nearby-investigation evidence above.
      const visualContact = lineOfSight && !this.player.hiding && !this.player.listening && !this.player.crouching && playerDistance <= 6;
      const heard = loudestAudibleNoise(zombie.position, this.noises, doors);
      if (this.pacing.beatId === 'two-zombie-passage' && heard?.intensity === 1.35) {
        // An actor may already be investigating the player's earlier footstep.
        // Hearing the fixed alarm is still independent encounter evidence.
        this.pacing.respondedZombieIds.add(zombie.id);
      }

      if (beamExposure) zombie.lightSeconds += LAST_BELL_SIMULATION_STEP_SECONDS;
      else zombie.lightSeconds = Math.max(0, zombie.lightSeconds - LAST_BELL_SIMULATION_STEP_SECONDS * .6);

      if (zombie.hesitationSeconds > 0) {
        zombie.hesitationSeconds = Math.max(0, zombie.hesitationSeconds - LAST_BELL_SIMULATION_STEP_SECONDS);
        if (zombie.hesitationSeconds === 0) zombie.state = 'patrol';
        continue;
      }

      const detectedPlayer = visualContact || zombie.lightSeconds >= .3;
      if (
        detectedPlayer
        && zombie.id === 'zombie-01'
        && !this.progress.classroomLocked
        && !this.foreshadowing.has('scent-hesitation')
      ) {
        // The first infection clue is playable AI, not a caption: the actor
        // acquires the player, then pauses to sniff the anomalous target. A
        // player who crosses the open slider immediately can close and lock it.
        zombie.state = 'investigate';
        zombie.investigatePosition = null;
        zombie.hesitationSeconds = 1.8;
        this.emitForeshadowing('scent-hesitation', events);
        continue;
      }

      if (detectedPlayer && zombie.state !== 'capture') {
        zombie.state = 'chase';
        zombie.lastSeenPosition = { ...this.player.position };
        zombie.lostSeconds = 0;
      } else if (zombie.state === 'patrol' && heard) {
        zombie.state = 'investigate';
        zombie.investigatePosition = heard.position;
      }

      if (zombie.state === 'chase') {
        if (visualContact || beamExposure) {
          zombie.lastSeenPosition = { ...this.player.position };
          zombie.lostSeconds = 0;
        } else {
          zombie.lostSeconds += LAST_BELL_SIMULATION_STEP_SECONDS;
          if (zombie.lostSeconds >= 2.4) {
            zombie.state = 'search';
            zombie.searchSeconds = 3;
            zombie.investigatePosition = zombie.lastSeenPosition;
          }
        }
      } else if (zombie.state === 'investigate' && zombie.investigatePosition && distance(zombie.position, zombie.investigatePosition) < .5) {
        zombie.state = 'search';
        zombie.searchSeconds = 3;
      } else if (zombie.state === 'search') {
        zombie.searchSeconds -= LAST_BELL_SIMULATION_STEP_SECONDS;
        if (zombie.searchSeconds <= 0) zombie.state = 'patrol';
      }

      let target = zombie.state === 'chase' ? zombie.lastSeenPosition : zombie.investigatePosition;
      if (zombie.state === 'patrol' && zombie.patrolWaypoints.length > 0) {
        target = zombie.patrolWaypoints[zombie.patrolWaypointIndex] ?? null;
        if (target && distance(zombie.position, target) < .35) {
          zombie.patrolWaypointIndex = (zombie.patrolWaypointIndex + 1) % zombie.patrolWaypoints.length;
          target = zombie.patrolWaypoints[zombie.patrolWaypointIndex] ?? null;
        }
      }
      if (target) this.moveZombie(zombie, target, doors);
      const contactDistance = distance(zombie.position, this.player.position);
      // Resolve capture after movement from the live transforms. Checking the
      // stale pre-move distance (and requiring a standing-only visualContact)
      // let a flashlight-alerted actor overlap a crouched player's camera
      // forever without entering capture.
      if (zombie.state === 'chase' && !this.player.hiding && contactDistance < .7) {
        zombie.state = 'capture';
        this.progress.captured = true;
        this.emitForeshadowing('rapid-recovery', events);
        events.push({ type: 'capture', chapterId: this.chapterId, actor: 'zombie', atSeconds: round(this.elapsedSeconds) });
      }
      if (visualContact && playerDistance > 3 && playerDistance < 7) this.emitForeshadowing('scent-hesitation', events);
    }
  }

  private moveZombie(zombie: MutableZombie, target: LastBellVec2, doors: readonly DoorSnapshot[]): void {
    const nextTarget = nextNavTarget(zombie.position, target, doors);
    if (!nextTarget) return;
    const dx = nextTarget.x - zombie.position.x;
    const dz = nextTarget.z - zombie.position.z;
    const length = Math.hypot(dx, dz);
    if (length < .001) return;
    zombie.facingRadians = Math.atan2(dx, dz);
    const amount = Math.min(length, ZOMBIE_SPEED * LAST_BELL_SIMULATION_STEP_SECONDS);
    const candidate = { x: zombie.position.x + dx / length * amount, z: zombie.position.z + dz / length * amount };
    if (isWalkable(candidate) && !crossesBlockedDoor(zombie.position, candidate, doors)) zombie.position = candidate;
  }

  private updateRooftopSequence(events: LastBellRuntimeEvent[]): void {
    if (this.chapterId !== 'chapter-02' || !this.progress.rooftopDoorOpened) return;
    if (this.progress.rooftopPhase === 'recognition') {
      this.progress.rooftopPhaseSeconds += LAST_BELL_SIMULATION_STEP_SECONDS;
      if (this.progress.rooftopPhaseSeconds >= LAST_BELL_PACING_SECONDS.chapter02.recognitionDuration) {
        this.progress.rooftopPhase = 'subdue';
        this.progress.rooftopPhaseSeconds = 0;
        events.push({ type: 'capture', chapterId: 'chapter-02', actor: 'namra', atSeconds: round(this.elapsedSeconds) });
        this.setObjective('ch2.cut-to-black', events);
      }
    } else if (this.progress.rooftopPhase === 'subdue') {
      this.progress.rooftopPhaseSeconds += LAST_BELL_SIMULATION_STEP_SECONDS;
      if (this.progress.rooftopPhaseSeconds >= LAST_BELL_PACING_SECONDS.chapter02.subdueDuration) {
        this.progress.rooftopPhase = 'black';
        this.progress.rooftopPhaseSeconds = 0;
        this.progress.chapterComplete = true;
        this.completeChapter('chapter-02', events);
      }
    } else if (this.progress.rooftopPhase === 'black' && !this.progress.gameComplete) {
      this.progress.rooftopPhaseSeconds += LAST_BELL_SIMULATION_STEP_SECONDS;
      if (this.progress.rooftopPhaseSeconds >= LAST_BELL_PACING_SECONDS.chapter02.blackDuration) {
        this.progress.gameComplete = true;
        this.commitPending(events, true);
      }
    }
  }

  private advanceChapterWhenEligible(events: LastBellRuntimeEvent[]): void {
    if (this.chapterId !== 'chapter-01'
      || this.progress.chapterComplete
      || !this.progress.bellTriggered
      || !this.isPacingReady('bell-chase')
      || this.player.position.z < 78) return;
    this.progress.chapterComplete = true;
    if (this.runMode === 'chapter-replay') {
      this.commitPending(events, false);
      this.completeChapter('chapter-01', events);
      return;
    }
    this.completeChapter('chapter-01', events);
    this.startChapterTwo(events);
  }

  private startChapterTwo(events: LastBellRuntimeEvent[]): void {
    this.chapterId = 'chapter-02';
    this.player.position = { x: 0, z: 70 };
    this.clearStealth();
    this.zombies.forEach((zombie) => { zombie.active = false; });
    this.checkpointId = null;
    this.objectiveId = 'ch2.enter-stairwell';
    this.progress.chapterComplete = false;
    this.progress.rooftopPhase = 'sealed';
    this.progress.rooftopPhaseSeconds = 0;
    this.setPacingBeat('stairwell-search');
    // Stage 7 (objective) and stage 8 (checkpoint) are emitted from this
    // same server-observed tick. Only the active stairwell search that
    // follows may unlock the stage-9 rooftop objective.
    this.setObjective('ch2.search-stairwell', events);
    this.checkpoint('ch2_stairwell', events);
  }

  private completeChapter(chapterId: ChapterId, events: LastBellRuntimeEvent[]): void {
    this.completedChapters.add(chapterId);
    events.push({ type: 'chapter_complete', chapterId, atSeconds: round(this.elapsedSeconds), committedCollectibles: [...this.committed].sort() });
  }

  private commitPending(events: LastBellRuntimeEvent[], gameComplete: boolean): void {
    for (const key of this.pending) this.committed.add(key);
    this.pending.clear();
    if (gameComplete) {
      events.push({ type: 'game_complete', atSeconds: round(this.elapsedSeconds), committedCollectibles: [...this.committed].sort() });
    }
  }

  private checkpoint(checkpointId: LastBellCheckpointId, events: LastBellRuntimeEvent[]): void {
    if (this.checkpointId === checkpointId) return;
    this.checkpointId = checkpointId;
    events.push({ type: 'checkpoint', chapterId: this.chapterId, checkpointId, atSeconds: round(this.elapsedSeconds) });
  }

  private setObjective(objectiveId: string, events: LastBellRuntimeEvent[], zoneId?: ZoneId): void {
    if (this.objectiveId === objectiveId) return;
    this.objectiveId = objectiveId;
    events.push({ type: 'objective', chapterId: this.chapterId, objectiveId, atSeconds: round(this.elapsedSeconds), ...(zoneId ? { zoneId } : {}) });
  }

  private emitInitialRouteEvents(events: LastBellRuntimeEvent[]): void {
    if (this.initialObjectiveEventPending) {
      this.initialObjectiveEventPending = false;
      events.push({ type: 'objective', chapterId: this.chapterId, objectiveId: this.objectiveId, atSeconds: round(this.elapsedSeconds) });
    }
    if (this.initialCheckpointEventPending && this.chapterId === 'chapter-02' && this.checkpointId === 'ch2_stairwell') {
      this.initialCheckpointEventPending = false;
      events.push({ type: 'checkpoint', chapterId: 'chapter-02', checkpointId: 'ch2_stairwell', atSeconds: round(this.elapsedSeconds) });
    }
  }

  private availableInteractions() {
    if (this.progress.gameComplete) return [];
    return LAST_BELL_INTERACTIONS
      .filter((interaction) => interaction.chapterId === this.chapterId)
      .filter((interaction) => this.isInteractionRelevant(interaction.id, interaction.kind))
      .filter((interaction) => distance(this.player.position, interaction.position) <= INTERACTION_RADIUS)
      .filter((interaction) => interaction.kind !== 'item' || this.isInteractionEnabled(interaction.id, interaction.kind))
      .map((interaction) => {
        const enabled = this.isInteractionEnabled(interaction.id, interaction.kind);
        return {
          id: interaction.id,
          kind: interaction.kind,
          chapterId: interaction.chapterId,
          zoneId: interaction.zoneId,
          prompt: enabled ? interaction.prompt : `${interaction.prompt} · ${LAST_BELL_PACING_BEATS[this.pacing.beatId].instruction}`,
          enabled,
          position: interaction.position,
          ...(interaction.collectibleKey ? { collectibleKey: interaction.collectibleKey } : {}),
        };
      });
  }

  /** Completed verbs disappear instead of lingering as disabled E prompts. */
  private isInteractionRelevant(id: string, kind: LastBellInteractionKind): boolean {
    if (kind === 'item' || kind === 'locker-hide') return true;
    if (id === 'ch1.classroom-door.open') return !this.progress.classroomDoorOpened;
    if (id === 'ch1.classroom-door.lock') return this.progress.classroomDoorOpened
      && !this.progress.classroomLocked
      && !this.pendingDoorLocks.has('door.classroom.slide');
    if (id === 'ch1.power.panel') return this.progress.classroomLocked && !this.progress.powerRestored;
    if (id === 'ch1.heavy-obstacle.move') return this.progress.classroomLocked && !this.progress.heavyObstacleMoved;
    if (id === 'ch1.noise.device') return this.progress.powerRestored && !this.progress.noiseActivated;
    if (id === 'ch1.fire-door.open') return this.progress.noiseActivated && !this.progress.fireDoorOpened;
    if (id === 'ch1.fire-door.lock') return this.progress.fireDoorOpened
      && !this.progress.fireDoorLocked
      && !this.pendingDoorLocks.has('door.fire');
    if (id === 'ch1.last-bell') return this.progress.fireDoorLocked && !this.progress.bellTriggered;
    if (id === 'ch2.rooftop-door.open') return !this.progress.rooftopDoorOpened;
    if (id === 'ch2.namra') return this.progress.rooftopDoorOpened && this.progress.rooftopPhase === 'approach';
    return false;
  }

  private isInteractionEnabled(id: string, kind: LastBellInteractionKind): boolean {
    if (kind === 'item') {
      const key = LAST_BELL_INTERACTIONS.find((interaction) => interaction.id === id)?.collectibleKey;
      return Boolean(key && !this.collected.has(key) && !this.committed.has(key) && !this.progress.rooftopDoorOpened);
    }
    if (id === 'ch1.classroom-door.open') return !this.progress.classroomDoorOpened && this.isPacingReady('opening-inspection');
    if (id === 'ch1.classroom-door.lock') return this.progress.classroomDoorOpened && !this.progress.classroomLocked && !this.pendingDoorLocks.has('door.classroom.slide') && this.player.position.z > 13.55;
    if (kind === 'locker-hide') {
      const spot = hidingSpotForInteraction(id);
      return Boolean(spot && (this.player.stealthState === 'standing'
        || this.player.stealthState === 'crouched'
        || (this.player.stealthState === 'hidden' && this.player.hidingSpotId === spot.id)));
    }
    if (id === 'ch1.heavy-obstacle.move') return this.progress.classroomLocked
      && this.progress.infirmarySearched
      && this.progress.broadcastSearched
      && !this.progress.heavyObstacleMoved;
    if (id === 'ch1.power.panel') return this.progress.classroomLocked
      && this.progress.heavyObstacleMoved
      && !this.progress.powerRestored
      && this.isPacingReady('corridor-exploration');
    if (id === 'ch1.noise.device') return this.progress.powerRestored && !this.progress.noiseActivated;
    if (id === 'ch1.fire-door.open') return this.progress.noiseActivated && !this.progress.fireDoorOpened;
    if (id === 'ch1.fire-door.lock') return this.progress.fireDoorOpened && !this.progress.fireDoorLocked && !this.pendingDoorLocks.has('door.fire') && this.player.position.z > 67.55;
    if (id === 'ch1.last-bell') return this.progress.fireDoorLocked && !this.progress.bellTriggered && this.isPacingReady('two-zombie-passage');
    if (id === 'ch2.rooftop-door.open') return !this.progress.rooftopDoorOpened && this.isPacingReady('stairwell-search');
    if (id === 'ch2.namra') return this.progress.rooftopDoorOpened
      && this.progress.rooftopPhase === 'approach'
      && this.isPacingReady('rooftop-approach');
    return false;
  }
}

function createZombies(chapterId: ChapterId): MutableZombie[] {
  return LAST_BELL_ENCOUNTERS
    .filter((encounter) => encounter.chapterId === chapterId)
    .flatMap((encounter) => encounter.actors.map((actor) => ({
      id: actor.id,
      variant: actor.variant,
      position: { ...actor.spawn },
      facingRadians: actor.facingRadians,
      state: 'patrol' as const,
      lastSeenPosition: null,
      investigatePosition: null,
      patrolWaypoints: actor.waypoints,
      patrolWaypointIndex: 0,
      searchSeconds: 0,
      lostSeconds: 0,
      lightSeconds: 0,
      hesitationSeconds: 0,
      active: encounter.trigger.type === 'chapter-start',
    })));
}

function resetZombies(target: MutableZombie[], chapterId: ChapterId): void {
  target.splice(0, target.length, ...createZombies(chapterId));
}

function toZombieSnapshot(zombie: MutableZombie): LastBellZombieSnapshot {
  return {
    id: zombie.id, variant: zombie.variant, position: { ...zombie.position }, facingRadians: zombie.facingRadians,
    state: zombie.state, lastSeenPosition: zombie.lastSeenPosition ? { ...zombie.lastSeenPosition } : null,
    investigatePosition: zombie.investigatePosition ? { ...zombie.investigatePosition } : null,
  };
}

function box(minX: number, minZ: number, maxX: number, maxZ: number) {
  return { min: { x: minX, y: 0, z: minZ }, max: { x: maxX, y: 2.2, z: maxZ } };
}

function toDoorOccupant(id: string, position: LastBellVec2) {
  return { id, bounds: box(position.x - PLAYER_RADIUS, position.z - PLAYER_RADIUS, position.x + PLAYER_RADIUS, position.z + PLAYER_RADIUS) };
}

function isWalkable(position: LastBellVec2): boolean {
  return canOccupyLastBellPosition(position, PLAYER_RADIUS);
}

function crossesBlockedDoor(from: LastBellVec2, to: LastBellVec2, doors: readonly DoorSnapshot[]): boolean {
  for (const door of doors) {
    if (!door.blocker.blocksCollider) continue;
    const z = (door.blocker.bounds.min.z + door.blocker.bounds.max.z) / 2;
    if ((from.z - z) * (to.z - z) <= 0 && Math.abs(to.z - from.z) > .0001) {
      const crossingX = from.x + (to.x - from.x) * ((z - from.z) / (to.z - from.z));
      if (crossingX >= door.blocker.bounds.min.x && crossingX <= door.blocker.bounds.max.x) return true;
    }
  }
  return false;
}

function hasLineOfSight(from: LastBellVec2, to: LastBellVec2, doors: readonly DoorSnapshot[]): boolean {
  return isLastBellNavSegmentWalkable(from, to, 0) && !crossesBlockedDoor(from, to, doors);
}

function navReachable(from: LastBellVec2, to: LastBellVec2, doors: readonly DoorSnapshot[]): boolean {
  const fromZone = zoneForLastBellPosition(from);
  const toZone = zoneForLastBellPosition(to);
  if (fromZone === toZone) return true;
  return Boolean(navNodePath(from, to, doors));
}

function nextNavTarget(from: LastBellVec2, to: LastBellVec2, doors: readonly DoorSnapshot[]): LastBellVec2 | null {
  const fromZone = zoneForLastBellPosition(from);
  const toZone = zoneForLastBellPosition(to);
  if (fromZone === toZone) return to;
  const path = navNodePath(from, to, doors);
  if (!path || path.length < 2) return null;
  const current = LAST_BELL_NAV_NODES.find((node) => node.id === path[0]);
  if (current && distance(from, current.position) > .35) return current.position;
  return LAST_BELL_NAV_NODES.find((node) => node.id === path[1])?.position ?? null;
}

function navNodePath(from: LastBellVec2, to: LastBellVec2, doors: readonly DoorSnapshot[]): string[] | null {
  const fromZone = zoneForLastBellPosition(from);
  const toZone = zoneForLastBellPosition(to);
  const start = nearestNavNodeId(fromZone, from);
  const end = nearestNavNodeId(toZone, to);
  if (!start || !end) return null;
  const queue = [[start]];
  const visited = new Set([start]);
  const isPassable = (doorId: string | undefined) => !doorId || doors.find((door) => door.id === doorId)?.passable === true;
  while (queue.length) {
    const path = queue.shift()!;
    const current = path[path.length - 1]!;
    if (current === end) return path;
    for (const edge of LAST_BELL_NAV_EDGES) {
      if (!isPassable(edge.doorId)) continue;
      const next = edge.from === current ? edge.to : edge.to === current ? edge.from : null;
      if (next && !visited.has(next)) {
        visited.add(next);
        queue.push([...path, next]);
      }
    }
  }
  return null;
}

function nearestNavNodeId(zoneId: ZoneId, position: LastBellVec2): string | null {
  let closest: { id: string; distance: number } | null = null;
  for (const node of LAST_BELL_NAV_NODES) {
    if (node.zoneId !== zoneId) continue;
    const nodeDistance = distance(position, node.position);
    if (!closest || nodeDistance < closest.distance) closest = { id: node.id, distance: nodeDistance };
  }
  return closest?.id ?? null;
}

function loudestAudibleNoise(position: LastBellVec2, noises: readonly NoiseSource[], doors: readonly DoorSnapshot[]): NoiseSource | null {
  let strongest: NoiseSource | null = null;
  let score = 0;
  for (const noise of noises) {
    if (!hasLineOfSight(position, noise.position, doors)) continue;
    const nextScore = noise.intensity / Math.max(1, distance(position, noise.position) / 8);
    if (nextScore > score && nextScore >= .22) { strongest = noise; score = nextScore; }
  }
  return strongest;
}

function distance(a: LastBellVec2, b: LastBellVec2): number {
  return Math.hypot(a.x - b.x, a.z - b.z);
}

function angleDegrees(facingRadians: number, from: LastBellVec2, to: LastBellVec2): number {
  const target = Math.atan2(to.x - from.x, to.z - from.z);
  const delta = Math.atan2(Math.sin(target - facingRadians), Math.cos(target - facingRadians));
  return Math.abs(delta) * 180 / Math.PI;
}

function round(value: number): number {
  return Number(value.toFixed(4));
}
