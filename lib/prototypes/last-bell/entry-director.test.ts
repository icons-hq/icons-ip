import { describe, expect, it } from 'vitest';
import { EntryDirector, LAST_BELL_ENTRY_TIMING, skipEntryToPlaying } from './entry-director';

describe('Last Bell entry director', () => {
  it('keeps Canvas hidden until the scene is ready, then plays the authored timing', () => {
    const director = new EntryDirector();

    expect(director.advance({ sceneReady: false, deltaMs: 10000 })).toMatchObject({
      phase: 'preflight',
      sceneVisibility: 'hidden',
      handoff: null,
    });

    expect(director.advance({ sceneReady: true, deltaMs: 0 })).toMatchObject({ phase: 'brand', sceneVisibility: 'hidden' });
    expect(director.advance({ sceneReady: true, deltaMs: LAST_BELL_ENTRY_TIMING.brandMs })).toMatchObject({
      phase: 'cold-open',
      sceneVisibility: 'cinematic',
      inputEnabled: false,
    });
    expect(director.advance({ sceneReady: true, deltaMs: LAST_BELL_ENTRY_TIMING.coldOpenMs })).toMatchObject({ phase: 'aperture', sceneVisibility: 'revealing' });
    expect(director.advance({ sceneReady: true, deltaMs: LAST_BELL_ENTRY_TIMING.apertureMs })).toMatchObject({ phase: 'handoff', sceneVisibility: 'interactive', inputEnabled: false });
    expect(director.advance({ sceneReady: true, deltaMs: 0 })).toMatchObject({ phase: 'playing', sceneVisibility: 'interactive', inputEnabled: true });
  });

  it('uses the same handoff snapshot for a skipped and a natural entry', () => {
    const natural = new EntryDirector();
    const naturalHandoff = natural.advance({ sceneReady: true, deltaMs: LAST_BELL_ENTRY_TIMING.brandMs + LAST_BELL_ENTRY_TIMING.coldOpenMs + LAST_BELL_ENTRY_TIMING.apertureMs });
    const naturalPlaying = natural.advance({ sceneReady: true, deltaMs: 0 });

    const skipped = new EntryDirector();
    const skippedHandoff = skipped.advance({ sceneReady: true, skip: true, deltaMs: 0 });

    expect(naturalHandoff).toEqual(skippedHandoff);
    expect(skippedHandoff).toMatchObject({ phase: 'handoff', handoff: { checkpointId: 'chapter-01-start', objectiveId: 'secure-first-door' } });
    expect(skipEntryToPlaying(new EntryDirector(), { sceneReady: true, deltaMs: 0 })).toEqual(naturalPlaying);
  });

  it('waits for scene readiness even when skip is requested', () => {
    const director = new EntryDirector();
    expect(director.advance({ sceneReady: false, skip: true, deltaMs: 0 })).toMatchObject({ phase: 'preflight', sceneVisibility: 'hidden' });
    expect(director.advance({ sceneReady: true, deltaMs: 0 })).toMatchObject({ phase: 'handoff', sceneVisibility: 'interactive' });
  });

  it('also accepts a monotonic elapsed-time source', () => {
    const director = new EntryDirector();
    director.advance({ sceneReady: true, nowMs: 1000 });
    expect(director.advance({ sceneReady: true, nowMs: 1000 + LAST_BELL_ENTRY_TIMING.brandMs })).toMatchObject({ phase: 'cold-open' });
  });

  it('uses only the bounded reduced-motion crossfade during the reveal', () => {
    const director = new EntryDirector();
    director.advance({ sceneReady: true, reducedMotion: true, deltaMs: LAST_BELL_ENTRY_TIMING.brandMs + LAST_BELL_ENTRY_TIMING.coldOpenMs });
    const reveal = director.advance({ sceneReady: true, reducedMotion: true, deltaMs: 0 });

    expect(reveal).toMatchObject({
      phase: 'aperture',
      effectIds: ['entry.reduced-motion-crossfade'],
      transition: { kind: 'crossfade', durationMs: 320 },
    });
    expect(reveal.effectIds).not.toContain('entry.aperture-radial-warp');
    expect(reveal.transition.durationMs).toBeGreaterThanOrEqual(250);
    expect(reveal.transition.durationMs).toBeLessThanOrEqual(400);
  });
});
