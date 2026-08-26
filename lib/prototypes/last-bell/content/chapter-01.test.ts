import { describe, expect, it } from 'vitest';
import {
  CHAPTER_01_CLASSROOM_DOOR_PORTAL,
  CHAPTER_01_CONTENT,
  CHAPTER_01_PLAYER_START,
  validateChapter01Content,
} from './chapter-01';

describe('Chapter 01 review content', () => {
  it('authors only the start room, first bay, and first sliding door', () => {
    expect(CHAPTER_01_CONTENT.environmentId).toBe('hyosan-post-strike-night');
    expect(CHAPTER_01_CONTENT.zones.map((zone) => zone.id)).toEqual(['start-room', 'first-bay']);
    expect(CHAPTER_01_CONTENT.doors).toHaveLength(1);
    expect(CHAPTER_01_CONTENT.doors[0]).toMatchObject({ id: 'door.classroom.slide', kind: 'slide' });
    expect(CHAPTER_01_CONTENT.anchors.find((anchor) => anchor.id === CHAPTER_01_CONTENT.spawnAnchorId)).toMatchObject({ role: 'spawn', zoneId: 'start-room' });
    expect(CHAPTER_01_CONTENT.reviewGate).toEqual({ maxPlayerZ: 24.6, interactionAnchorIds: ['classroom_door'] });
    expect(CHAPTER_01_PLAYER_START).toMatchObject({ x: 0, z: 4 });
    expect(CHAPTER_01_CONTENT.doors[0]?.blockerBounds).toBe(CHAPTER_01_CLASSROOM_DOOR_PORTAL);
  });

  it('keeps authored zone, anchor, door, light, and audio references valid', () => {
    expect(validateChapter01Content(CHAPTER_01_CONTENT)).toEqual([]);
  });

  it('rejects a door control that points to no authored door', () => {
    const invalid = {
      ...CHAPTER_01_CONTENT,
      anchors: CHAPTER_01_CONTENT.anchors.map((anchor) => anchor.id === 'first-door-control'
        ? { ...anchor, doorId: 'door.missing' }
        : anchor),
    };

    expect(validateChapter01Content(invalid)).toContainEqual({
      subject: 'first-door-control',
      reason: 'door-control anchor must reference an authored door',
    });
  });
});
