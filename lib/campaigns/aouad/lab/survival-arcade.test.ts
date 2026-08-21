import { describe, expect, it } from 'vitest';
import {
  advanceSurvivalArcadeFrameTiming,
  initialSurvivalArcadeFrameTiming,
  initialSurvivalArcadeState,
  stepSurvivalArcade,
  stepSurvivalArcadeSimulation,
  synchronizeSurvivalArcadeActiveTime,
  SURVIVAL_ARCADE_DURATION_MS,
  SURVIVAL_ARCADE_FIXED_STEP_MS,
  type SurvivalArcadeState,
} from './survival-arcade';

function simulateAtRenderCadence(frameMs: number): SurvivalArcadeState {
  let state: SurvivalArcadeState = { ...initialSurvivalArcadeState, hazards: [] };
  let accumulator = 0;
  let frames = 0;
  while (state.resultType === null && frames < 30_000) {
    accumulator += frameMs;
    while (accumulator >= SURVIVAL_ARCADE_FIXED_STEP_MS - 1e-9 && state.resultType === null) {
      state = stepSurvivalArcade(state, { x: 0, y: 0 });
      accumulator -= SURVIVAL_ARCADE_FIXED_STEP_MS;
    }
    frames += 1;
  }
  if (frames === 30_000) throw new Error('arcade never completed');
  return state;
}

describe('three-minute survival arcade engine', () => {
  it.each([1000 / 30, 1000 / 60, 1000 / 120])('reaches the same 180-second success at %s ms render cadence', (frameMs) => {
    const state = simulateAtRenderCadence(frameMs);
    expect(state.resultType).toBe('survived');
    expect(state.elapsedMs).toBe(SURVIVAL_ARCADE_DURATION_MS);
  });

  it('marks a collision as caught before the timer can complete', () => {
    const state = stepSurvivalArcade({
      ...initialSurvivalArcadeState,
      hazards: [{ id: 'nearby', x: 50, y: 78, vx: 0, vy: 0, radius: 5 }],
    }, { x: 0, y: 0 });
    expect(state).toMatchObject({ resultType: 'caught' });
  });

  it('clamps movement inside the playable 2D arena', () => {
    const state = stepSurvivalArcade({ ...initialSurvivalArcadeState, hazards: [] }, { x: -99, y: 99 }, 10_000);
    expect(state.player.x).toBe(state.player.radius);
    expect(state.player.y).toBe(100 - state.player.radius);
  });

  it('finishes after 180 active seconds at 5fps while keeping fixed-step simulation', () => {
    let state: SurvivalArcadeState = { ...initialSurvivalArcadeState, hazards: [] };
    let timing = initialSurvivalArcadeFrameTiming;
    let frames = 0;

    while (state.resultType === null && frames < 1_000) {
      timing = advanceSurvivalArcadeFrameTiming(timing, 200, true);
      while (timing.simulationAccumulatorMs >= SURVIVAL_ARCADE_FIXED_STEP_MS - 1e-9 && state.resultType === null) {
        state = stepSurvivalArcadeSimulation(state, { x: 0, y: 0 });
        timing = {
          ...timing,
          simulationAccumulatorMs: timing.simulationAccumulatorMs - SURVIVAL_ARCADE_FIXED_STEP_MS,
        };
      }
      state = synchronizeSurvivalArcadeActiveTime(state, timing.activeElapsedMs);
      frames += 1;
    }

    expect(frames).toBe(900);
    expect(timing.activeElapsedMs).toBe(SURVIVAL_ARCADE_DURATION_MS);
    expect(state).toMatchObject({ elapsedMs: SURVIVAL_ARCADE_DURATION_MS, resultType: 'survived' });
  });

  it('excludes paused and background time from the visible active clock', () => {
    const timing = { activeElapsedMs: 12_000, simulationAccumulatorMs: 17 };
    expect(advanceSurvivalArcadeFrameTiming(timing, 60_000, false)).toBe(timing);
    expect(advanceSurvivalArcadeFrameTiming(timing, 1_000, true)).toEqual({
      activeElapsedMs: 13_000,
      simulationAccumulatorMs: 267,
    });
  });
});
