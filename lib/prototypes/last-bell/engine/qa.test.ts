import { describe, expect, it } from 'vitest';
import { checkpointPositionFor } from './checkpoint';
import { runChapterOneHappyPath } from './qa';

describe('chapter one deterministic QA seam', () => {
  it('completes the ordered happy path without UI or network', () => {
    const result = runChapterOneHappyPath();
    expect(result.passed).toBe(true);
    expect(result.states.map((state) => state.phase)).toEqual(['opening', 'classroom', 'corridor', 'corridor', 'corridor', 'corridor', 'power', 'bell', 'bell', 'complete']);
    expect(result.states[8].checkpoint).toBe('power');
  });

  it('restores retry attempts to a safe semantic checkpoint', () => {
    expect(checkpointPositionFor('corridor')).toMatchObject({ x: 0, z: 13.9, chaseSeconds: 0 });
    expect(checkpointPositionFor('power')).toMatchObject({ x: 2.25, z: 27, chaseSeconds: 0 });
  });
});
