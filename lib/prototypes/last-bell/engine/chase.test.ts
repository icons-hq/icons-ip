import { describe, expect, it } from 'vitest';
import { interactionDescriptorFor } from '../interactions';
import { LAST_BELL_FIXED_STEP } from './movement';
import { LAST_BELL_CHASE_SPAWN, simulateLastBellEscape, simulateLastBellEscapeAtCadence, simulateLastBellHideRecovery, stepLastBellEscapeChase } from './chase';

function sprintFromEarliestBellTriggerToHide() {
  const triggerRadius = interactionDescriptorFor('bell_trigger')?.radius ?? 2.25;
  const player = { x: 0, z: 48 - triggerRadius };
  const hide = { x: -2, z: 48 };
  const enemies = LAST_BELL_CHASE_SPAWN.map((enemy) => ({ ...enemy }));
  const distanceToSpawn = () => Math.min(...enemies.map((enemy) => Math.hypot(player.x - enemy.x, player.z - enemy.z)));
  const spawnDistance = distanceToSpawn();
  let minimumDistance = spawnDistance;
  let elapsed = 0;
  while (Math.hypot(player.x - hide.x, player.z - hide.z) > .0001 && elapsed < 2) {
    const dx = hide.x - player.x;
    const dz = hide.z - player.z;
    const length = Math.hypot(dx, dz);
    const travel = Math.min(3.35 * LAST_BELL_FIXED_STEP, length);
    player.x += dx / length * travel;
    player.z += dz / length * travel;
    const distance = stepLastBellEscapeChase(player, enemies, LAST_BELL_FIXED_STEP, false);
    minimumDistance = Math.min(minimumDistance, distance);
    if (distance < 1.5) return { captured: true, reachedHide: false, spawnDistance, hideDistance: distance, minimumDistance };
    elapsed += LAST_BELL_FIXED_STEP;
  }
  return { captured: false, reachedHide: true, spawnDistance, hideDistance: distanceToSpawn(), minimumDistance };
}

describe('last bell escape chase', () => {
  it('gives a fair two-second margin and reaches the exit when the player runs', () => {
    const result = simulateLastBellEscape(2, 3.35);
    expect(result.captured).toBe(false);
    expect(result.completed).toBe(true);
    expect(result.minimumDistance).toBeGreaterThan(2);
  });

  it('captures a player who stalls in the escape lane', () => {
    const result = simulateLastBellEscape(12, 0);
    expect(result.captured).toBe(true);
    expect(result.completed).toBe(false);
  });

  it('uses lateral x/z distance so a sidestep increases safety', () => {
    const enemy = [{ x: 0, z: 47 }];
    const centered = stepLastBellEscapeChase({ x: 0, z: 48 }, enemy.map((value) => ({ ...value })), 0, false);
    const sidestep = stepLastBellEscapeChase({ x: 2, z: 48 }, enemy.map((value) => ({ ...value })), 0, false);
    expect(sidestep).toBeGreaterThan(centered);
  });

  it('keeps a hidden player at a recoverable standoff and lets them leave safely', () => {
    const result = simulateLastBellHideRecovery();
    expect(result.hiddenDistance).toBeGreaterThanOrEqual(2.6);
    expect(result.releasedDistance).toBeGreaterThan(1.5);
  });

  it('gives an immediate bell prompt enough sprint/strafe time to reach the hide anchor', () => {
    const result = sprintFromEarliestBellTriggerToHide();
    expect(result.spawnDistance).toBeGreaterThan(1.5);
    expect(result.captured).toBe(false);
    expect(result.reachedHide).toBe(true);
    expect(result.hideDistance).toBeGreaterThan(1.5);
  });

  it.each([30, 60, 120])('keeps the fixed-step result at %sHz render cadence', (renderHz) => {
    const result = simulateLastBellEscapeAtCadence(2, 3.35, renderHz);
    expect(result).toEqual(simulateLastBellEscape(2, 3.35));
  });

  it.each([30, 60, 120])('keeps fixed-step capture deterministic at %sHz render cadence', (renderHz) => {
    const result = simulateLastBellEscapeAtCadence(12, 0, renderHz);
    expect(result).toEqual(simulateLastBellEscape(12, 0));
    expect(result.captured).toBe(true);
  });
});
