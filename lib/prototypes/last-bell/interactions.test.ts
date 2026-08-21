import { describe, expect, it } from 'vitest';
import {
  INTERACTION_DESCRIPTORS,
  interactionDescriptorFor,
} from './interactions';

describe('last bell interaction registry', () => {
  it('owns every interactive anchor without exposing spawn/listen anchors', () => {
    expect(INTERACTION_DESCRIPTORS.map(({ anchor }) => anchor)).toEqual([
      'classroom_door',
      'desk_hide',
      'corridor_hide_left',
      'corridor_hide_right',
      'bell_hide',
      'utility_panel',
      'fire_door_lock',
      'bell_trigger',
      'chapter_exit',
    ]);
    const anchors = INTERACTION_DESCRIPTORS.map(({ anchor }) => anchor as string);
    expect(anchors.some((anchor) => anchor === 'classroom_spawn')).toBe(false);
    expect(anchors.some((anchor) => anchor === 'corridor_listen')).toBe(false);
  });

  it('keeps hide action and audio volume in the same descriptor', () => {
    expect(interactionDescriptorFor('bell_hide')?.action).toBe('toggleHide');
    expect(interactionDescriptorFor('classroom_door')?.audio).toEqual({ id: 'doorPounding', volume: .42 });
    expect(interactionDescriptorFor(null)).toBeUndefined();
  });

  it('authored a tighter bell trigger radius than the generic interaction radius', () => {
    expect(interactionDescriptorFor('bell_trigger')?.radius).toBe(.95);
    expect(interactionDescriptorFor('classroom_door')?.radius).toBeUndefined();
  });
});
