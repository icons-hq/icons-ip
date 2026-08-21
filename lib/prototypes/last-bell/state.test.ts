import { describe, expect, it } from 'vitest';
import {
  canInteractAt,
  initialLastBellState,
  objectiveForState,
  reduceLastBellState,
} from './state';

describe('last bell chapter state', () => {
  it('requires the ordered chapter path', () => {
    const skipped = reduceLastBellState(initialLastBellState, { type: 'SKIP_OPENING' });
    expect(skipped.phase).toBe('classroom');
    expect(reduceLastBellState(skipped, { type: 'RESTORE_POWER' })).toEqual(skipped);
    const corridor = reduceLastBellState(skipped, { type: 'LOCK_CLASSROOM_DOOR' });
    const power = reduceLastBellState(corridor, { type: 'RESTORE_POWER' });
    expect(power.phase).toBe('power');
    expect(reduceLastBellState(power, { type: 'TRIGGER_BELL' })).toEqual(power);
  });

  it('retries the last safe power checkpoint with power already restored', () => {
    const captured = reduceLastBellState(
      {
        ...initialLastBellState,
        phase: 'power',
        doorLocked: true,
        checkpoint: 'power',
        captured: true,
      },
      { type: 'RETRY' },
    );
    expect(captured.phase).toBe('power');
    expect(captured.checkpoint).toBe('power');
    expect(captured.powerRestored).toBe(true);
    expect(captured.fireDoorLocked).toBe(false);
    expect(canInteractAt(captured, 'fire_door_lock', { x: 0, z: 41 })).toBe(true);
  });

  it('does not complete at the bell before reaching the exit anchor', () => {
    const state = {
      ...initialLastBellState,
      phase: 'bell' as const,
      doorLocked: true,
      powerRestored: true,
      fireDoorLocked: true,
    };
    const rung = reduceLastBellState(state, { type: 'TRIGGER_BELL' });
    expect(rung.phase).toBe('bell');
    expect(rung.bellTriggered).toBe(true);
    expect(rung.checkpoint).toBe('power');
    expect(reduceLastBellState(rung, { type: 'REACH_CHAPTER_EXIT' }).phase).toBe('complete');
  });

  it('requires the player to be close to the bell before the chase can start', () => {
    const armedBell = {
      ...initialLastBellState,
      phase: 'bell' as const,
      doorLocked: true,
      powerRestored: true,
      fireDoorLocked: true,
    };
    expect(canInteractAt(armedBell, 'bell_trigger', { x: 0, z: 45.75 })).toBe(false);
    expect(canInteractAt(armedBell, 'bell_trigger', { x: 0, z: 47.1 })).toBe(true);
  });

  it('exposes two pre-bell corridor hide anchors and one bell escape hide anchor', () => {
    const corridor = { ...initialLastBellState, phase: 'corridor' as const, doorLocked: true };
    expect(canInteractAt(corridor, 'corridor_hide_left', { x: -2, z: 22 })).toBe(true);
    expect(canInteractAt(corridor, 'corridor_hide_right', { x: 2, z: 34 })).toBe(true);
    const power = { ...corridor, phase: 'power' as const, powerRestored: true };
    expect(canInteractAt(power, 'corridor_hide_left', { x: -2, z: 22 })).toBe(true);
    const bell = { ...corridor, phase: 'bell' as const, bellTriggered: true, powerRestored: true, fireDoorLocked: true };
    expect(canInteractAt(bell, 'bell_hide', { x: -2, z: 48 })).toBe(true);
  });

  it('toggles hiding in every phase that exposes a hide interaction', () => {
    for (const phase of ['classroom', 'corridor', 'power', 'bell'] as const) {
      const state = {
        ...initialLastBellState,
        phase,
        doorLocked: phase !== 'classroom',
        powerRestored: phase === 'power' || phase === 'bell',
        fireDoorLocked: phase === 'bell',
        bellTriggered: phase === 'bell',
      };
      const hidden = reduceLastBellState(state, { type: 'TOGGLE_HIDE' });
      expect(hidden.hiding, phase).toBe(true);
      expect(reduceLastBellState(hidden, { type: 'TOGGLE_HIDE' }).hiding, phase).toBe(false);
    }
  });

  it('restores saved semantic checkpoints without replaying the opening', () => {
    const power = reduceLastBellState(initialLastBellState, { type: 'RESTORE_CHECKPOINT', checkpointId: 'ch1_power_restored' });
    expect(power).toMatchObject({ phase: 'power', doorLocked: true, powerRestored: true, checkpoint: 'power' });
    expect(objectiveForState(power)).toBe('비상전원이 돌아왔다. 화재문을 잠가라');
  });

  it('retries a post-bell capture from the power checkpoint', () => {
    const bell = reduceLastBellState(
      { ...initialLastBellState, phase: 'bell', doorLocked: true, powerRestored: true, fireDoorLocked: true, bellTriggered: true, checkpoint: 'power', captured: true },
      { type: 'RETRY' },
    );
    expect(bell).toMatchObject({ phase: 'power', powerRestored: true, fireDoorLocked: false, bellTriggered: false, checkpoint: 'power' });
  });
});
