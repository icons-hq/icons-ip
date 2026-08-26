import { describe, expect, it } from 'vitest';
import {
  LastBellSimulation,
  LAST_BELL_PACING_SECONDS,
  LAST_BELL_SIMULATION_HZ,
  LAST_BELL_VERIFIED_MILESTONE_SECONDS,
  LAST_BELL_VERIFIED_STAGE_TIMELINE_SECONDS,
} from './simulation';
import type { LastBellRuntimeEvent, LastBellSimulationInput } from './types';

const RUN_FORWARD: LastBellSimulationInput = {
  movement: { x: 0, y: 1 }, facingRadians: 0, flashlightOn: false,
  running: true, crouching: false, listening: false,
};
const LISTEN_FORWARD: LastBellSimulationInput = { ...RUN_FORWARD, listening: true };
const WALK_FORWARD: LastBellSimulationInput = { ...RUN_FORWARD, running: false };
const IDLE: LastBellSimulationInput = { flashlightOn: false, running: false, listening: false };
const LISTEN_WORLD_RIGHT: LastBellSimulationInput = { ...LISTEN_FORWARD, movement: { x: -1, y: 0 } };
const LISTEN_WORLD_LEFT: LastBellSimulationInput = { ...LISTEN_FORWARD, movement: { x: 1, y: 0 } };
const LISTEN_BACKWARD: LastBellSimulationInput = { ...LISTEN_FORWARD, facingRadians: Math.PI };
const RUN_WORLD_RIGHT: LastBellSimulationInput = { ...RUN_FORWARD, movement: { x: -1, y: 0 } };
const RUN_WORLD_LEFT: LastBellSimulationInput = { ...RUN_FORWARD, movement: { x: 1, y: 0 } };

function advanceAtCadence(
  simulation: LastBellSimulation,
  seconds: number,
  renderHz: number,
  input: LastBellSimulationInput,
  events: LastBellRuntimeEvent[],
) {
  const frameSeconds = 1 / renderHz;
  let remaining = seconds;
  while (remaining > 1e-9) {
    const delta = Math.min(frameSeconds, remaining);
    const frame = simulation.advance(delta, input);
    events.push(...frame.events);
    remaining -= delta;
  }
}

function interactAtCadence(
  simulation: LastBellSimulation,
  id: string,
  renderHz: number,
  events: LastBellRuntimeEvent[],
) {
  simulation.queueInteraction(id);
  advanceAtCadence(simulation, 1 / LAST_BELL_SIMULATION_HZ, renderHz, IDLE, events);
}

/** Fastest semantic route used only to prove that no arbitrary timer gates E. */
function semanticRouteAtCadence(renderHz: number) {
  const simulation = new LastBellSimulation();
  const events: LastBellRuntimeEvent[] = [];

  simulation.prepareOpeningDoorInteraction();
  interactAtCadence(simulation, 'ch1.classroom-door.open', renderHz, events);
  advanceAtCadence(simulation, 1.15, renderHz, LISTEN_FORWARD, events);
  interactAtCadence(simulation, 'ch1.classroom-door.lock', renderHz, events);
  advanceAtCadence(simulation, .5, renderHz, LISTEN_FORWARD, events);

  // The first bay has a real cover verb. C/Q alone no longer produces the
  // verified route event: the first actor must investigate while the player
  // occupies the authored locker volume.
  // Enter the locker that is actually visible in the first-bay delivery GLB
  // (x=2.25, z=15.1), rather than the removed far-corridor proxy.
  advanceAtCadence(simulation, .6, renderHz, LISTEN_WORLD_RIGHT, events);
  interactAtCadence(simulation, 'ch1.hide.locker', renderHz, events);
  // This is not an AFK gate: the visible actor must lose sight, arrive at its
  // last-seen position, and enter its authored search state.
  advanceAtCadence(simulation, 10, renderHz, IDLE, events);
  interactAtCadence(simulation, 'ch1.hide.locker', renderHz, events);
  advanceAtCadence(simulation, .35, renderHz, IDLE, events);
  advanceAtCadence(simulation, 3.2, renderHz, LISTEN_FORWARD, events);

  // Both authored side rooms are mandatory survival-route searches. Their
  // product pickups remain optional and are intentionally not collected here.
  // Enter the infirmary through its z=30.1..34 portal, reach the authored
  // back-wall evidence, and return through the same opening.
  advanceAtCadence(simulation, 1.35, renderHz, LISTEN_FORWARD, events);
  advanceAtCadence(simulation, 1.85, renderHz, LISTEN_WORLD_RIGHT, events);
  advanceAtCadence(simulation, 1.15, renderHz, LISTEN_FORWARD, events);
  advanceAtCadence(simulation, 1.15, renderHz, LISTEN_BACKWARD, events);
  advanceAtCadence(simulation, 2.45, renderHz, LISTEN_WORLD_LEFT, events);
  // Continue to the broadcast portal, inspect its desk, then return to the
  // main lane before approaching the utility-room obstacle.
  advanceAtCadence(simulation, 3.45, renderHz, LISTEN_FORWARD, events);
  advanceAtCadence(simulation, 2.35, renderHz, LISTEN_WORLD_LEFT, events);
  advanceAtCadence(simulation, 1, renderHz, LISTEN_FORWARD, events);
  advanceAtCadence(simulation, 1, renderHz, LISTEN_BACKWARD, events);
  advanceAtCadence(simulation, 2.35, renderHz, LISTEN_WORLD_RIGHT, events);
  advanceAtCadence(simulation, 6.6, renderHz, LISTEN_FORWARD, events);
  interactAtCadence(simulation, 'ch1.heavy-obstacle.move', renderHz, events);
  interactAtCadence(simulation, 'ch1.power.panel', renderHz, events);
  interactAtCadence(simulation, 'ch1.noise.device', renderHz, events);
  advanceAtCadence(simulation, .2, renderHz, IDLE, events);
  interactAtCadence(simulation, 'ch1.fire-door.open', renderHz, events);
  advanceAtCadence(simulation, 1.45, renderHz, LISTEN_FORWARD, events);
  interactAtCadence(simulation, 'ch1.fire-door.lock', renderHz, events);
  advanceAtCadence(simulation, .35, renderHz, LISTEN_FORWARD, events);
  advanceAtCadence(simulation, .4, renderHz, LISTEN_FORWARD, events);
  interactAtCadence(simulation, 'ch1.last-bell', renderHz, events);
  advanceAtCadence(simulation, 1.65, renderHz, RUN_FORWARD, events);

  // Chapter 2: reach the physical roof portal, then walk the actual rooftop
  // distance. The final recognition/subdue/black beats remain authored fixed
  // sequences, not interaction unlock timers.
  advanceAtCadence(simulation, 2.1, renderHz, RUN_FORWARD, events);
  advanceAtCadence(simulation, .55, renderHz, RUN_WORLD_LEFT, events);
  advanceAtCadence(simulation, 1.2, renderHz, RUN_WORLD_RIGHT, events);
  advanceAtCadence(simulation, .65, renderHz, RUN_FORWARD, events);
  advanceAtCadence(simulation, .65, renderHz, RUN_WORLD_LEFT, events);
  // Stop at the authored handle marker: close enough to satisfy the route
  // evidence but still outside the blocker/actor-radius threshold.
  advanceAtCadence(simulation, .5, renderHz, RUN_FORWARD, events);
  interactAtCadence(simulation, 'ch2.rooftop-door.open', renderHz, events);
  advanceAtCadence(simulation, 94, renderHz, WALK_FORWARD, events);
  interactAtCadence(simulation, 'ch2.namra', renderHz, events);
  advanceAtCadence(
    simulation,
    LAST_BELL_PACING_SECONDS.chapter02.recognitionDuration
      + LAST_BELL_PACING_SECONDS.chapter02.subdueDuration
      + LAST_BELL_PACING_SECONDS.chapter02.blackDuration
      + .2,
    renderHz,
    IDLE,
    events,
  );

  return { snapshot: simulation.snapshot(), events };
}

function eventTime(
  events: readonly LastBellRuntimeEvent[],
  predicate: (event: LastBellRuntimeEvent) => boolean,
) {
  const event = events.find(predicate);
  if (!event) throw new Error('expected semantic route event');
  return event.atSeconds;
}

describe('Last Bell evidence-driven pacing', () => {
  it('separates verified physical lower bounds from the 425s/175s playtest targets', () => {
    expect(LAST_BELL_VERIFIED_STAGE_TIMELINE_SECONDS).toEqual({
      stage1: 0, stage2: 1, stage3: 4, stage4: 15, stage5: 18,
      stage6: 20, stage7: 20, stage8: 20, stage9: 23,
      stage10: 128, stage11: 138,
    });
    expect(LAST_BELL_VERIFIED_MILESTONE_SECONDS).toMatchObject({
      firstBay: 1,
      restoreObjective: 4,
      power: 15,
      chapter01Complete: 20,
      rooftopDoor: 23,
      gameComplete: 138,
    });
    expect(new LastBellSimulation().targetDurationSeconds()).toBe(425);
    expect(new LastBellSimulation({ chapterId: 'chapter-02' }).targetDurationSeconds()).toBe(175);
  });

  it('never unlocks progress from idle time alone', () => {
    const firstEncounter = new LastBellSimulation({ progressStage: 2 });
    firstEncounter.advance(300, IDLE);
    expect(firstEncounter.snapshot()).toMatchObject({
      objectiveId: 'ch1.restore-emergency-power',
      pacing: { beatId: 'first-encounter', ready: false, movementMeters: 0 },
    });

    const stairwell = new LastBellSimulation({
      chapterId: 'chapter-02', runMode: 'chapter-replay', progressStage: 6,
    });
    stairwell.advance(300, IDLE);
    expect(stairwell.snapshot().availableInteractions.find(
      (interaction) => interaction.id === 'ch2.rooftop-door.open',
    )).toBeUndefined();
  });

  it('requires authored cover, both route searches, and the heavy obstacle instead of timing or a direct utility sprint', () => {
    const simulation = new LastBellSimulation({ progressStage: 3 });
    const events: LastBellRuntimeEvent[] = [];
    advanceAtCadence(simulation, 15, 30, LISTEN_FORWARD, events);

    expect(simulation.snapshot()).toMatchObject({
      zoneId: 'utility',
      pacing: {
        beatId: 'corridor-exploration',
        ready: false,
        targetActiveSeconds: 185,
      },
    });
    expect(simulation.snapshot().pacing.activeSeconds).toBeLessThan(185);
    interactAtCadence(simulation, 'ch1.power.panel', 30, events);
    expect(events).not.toContainEqual(expect.objectContaining({
      type: 'checkpoint', checkpointId: 'ch1_power',
    }));
  });

  it.each([5, 15, 30, 60, 120])(
    'is fixed-step invariant at %sHz through doors, both zombies, rooftop and ending',
    (renderHz) => {
      const result = semanticRouteAtCadence(renderHz);
      const baseline = semanticRouteAtCadence(30);
      expect(result).toEqual(baseline);
      expect(result.snapshot).toMatchObject({ gameComplete: true, rooftopPhase: 'black' });
      expect(result.events).toEqual(expect.arrayContaining([
        expect.objectContaining({ type: 'checkpoint', checkpointId: 'ch1_first_bay' }),
        expect.objectContaining({ type: 'checkpoint', checkpointId: 'ch1_power' }),
        expect.objectContaining({ type: 'chapter_complete', chapterId: 'chapter-01' }),
        expect.objectContaining({ type: 'objective', objectiveId: 'ch2.approach-namra' }),
        expect.objectContaining({ type: 'capture', actor: 'namra' }),
        expect.objectContaining({ type: 'game_complete' }),
      ]));
    },
  );

  it('records a fast semantic route below the design target without treating it as the 10-minute QA pass', () => {
    const result = semanticRouteAtCadence(30);
    const gameCompleteAt = eventTime(result.events, (event) => event.type === 'game_complete');
    expect(gameCompleteAt).toBeLessThan(425 + 175);
    expect(result.snapshot.gameComplete).toBe(true);
    // Completion correctness and duration acceptance are separate gates. The
    // latter still requires five observed human first-success sessions.
    expect(new LastBellSimulation().targetDurationSeconds()).toBe(425);
  });

  it('consumes a 200ms render stall as six deterministic fixed steps', () => {
    const stalled = new LastBellSimulation({ chapterId: 'chapter-02', runMode: 'chapter-replay' });
    const smooth = new LastBellSimulation({ chapterId: 'chapter-02', runMode: 'chapter-replay' });
    stalled.advance(.2, RUN_FORWARD);
    for (let index = 0; index < 6; index += 1) smooth.advance(1 / LAST_BELL_SIMULATION_HZ, RUN_FORWARD);
    expect(stalled.snapshot()).toEqual(smooth.snapshot());
  });
});
