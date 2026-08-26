import { describe, expect, it } from 'vitest';
import {
  canOccupyLastBellPosition,
  isLastBellNavSegmentWalkable,
  LAST_BELL_AUTHORED_COLLIDERS,
  LAST_BELL_INTERACTIONS,
  zoneForLastBellPosition,
} from './world';
import { LAST_BELL_PRODUCT_BY_KEY } from '@/lib/campaigns/aouad/last-bell-products';
import { movementBasisFromFacing } from '../engine/movement-basis';
import {
  LastBellSimulation,
  LAST_BELL_PACING_SECONDS,
  LAST_BELL_SIMULATION_STEP_SECONDS,
} from './simulation';

function advance(simulation: LastBellSimulation, seconds: number, input = {}) {
  return simulation.advance(seconds, input);
}

const RUN_FORWARD = { movement: { x: 0, y: 1 }, facingRadians: 0, flashlightOn: false, running: true, hiding: false };
const WALK_FORWARD = { movement: { x: 0, y: 1 }, facingRadians: 0, flashlightOn: false, running: false, hiding: false };
const IDLE = { flashlightOn: false, hiding: false };
const INSPECT_FORWARD = { movement: { x: 0, y: 1 }, facingRadians: 0, flashlightOn: true, running: true, hiding: false };
const LISTEN_FORWARD = { movement: { x: 0, y: 1 }, facingRadians: 0, flashlightOn: false, running: true, hiding: false, listening: true };
const LISTEN_WORLD_RIGHT = { ...LISTEN_FORWARD, movement: { x: -1, y: 0 } };
const LISTEN_WORLD_LEFT = { ...LISTEN_FORWARD, movement: { x: 1, y: 0 } };
const LISTEN_BACKWARD = { ...LISTEN_FORWARD, facingRadians: Math.PI };
const RUN_WORLD_RIGHT = { ...RUN_FORWARD, movement: { x: -1, y: 0 } };
const RUN_WORLD_LEFT = { ...RUN_FORWARD, movement: { x: 1, y: 0 } };

function interact(simulation: LastBellSimulation, interactionId: string) {
  simulation.queueInteraction(interactionId);
  return advance(simulation, LAST_BELL_SIMULATION_STEP_SECONDS, IDLE);
}

function advanceWithVerifiedSweep(simulation: LastBellSimulation, seconds: number, input: Omit<typeof RUN_FORWARD, 'movement'>) {
  let elapsed = 0;
  while (elapsed < seconds - 1e-9) {
    const direction = Math.floor(elapsed / .5) % 2 === 0 ? 1 : -1;
    const segmentSeconds = Math.min(.5, seconds - elapsed);
    let segmentElapsed = 0;
    while (segmentElapsed < segmentSeconds - 1e-9) {
      const stepSeconds = Math.min(LAST_BELL_SIMULATION_STEP_SECONDS, segmentSeconds - segmentElapsed);
      simulation.advance(stepSeconds, {
        ...input,
        movement: { x: direction, y: 0 },
        facingRadians: 0,
      });
      segmentElapsed += stepSeconds;
    }
    elapsed += segmentSeconds;
  }
}

/** Every transition is reached by actual spatial movement and a completed verb. */
function unlockFirstBay(simulation: LastBellSimulation) {
  advance(simulation, 2, INSPECT_FORWARD);
  interact(simulation, 'ch1.classroom-door.open');
  advance(simulation, 1.2, LISTEN_FORWARD);
  interact(simulation, 'ch1.classroom-door.lock');
  // The checkpoint is not a UI-side action result: it is emitted only after
  // the occupied physical slider has reached its locked DoorSystem state.
  return advance(simulation, 1, LISTEN_FORWARD);
}

/** Real first-bay cover: wait for the investigating actor to leave the locker. */
function resolveFirstBayWithLocker(simulation: LastBellSimulation) {
  // The interaction target is the locker that is actually visible in the
  // approved first-bay GLB (x=2.25, z=15.1), not the old invisible proxy at
  // the far end of the encounter.  Reach it from the sealed classroom door.
  advance(simulation, .6, LISTEN_WORLD_RIGHT);
  interact(simulation, 'ch1.hide.locker');
  // This time belongs to the actor's investigate → search → patrol state
  // transition. It does not unlock an E prompt by elapsed time.
  advance(simulation, 10, IDLE);
  interact(simulation, 'ch1.hide.locker');
  advance(simulation, .35, IDLE);
  return advance(simulation, 3.2, LISTEN_FORWARD);
}

function traverseMandatoryChapterOneSearches(simulation: LastBellSimulation) {
  advance(simulation, 4.24, LISTEN_FORWARD);
  advance(simulation, .8, LISTEN_WORLD_RIGHT);
  advance(simulation, .8, LISTEN_FORWARD);
  advance(simulation, .72, LISTEN_WORLD_RIGHT);
  advance(simulation, .95, LISTEN_WORLD_RIGHT);
  advance(simulation, 1.4, LISTEN_FORWARD);
  advance(simulation, 1.4, LISTEN_BACKWARD);
  advance(simulation, 1.7, LISTEN_WORLD_LEFT);
  advance(simulation, 2.45, LISTEN_FORWARD);
  advance(simulation, 2.35, LISTEN_WORLD_LEFT);
  advance(simulation, .95, LISTEN_WORLD_LEFT);
  advance(simulation, 1.9, LISTEN_FORWARD);
  advance(simulation, 1.65, LISTEN_WORLD_RIGHT);
  advance(simulation, .9, LISTEN_WORLD_RIGHT);
  advance(simulation, 5.65, LISTEN_FORWARD);
}

function inspectStairwellBeforeRoof(simulation: LastBellSimulation) {
  advance(simulation, 2.1, RUN_FORWARD);
  advance(simulation, .55, RUN_WORLD_LEFT);
  advance(simulation, 1.2, RUN_WORLD_RIGHT);
  advance(simulation, .65, RUN_FORWARD);
  advance(simulation, .65, RUN_WORLD_LEFT);
  return advance(simulation, .65, RUN_FORWARD);
}

function openRooftopDoor(simulation: LastBellSimulation) {
  inspectStairwellBeforeRoof(simulation);
  const openFrame = interact(simulation, 'ch2.rooftop-door.open');
  advance(simulation, 1.1, RUN_FORWARD);
  return openFrame;
}

describe('LastBellSimulation', () => {
  it('owns the approved two-chapter semantic route, all ten stable pickup keys, and exactly three short detours', () => {
    const keys = LAST_BELL_INTERACTIONS.flatMap((interaction) => interaction.collectibleKey ? [interaction.collectibleKey] : []);
    expect(keys).toHaveLength(10);
    expect(new Set(keys).size).toBe(10);
    expect(LAST_BELL_INTERACTIONS.filter((interaction) => interaction.collectibleKey && interaction.chapterId === 'chapter-01')).toHaveLength(8);
    expect(LAST_BELL_INTERACTIONS.filter((interaction) => interaction.collectibleKey && interaction.chapterId === 'chapter-02')).toHaveLength(2);
    const detours = LAST_BELL_INTERACTIONS.filter((interaction) => interaction.collectibleKey && interaction.route === 'detour');
    expect(detours).toHaveLength(3);
    expect(detours.map((interaction) => interaction.collectibleKey)).toEqual(['kit', 'zipup', 'archery']);
    expect(detours.every((interaction) => interaction.detourSeconds !== undefined && interaction.detourSeconds >= 5 && interaction.detourSeconds <= 10)).toBe(true);
    expect(new LastBellSimulation().targetDurationSeconds()).toBe(425);
    expect(new LastBellSimulation({ chapterId: 'chapter-02' }).targetDurationSeconds()).toBe(175);
  });

  it('opens the classroom door immediately after the externally timed cold-open and checkpoints the physical close/lock', () => {
    const simulation = new LastBellSimulation();
    advance(simulation, 2.1, INSPECT_FORWARD);
    expect(simulation.snapshot().availableInteractions.find((interaction) => interaction.id === 'ch1.classroom-door.open')).toMatchObject({ enabled: true });
    simulation.queueInteraction('ch1.classroom-door.open');
    expect(advance(simulation, LAST_BELL_SIMULATION_STEP_SECONDS, IDLE).events).toContainEqual(
      expect.objectContaining({ type: 'objective', objectiveId: 'ch1.cross-and-lock-classroom-door' }),
    );

    const paced = new LastBellSimulation();
    const frame = unlockFirstBay(paced);
    expect(frame.events).toContainEqual(expect.objectContaining({ type: 'checkpoint', checkpointId: 'ch1_first_bay' }));
    expect(paced.snapshot()).toMatchObject({ checkpointId: 'ch1_first_bay', objectiveId: 'ch1.restore-emergency-power' });

    const retry = paced.retryFromCheckpoint();
    expect(retry).toMatchObject({ checkpointId: 'ch1_first_bay', captured: false, objectiveId: 'ch1.restore-emergency-power' });
    expect(retry.doors.passability.colliderBlockerDoorIds).toContain('door.classroom.slide');
  });

  it('hands a ready-gated opening skip to the real classroom-door interaction without opening it for the player', () => {
    const simulation = new LastBellSimulation();
    const ready = simulation.prepareOpeningDoorInteraction();

    expect(ready.player.position).toEqual({ x: 0, z: 10.8 });
    expect(ready.availableInteractions).toContainEqual(expect.objectContaining({
      id: 'ch1.classroom-door.open',
      enabled: true,
    }));
    expect(ready.doors.doors.find((door) => door.id === 'door.classroom.slide')).toMatchObject({
      state: 'closed',
      passable: false,
    });

    simulation.queueInteraction('ch1.classroom-door.open');
    const opened = advance(simulation, LAST_BELL_SIMULATION_STEP_SECONDS, IDLE);
    expect(opened.events).toContainEqual(expect.objectContaining({
      type: 'objective',
      objectiveId: 'ch1.cross-and-lock-classroom-door',
    }));
    // E is accepted on the very next fixed step, but it must not teleport the
    // authored sliding door to its final transform.  The player sees the
    // opening motion before the shared collision/LOS snapshot becomes passable.
    expect(opened.snapshot.doors.doors.find((door) => door.id === 'door.classroom.slide')).toMatchObject({
      state: 'opening',
      passable: false,
      openProgress: expect.any(Number),
    });
    expect(opened.snapshot.doors.doors.find((door) => door.id === 'door.classroom.slide')!.openProgress).toBeGreaterThan(0);
    expect(opened.snapshot.doors.doors.find((door) => door.id === 'door.classroom.slide')!.openProgress).toBeLessThan(1);

    const passable = advance(simulation, .32, IDLE).snapshot.doors.doors.find(
      (door) => door.id === 'door.classroom.slide',
    );
    expect(passable).toMatchObject({ state: 'open', passable: true, openProgress: 1 });
  });

  it('stages the first infected inside the lit first bay without an immediate doorway capture', () => {
    const simulation = new LastBellSimulation();
    const spawned = simulation.snapshot().zombies.find((zombie) => zombie.id === 'zombie-01');
    expect(spawned).toBeDefined();
    // The authored first-bay collider is z=13.2..25. A z=22..27 silhouette
    // is readable from the opened classroom portal; z=43 was not.
    expect(spawned!.position.z).toBeGreaterThanOrEqual(22);
    expect(spawned!.position.z).toBeLessThanOrEqual(27);
    expect(Math.hypot(spawned!.position.x, spawned!.position.z - 13)).toBeLessThan(12);

    // The patrol must be a living screen-space beat, but it cannot capture
    // before the player has crossed into the first encounter on their terms.
    advance(simulation, .6, IDLE);
    const patrolling = simulation.snapshot().zombies.find((zombie) => zombie.id === 'zombie-01')!;
    expect(patrolling.position).not.toEqual(spawned!.position);

    advance(simulation, 2.1, INSPECT_FORWARD);
    interact(simulation, 'ch1.classroom-door.open');
    const afterOpen = advance(simulation, 1.2, LISTEN_FORWARD).snapshot;
    expect(afterOpen).toMatchObject({ captured: false, pacing: { beatId: 'first-encounter' } });
    expect(afterOpen.zombies.find((zombie) => zombie.id === 'zombie-01')).toMatchObject({
      state: expect.stringMatching(/patrol|investigate|search/),
    });
  });

  it('lets an immediate crossing player close and lock during the authored scent hesitation', () => {
    const simulation = new LastBellSimulation();
    simulation.prepareOpeningDoorInteraction();
    interact(simulation, 'ch1.classroom-door.open');
    advance(simulation, .4, IDLE);

    advance(simulation, 2.1, {
      movement: { x: 0, y: 1 }, facingRadians: 0, flashlightOn: true,
      crouching: false, listening: false, running: false,
    });
    expect(simulation.snapshot()).toMatchObject({
      captured: false,
      player: { position: { z: expect.any(Number) } },
    });
    expect(simulation.snapshot().player.position.z).toBeGreaterThan(13.55);
    expect(simulation.snapshot().availableInteractions).toContainEqual(expect.objectContaining({
      id: 'ch1.classroom-door.lock',
      enabled: true,
    }));
    expect(simulation.snapshot().zombies.find((zombie) => zombie.id === 'zombie-01')).toMatchObject({ state: 'investigate' });

    interact(simulation, 'ch1.classroom-door.lock');
    const locked = advance(simulation, 1, IDLE);
    expect(locked.snapshot).toMatchObject({ captured: false, checkpointId: 'ch1_first_bay' });
    expect(locked.snapshot.doors.doors.find((door) => door.id === 'door.classroom.slide')).toMatchObject({
      state: 'locked',
      passable: false,
    });
  });

  it('lets an off-centre player traverse the full authored classroom doorway and seal it', () => {
    const simulation = new LastBellSimulation();
    simulation.prepareOpeningDoorInteraction();
    interact(simulation, 'ch1.classroom-door.open');
    advance(simulation, .4, IDLE);

    // Browser reproduction: room inspection left the player around x=+1.3.
    // The former narrow semantic portal stopped at z=12.71 despite the door
    // snapshot being open/passable.
    advance(simulation, .39, LISTEN_WORLD_RIGHT);
    expect(simulation.snapshot().player.position.x).toBeGreaterThan(1.2);
    advance(simulation, 1.1, LISTEN_FORWARD);

    expect(simulation.snapshot().player.position.z).toBeGreaterThan(13.55);
    expect(simulation.snapshot().availableInteractions).toContainEqual(expect.objectContaining({
      id: 'ch1.classroom-door.lock',
      enabled: true,
    }));

    interact(simulation, 'ch1.classroom-door.lock');
    const sealed = advance(simulation, .6, IDLE).snapshot;
    expect(sealed).toMatchObject({ checkpointId: 'ch1_first_bay', captured: false });
    expect(sealed.doors.doors.find((door) => door.id === 'door.classroom.slide')).toMatchObject({
      state: 'locked', passable: false,
    });
  });

  it('requires an authored desk/locker hide while the first actor searches, never a stationary or crouched C/Q hold', () => {
    const idle = new LastBellSimulation();
    advance(idle, 2.1, INSPECT_FORWARD);
    interact(idle, 'ch1.classroom-door.open');
    advance(idle, 8, { flashlightOn: false, crouching: true, listening: false, running: false });
    expect(idle.snapshot().pacing).toMatchObject({ beatId: 'first-encounter', activeSeconds: 0, movementMeters: 0 });
    advance(idle, 8, { flashlightOn: false, crouching: false, listening: true, running: false });
    expect(idle.snapshot().pacing.activeSeconds).toBe(0);

    const covered = new LastBellSimulation();
    covered.prepareOpeningDoorInteraction();
    interact(covered, 'ch1.classroom-door.open');
    advance(covered, 1.15, LISTEN_FORWARD);
    interact(covered, 'ch1.classroom-door.lock');
    advance(covered, .5, LISTEN_FORWARD);
    const cleared = resolveFirstBayWithLocker(covered);
    expect(cleared.snapshot).toMatchObject({
      captured: false,
      pacing: { beatId: 'corridor-exploration', activeSeconds: expect.any(Number) },
      player: { stealthState: 'standing' },
    });
    expect(cleared.snapshot.pacing.routeEvidence).toContain('first-bay-cover');
    expect(cleared.snapshot.pacing.activeSeconds).toBeGreaterThan(0);
    expect(cleared.snapshot.player.position.z).toBeGreaterThan(26.5);
  });

  it('captures a crouched player who exposes themself with the flashlight before the chasing actor overlaps the camera', () => {
    const simulation = new LastBellSimulation();
    advance(simulation, 2.1, INSPECT_FORWARD);
    interact(simulation, 'ch1.classroom-door.open');
    const frame = advance(simulation, 8, {
      movement: { x: 0, y: 1 }, facingRadians: 0, flashlightOn: true,
      crouching: true, listening: false, running: false,
    });
    expect(frame.snapshot.captured).toBe(true);
    expect(frame.snapshot.zombies.find((zombie) => zombie.id === 'zombie-01')).toMatchObject({ state: 'capture' });
  });

  it('rehydrates the first-bay safe anchor when the React retry nonce follows a pre-lock first-zombie capture', () => {
    // This is the same browser sequence as the "다시 일어나기" overlay:
    // cold-open handoff → E open → cross the live doorway → capture before
    // the player has had time to close/lock it. The campaign runtime invokes
    // retryFromCheckpoint() directly when its retry nonce changes.
    const simulation = new LastBellSimulation();
    simulation.prepareOpeningDoorInteraction();
    interact(simulation, 'ch1.classroom-door.open');
    const captured = advance(simulation, 8, {
      movement: { x: 0, y: 1 }, facingRadians: 0, flashlightOn: true,
      crouching: true, listening: false, running: false,
    }).snapshot;

    expect(captured).toMatchObject({
      checkpointId: null,
      captured: true,
      zombies: [expect.objectContaining({ id: 'zombie-01', state: 'capture' })],
    });
    expect(captured.player.position.z).toBeGreaterThan(13.5);

    const retryFrame = simulation.retryFrameFromCheckpoint();
    const retried = retryFrame.snapshot;

    expect(retried).toMatchObject({
      checkpointId: 'ch1_first_bay',
      captured: false,
      objectiveId: 'ch1.restore-emergency-power',
      player: { position: { x: 0, z: 15.2 } },
      zombies: [expect.objectContaining({ id: 'zombie-01', state: 'patrol' })],
    });
    expect(retried.zombies.find((zombie) => zombie.id === 'zombie-01')?.position.z).toBeCloseTo(23.35, 1);
    expect(retryFrame.events).toContainEqual(expect.objectContaining({
      type: 'checkpoint', checkpointId: 'ch1_first_bay', chapterId: 'chapter-01',
    }));
    expect(retried.doors.doors.find((door) => door.id === 'door.classroom.slide')).toMatchObject({
      state: 'locked', passable: false,
    });
    // The real UI clears held keys before applying the retry nonce. An
    // otherwise enabled flashlight must not turn the reset patrol back into
    // a chase while the capture overlay is disappearing.
    const settled = advance(simulation, .5, { flashlightOn: true }).snapshot;
    expect(settled.zombies.find((zombie) => zombie.id === 'zombie-01')).toMatchObject({
      state: 'patrol', position: { x: .72, z: 23.35 },
    });
  });

  it('restarts before the classroom door when capture happens inside the passage sensor', () => {
    const simulation = new LastBellSimulation();
    simulation.prepareOpeningDoorInteraction();
    interact(simulation, 'ch1.classroom-door.open');
    advance(simulation, .4, IDLE);

    // Stop inside the authored portal instead of crossing the 13.55m passage
    // sensor. A chasing actor can still reach this threshold if the player
    // freezes with the flashlight on.
    advance(simulation, 1.3, {
      movement: { x: 0, y: 1 }, facingRadians: 0, flashlightOn: true,
      crouching: false, listening: false, running: false,
    });
    const captured = advance(simulation, 9, {
      movement: { x: 0, y: 0 }, facingRadians: 0, flashlightOn: true,
      crouching: false, listening: false, running: false,
    }).snapshot;

    expect(captured).toMatchObject({
      checkpointId: null,
      captured: true,
      objectiveId: 'ch1.cross-and-lock-classroom-door',
    });
    expect(captured.player.position.z).toBeLessThanOrEqual(13.55);

    const retry = simulation.retryFrameFromCheckpoint().snapshot;
    expect(retry).toMatchObject({
      checkpointId: null,
      captured: false,
      objectiveId: 'ch1.cross-and-lock-classroom-door',
      player: { position: { x: 0, z: 10.8 } },
      zombies: [expect.objectContaining({ id: 'zombie-01', state: 'patrol' })],
    });
    expect(retry.doors.doors.find((door) => door.id === 'door.classroom.slide')).toMatchObject({
      state: 'open', passable: true, occupants: [],
    });
  });

  it('uses a timed E-only hiding-spot state machine rather than a C camera offset', () => {
    const simulation = new LastBellSimulation();
    // Walk to the authored desk cover at (-3.35, 2.85) using the same
    // camera-relative basis as the browser. Keeping this spatial prevents a
    // semantic E action from succeeding at an invisible legacy proxy.
    advance(simulation, 1.1, { movement: { x: 1, y: 0 }, facingRadians: 0, flashlightOn: false });
    advance(simulation, .4, { movement: { x: 0, y: -1 }, facingRadians: 0, flashlightOn: false });
    simulation.queueInteraction('ch1.hide.desk');
    const entering = advance(simulation, LAST_BELL_SIMULATION_STEP_SECONDS, IDLE).snapshot.player;
    expect(entering).toMatchObject({ stealthState: 'entering-hide', hidingSpotId: 'ch1.hide.desk', hiding: false });

    const hidden = advance(simulation, .4, IDLE).snapshot.player;
    expect(hidden).toMatchObject({ stealthState: 'hidden', hidingSpotId: 'ch1.hide.desk', hiding: true });

    simulation.queueInteraction('ch1.hide.desk');
    const exiting = advance(simulation, LAST_BELL_SIMULATION_STEP_SECONDS, IDLE).snapshot.player;
    expect(exiting).toMatchObject({ stealthState: 'exiting-hide', hiding: false });
    expect(advance(simulation, .3, IDLE).snapshot.player).toMatchObject({ stealthState: 'standing', hidingSpotId: null, hiding: false });
  });

  it('uses the rendered camera basis for A/D instead of the opposite world strafe', () => {
    const right = new LastBellSimulation();
    const left = new LastBellSimulation();
    // Runtime renders `facingRadians + PI`, so screen-right at facing 0 is
    // negative world X and screen-left is positive world X.
    advance(right, LAST_BELL_SIMULATION_STEP_SECONDS, { movement: { x: 1, y: 0 }, facingRadians: 0, flashlightOn: true });
    advance(left, LAST_BELL_SIMULATION_STEP_SECONDS, { movement: { x: -1, y: 0 }, facingRadians: 0, flashlightOn: true });
    expect(right.snapshot().player.position.x).toBeLessThan(0);
    expect(left.snapshot().player.position.x).toBeGreaterThan(0);
  });

  it.each([0, Math.PI / 2, Math.PI, -Math.PI / 2])(
    'moves the shared positive-X input along rendered screen-right at facing %s',
    (facingRadians) => {
      const simulation = new LastBellSimulation();
      const before = simulation.snapshot().player.position;
      advance(simulation, LAST_BELL_SIMULATION_STEP_SECONDS, {
        movement: { x: 1, y: 0 }, facingRadians, flashlightOn: false,
      });
      const after = simulation.snapshot().player.position;
      const displacement = { x: after.x - before.x, z: after.z - before.z };
      const expectedRight = movementBasisFromFacing(facingRadians).right;
      const rightDot = displacement.x * expectedRight.x + displacement.z * expectedRight.z;

      expect(rightDot).toBeGreaterThan(0);
    },
  );

  it('does not checkpoint a passage until the physical door has closed and locked behind every occupant', () => {
    const simulation = new LastBellSimulation();
    advanceWithVerifiedSweep(simulation, 18, INSPECT_FORWARD);
    advance(simulation, 2, INSPECT_FORWARD);
    interact(simulation, 'ch1.classroom-door.open');
    advance(simulation, 1.2, LISTEN_FORWARD);
    const requested = interact(simulation, 'ch1.classroom-door.lock');
    expect(requested.snapshot).toMatchObject({ objectiveId: 'ch1.cross-and-lock-classroom-door', checkpointId: null });
    expect(requested.snapshot.doors.doors.find((door) => door.id === 'door.classroom.slide')).not.toMatchObject({ state: 'locked' });
    const locked = advance(simulation, 1, LISTEN_FORWARD);
    expect(locked.events).toContainEqual(expect.objectContaining({ type: 'checkpoint', checkpointId: 'ch1_first_bay' }));
    expect(locked.snapshot.doors.doors.find((door) => door.id === 'door.classroom.slide')).toMatchObject({ state: 'locked', passable: false });
    expect(locked.snapshot.availableInteractions.some((interaction) => interaction.id === 'ch1.classroom-door.lock')).toBe(false);
  });

  it('keeps the shared-rig zombie cap when the verified power beat enables the next physical verb', () => {
    const simulation = new LastBellSimulation({ progressStage: 4 });
    expect(simulation.snapshot()).toMatchObject({ checkpointId: 'ch1_power', objectiveId: 'ch1.deploy-noise-device' });
    expect(simulation.snapshot().zombies).toHaveLength(1);

    interact(simulation, 'ch1.noise.device');
    expect(simulation.snapshot().zombies.length).toBeLessThanOrEqual(2);
    expect(simulation.retryFromCheckpoint()).toMatchObject({ checkpointId: 'ch1_power', objectiveId: 'ch1.deploy-noise-device' });
  });

  it('emits the strength cue only after both searches reach the authored heavy obstacle', () => {
    const simulation = new LastBellSimulation({ progressStage: 3 });
    traverseMandatoryChapterOneSearches(simulation);
    expect(simulation.snapshot().pacing).toMatchObject({ ready: false, targetActiveSeconds: 185 });
    expect(simulation.snapshot().pacing.activeSeconds).toBeLessThan(185);
    expect(simulation.snapshot().pacing.routeEvidence).toEqual(expect.arrayContaining([
      'infirmary-search', 'broadcast-search',
    ]));
    const heavyFrame = interact(simulation, 'ch1.heavy-obstacle.move');
    expect(heavyFrame.events).toContainEqual(expect.objectContaining({
      type: 'foreshadowing', cue: 'strength', chapterId: 'chapter-01',
    }));
    expect(simulation.snapshot().pacing).toMatchObject({ ready: true });
    interact(simulation, 'ch1.power.panel');

    // Return to the real noisemaker anchor before opening the fire-door seam;
    // its two active zombies remain capped by the authored route contract.
    advance(simulation, .9, { ...RUN_FORWARD, movement: { x: 1, y: 0 } });
    interact(simulation, 'ch1.noise.device');
    interact(simulation, 'ch1.fire-door.open');
    expect(simulation.snapshot()).toMatchObject({ captured: false });
  });

  it('starts Chapter 2 independently at its checkpoint and removes enemies and pickups after the rooftop-door seam', () => {
    const simulation = new LastBellSimulation({ chapterId: 'chapter-02', runMode: 'chapter-replay' });
    expect(simulation.snapshot()).toMatchObject({ chapterId: 'chapter-02', checkpointId: 'ch2_stairwell', objectiveId: 'ch2.search-stairwell' });

    const openFrame = openRooftopDoor(simulation);
    expect(openFrame.events).toContainEqual(expect.objectContaining({
      type: 'objective', objectiveId: 'ch2.approach-namra', zoneId: 'rooftop',
    }));
    const rooftop = simulation.snapshot();
    expect(rooftop.doors.passability.passableDoorIds).toContain('door.rooftop');
    expect(rooftop.zombies).toEqual([]);
    expect(rooftop.availableInteractions.some((interaction) => interaction.kind === 'item')).toBe(false);
  });

  it('clears hidden stealth input at the rooftop seam so cinematic forward movement can earn pacing', () => {
    const simulation = new LastBellSimulation({ chapterId: 'chapter-02', runMode: 'chapter-replay' });
    inspectStairwellBeforeRoof(simulation);
    const beforeOpen = simulation.snapshot().player.position;
    simulation.queueInteraction('ch2.rooftop-door.open');
    const opened = advance(simulation, LAST_BELL_SIMULATION_STEP_SECONDS, {
      movement: { x: 0, y: 1 }, facingRadians: 0, flashlightOn: false,
      hiding: true, listening: true, running: true,
    });
    expect(opened.events).toContainEqual(expect.objectContaining({
      type: 'objective', objectiveId: 'ch2.approach-namra', zoneId: 'rooftop',
    }));
    expect(opened.snapshot).toMatchObject({
      rooftopPhase: 'approach',
      player: { hiding: false, listening: false, running: false },
      zombies: [],
    });

    advance(simulation, .8, { movement: { x: 0, y: 1 }, facingRadians: 0, flashlightOn: false, hiding: false, listening: false, running: false });
    const approached = simulation.snapshot();
    expect(approached.player.position.z).toBeGreaterThan(beforeOpen.z);
    expect(approached.pacing).toMatchObject({ beatId: 'rooftop-approach', activeSeconds: expect.any(Number) });
    expect(approached.pacing.activeSeconds).toBeGreaterThan(0);
  });

  it('commits new replay pickups only after the verified Chapter 2 exit', () => {
    const simulation = new LastBellSimulation({ chapterId: 'chapter-02', runMode: 'chapter-replay' });
    advance(simulation, 2.1, RUN_FORWARD);
    advance(simulation, .55, RUN_WORLD_LEFT);
    interact(simulation, 'ch2.candle');
    expect(simulation.snapshot()).toMatchObject({ pendingCollectibles: ['candle'], committedCollectibles: [] });

    advance(simulation, 1.2, RUN_WORLD_RIGHT);
    advance(simulation, .65, RUN_FORWARD);
    interact(simulation, 'ch2.blanket');
    // The rooftop door is a central authored portal: return from the blanket
    // shelf to that portal instead of cutting through the stairwell wall.
    advance(simulation, .65, RUN_WORLD_LEFT);
    advance(simulation, .65, RUN_FORWARD);
    const opened = interact(simulation, 'ch2.rooftop-door.open');
    expect(opened.events).toContainEqual(expect.objectContaining({ type: 'objective', objectiveId: 'ch2.approach-namra' }));
    advance(simulation, 92, WALK_FORWARD);
    interact(simulation, 'ch2.namra');
    expect(simulation.snapshot()).toMatchObject({ rooftopPhase: 'recognition' });
    const finalFrame = advance(
      simulation,
      LAST_BELL_PACING_SECONDS.chapter02.recognitionDuration
        + LAST_BELL_PACING_SECONDS.chapter02.subdueDuration
        + LAST_BELL_PACING_SECONDS.chapter02.blackDuration
        + .2,
      { flashlightOn: false, hiding: false },
    );
    expect(finalFrame.events).toContainEqual(expect.objectContaining({ type: 'game_complete' }));
    expect(simulation.snapshot()).toMatchObject({ gameComplete: true, pendingCollectibles: [], committedCollectibles: ['blanket', 'candle'] });
  });

  it('uses the authored COL floor and portal contract for both actor movement and nav sight lines', () => {
    expect(LAST_BELL_AUTHORED_COLLIDERS.map((collider) => collider.sourceNode)).toEqual(expect.arrayContaining([
      'COL_Corridor_Lane', 'COL_Infirmary', 'COL_Broadcast', 'COL_Utility', 'COL_Stairwell', 'COL_Rooftop',
    ]));
    // A corridor wall blocks a normal actor footprint; its authored breach is
    // the only route into the infirmary room.
    expect(canOccupyLastBellPosition({ x: 3.22, z: 25 }, .26)).toBe(false);
    expect(canOccupyLastBellPosition({ x: 3.22, z: 32 }, .26)).toBe(true);
    expect(isLastBellNavSegmentWalkable({ x: 0, z: 25 }, { x: 4.7, z: 25 }, .1)).toBe(false);
    expect(isLastBellNavSegmentWalkable({ x: 2.5, z: 32 }, { x: 4.7, z: 32 }, .1)).toBe(true);
  });

  it('resolves overlap zones by the most-specific authored collider without changing occupancy or nav', () => {
    // `floor.utility` is contained by the long corridor lane. Zone selection
    // must not let collider declaration order make the power panel corridor.
    expect(zoneForLastBellPosition({ x: 0, z: 64 })).toBe('utility');
    expect(canOccupyLastBellPosition({ x: 0, z: 64 }, .26)).toBe(true);
    expect(isLastBellNavSegmentWalkable({ x: 0, z: 63 }, { x: 0, z: 64 }, .26)).toBe(true);
  });

  it('keeps the runtime collectible placement aligned with the stable catalog, including the archery broadcast detour', () => {
    const runtimeCollectibles = LAST_BELL_INTERACTIONS.filter((interaction) => interaction.collectibleKey);
    expect(runtimeCollectibles).toHaveLength(10);
    for (const interaction of runtimeCollectibles) {
      const product = LAST_BELL_PRODUCT_BY_KEY[interaction.collectibleKey!];
      expect(interaction).toMatchObject({
        chapterId: product.chapterId,
        zoneId: product.zoneId,
        route: product.discovery,
      });
    }
    expect(LAST_BELL_INTERACTIONS.find((interaction) => interaction.collectibleKey === 'archery')).toMatchObject({
      chapterId: 'chapter-01', zoneId: 'broadcast', route: 'detour', detourSeconds: 7,
    });
  });

  it('restores verified stages without replaying milestones the server already accepted', () => {
    const afterFirstBayCheckpoint = new LastBellSimulation({ progressStage: 2 });
    const firstBayFrame = advance(afterFirstBayCheckpoint, LAST_BELL_SIMULATION_STEP_SECONDS, { flashlightOn: false });
    expect(firstBayFrame.events).toEqual([]);
    expect(firstBayFrame.snapshot).toMatchObject({
      chapterId: 'chapter-01',
      checkpointId: 'ch1_first_bay',
      objectiveId: 'ch1.restore-emergency-power',
      pacing: { beatId: 'first-encounter', activeSeconds: 0 },
    });
    expect(firstBayFrame.snapshot.elapsedSeconds).toBeCloseTo(1 + LAST_BELL_SIMULATION_STEP_SECONDS, 3);
    expect(firstBayFrame.snapshot.doors.passability.colliderBlockerDoorIds).toContain('door.classroom.slide');

    const afterPower = new LastBellSimulation({ progressStage: 4, pendingCollectibles: ['idcard'] });
    const powerFrame = advance(afterPower, LAST_BELL_SIMULATION_STEP_SECONDS, { flashlightOn: false });
    expect(powerFrame.events).toEqual([]);
    expect(powerFrame.snapshot).toMatchObject({
      checkpointId: 'ch1_power',
      objectiveId: 'ch1.deploy-noise-device',
      pendingCollectibles: ['idcard'],
    });

    const chapterTwoObjectiveAccepted = new LastBellSimulation({
      chapterId: 'chapter-02',
      runMode: 'chapter-replay',
      progressStage: 7,
    });
    const chapterTwoFrame = advance(chapterTwoObjectiveAccepted, LAST_BELL_SIMULATION_STEP_SECONDS, { flashlightOn: false });
    expect(chapterTwoFrame.events).toEqual([
      expect.objectContaining({ type: 'checkpoint', checkpointId: 'ch2_stairwell' }),
    ]);
    expect(chapterTwoFrame.snapshot).toMatchObject({ checkpointId: 'ch2_stairwell', pacing: { beatId: 'stairwell-search' } });
  });

  it('restores the post-rooftop seam and the final black interval from verified stages', () => {
    const rooftop = new LastBellSimulation({ progressStage: 9, pendingCollectibles: ['candle'] }).snapshot();
    expect(rooftop).toMatchObject({
      chapterId: 'chapter-02',
      objectiveId: 'ch2.approach-namra',
      rooftopPhase: 'approach',
      elapsedSeconds: expect.closeTo(3, 2),
    });
    expect(rooftop.doors.passability.passableDoorIds).toContain('door.rooftop');
    expect(rooftop.zombies).toEqual([]);
    expect(rooftop.availableInteractions.some((interaction) => interaction.kind === 'item')).toBe(false);

    const black = new LastBellSimulation({ progressStage: 10, pendingCollectibles: ['candle'] });
    const complete = advance(black, LAST_BELL_PACING_SECONDS.chapter02.blackDuration + .1, { flashlightOn: false });
    expect(complete.events).toContainEqual(expect.objectContaining({ type: 'game_complete' }));
    expect(complete.snapshot).toMatchObject({
      chapterId: 'chapter-02',
      gameComplete: true,
      committedCollectibles: ['candle'],
      pendingCollectibles: [],
    });
  });

  it('keeps a verified Chapter 1 replay exit in Chapter 1 while Chapter 2 replay starts at the stairwell', () => {
    const chapterOneExit = new LastBellSimulation({
      chapterId: 'chapter-01',
      runMode: 'chapter-replay',
      progressStage: 6,
      pendingCollectibles: ['idcard'],
    }).snapshot();
    expect(chapterOneExit).toMatchObject({
      chapterId: 'chapter-01',
      chapterComplete: true,
      objectiveId: 'ch1.reach-rooftop-stairwell',
      pendingCollectibles: ['idcard'],
      elapsedSeconds: 20,
    });

    const chapterTwoReplay = new LastBellSimulation({
      chapterId: 'chapter-02',
      runMode: 'chapter-replay',
      progressStage: 6,
    }).snapshot();
    expect(chapterTwoReplay).toMatchObject({
      chapterId: 'chapter-02',
      chapterComplete: false,
      checkpointId: 'ch2_stairwell',
    });
  });
});
