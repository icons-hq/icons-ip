import { describe, expect, it } from 'vitest';
import { LastBellSimulation } from './simulation';

function simulateAtCadence(renderHz: number) {
  const simulation = new LastBellSimulation();
  const frameSeconds = 1 / renderHz;
  let elapsed = 0;
  while (elapsed < 2 - 1e-9) {
    const delta = Math.min(frameSeconds, 2 - elapsed);
    simulation.advance(delta, {
      movement: { x: 0, y: 1 },
      facingRadians: 0,
      flashlightOn: false,
      running: true,
    });
    elapsed += delta;
  }
  const snapshot = simulation.snapshot();
  return {
    tick: snapshot.tick,
    elapsedSeconds: snapshot.elapsedSeconds,
    player: snapshot.player.position,
    doors: snapshot.doors.passability,
    zombies: snapshot.zombies.map((zombie) => ({ id: zombie.id, position: zombie.position, state: zombie.state })),
  };
}

describe('Last Bell fixed 30Hz cadence', () => {
  it.each([5, 15, 30, 60, 120])('has the same result at %sHz render cadence', (renderHz) => {
    expect(simulateAtCadence(renderHz)).toEqual(simulateAtCadence(30));
  });

  it('runs a 200ms render stall as six simulation steps without losing deterministic state', () => {
    const stalled = new LastBellSimulation();
    const smooth = new LastBellSimulation();
    const input = { movement: { x: 0, y: 1 }, facingRadians: 0, flashlightOn: false, running: true };
    stalled.advance(.2, input);
    for (let step = 0; step < 6; step += 1) smooth.advance(1 / 30, input);
    expect(stalled.snapshot()).toEqual(smooth.snapshot());
  });
});
