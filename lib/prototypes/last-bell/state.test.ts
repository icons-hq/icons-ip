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

  it('retries the power checkpoint in the corridor so the panel remains reachable', () => {
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
    expect(captured.phase).toBe('corridor');
    expect(captured.checkpoint).toBe('power');
    expect(captured.powerRestored).toBe(false);
    expect(canInteractAt(captured, 'utility_panel', { x: 3, z: 29 })).toBe(true);
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
    expect(reduceLastBellState(rung, { type: 'REACH_CHAPTER_EXIT' }).phase).toBe('complete');
  });

  it('exposes two pre-bell corridor hide anchors and one bell escape hide anchor', () => {
    const corridor = { ...initialLastBellState, phase: 'corridor' as const, doorLocked: true };
    expect(canInteractAt(corridor, 'corridor_hide_left', { x: -2, z: 22 })).toBe(true);
    expect(canInteractAt(corridor, 'corridor_hide_right', { x: 2, z: 34 })).toBe(true);
    const bell = { ...corridor, phase: 'bell' as const, bellTriggered: true, powerRestored: true, fireDoorLocked: true };
    expect(canInteractAt(bell, 'bell_hide', { x: 1.7, z: 45 })).toBe(true);
  });

  it('restores saved semantic checkpoints without replaying the opening', () => {
    const power = reduceLastBellState(initialLastBellState, { type: 'RESTORE_CHECKPOINT', checkpointId: 'ch1_power_restored' });
    expect(power).toMatchObject({ phase: 'power', doorLocked: true, powerRestored: true, checkpoint: 'power' });
    const postBell = reduceLastBellState(initialLastBellState, { type: 'RESTORE_CHECKPOINT', checkpointId: 'ch1_post_bell_safe' });
    expect(postBell).toMatchObject({ phase: 'bell', fireDoorLocked: true, bellTriggered: true });
    expect(objectiveForState(power)).toBe('비상전원이 돌아왔다. 화재문을 잠가라');
  });
});
