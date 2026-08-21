import { describe, expect, it } from 'vitest';
import {
  initialSurvivalArcadeState,
  stepSurvivalArcade,
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
});
