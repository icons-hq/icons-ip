import { describe, expect, it } from 'vitest';
import { simulateLastBellEscape, stepLastBellEscapeChase } from './chase';

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
});
