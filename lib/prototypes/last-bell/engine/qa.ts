import { initialLastBellState, reduceLastBellState, type LastBellState } from '@/lib/prototypes/last-bell/state';

/** Production-hidden deterministic happy-path seam for browser smoke automation. */
export function runChapterOneHappyPath(): { passed: boolean; states: LastBellState[] } {
  const actions = [
    { type: 'SKIP_OPENING' },
    { type: 'LOCK_CLASSROOM_DOOR' },
    { type: 'RESTORE_POWER' },
    { type: 'LOCK_FIRE_DOOR' },
    { type: 'TRIGGER_BELL' },
    { type: 'REACH_CHAPTER_EXIT' },
  ] as const;
  const states: LastBellState[] = [initialLastBellState];
  let state = initialLastBellState;
  for (const action of actions) {
    state = reduceLastBellState(state, action);
    states.push(state);
  }
  return { passed: state.phase === 'complete' && state.bellTriggered, states };
}
