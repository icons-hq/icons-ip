export const LAST_BELL_ENTRY_TIMING = {
  brandMs: 3500,
  coldOpenMs: 14000,
  apertureMs: 850,
  reducedMotionCrossfadeMs: 320,
} as const;

export type EntryDirectorPhase =
  | 'preflight'
  | 'brand'
  | 'cold-open'
  | 'aperture'
  | 'handoff'
  | 'playing';

export type EntryDirectorEffectId =
  | 'entry.brand-card'
  | 'entry.cold-open'
  | 'entry.aperture-radial-warp'
  | 'entry.reduced-motion-crossfade';

export type EntryDirectorInput = {
  /** A monotonic wall-clock value. It is optional when `deltaMs` is supplied. */
  nowMs?: number;
  /** Elapsed time from the render clock. Negative values are ignored. */
  deltaMs?: number;
  sceneReady: boolean;
  skip?: boolean;
  reducedMotion?: boolean;
};

export type EntryDirectorSnapshot = {
  phase: EntryDirectorPhase;
  /** `cinematic` is visible in-engine but keeps gameplay input disabled. */
  sceneVisibility: 'hidden' | 'cinematic' | 'revealing' | 'interactive';
  inputEnabled: boolean;
  effectIds: readonly EntryDirectorEffectId[];
  transition: { kind: 'none' | 'aperture' | 'crossfade'; durationMs: number };
  /** Stable semantic handoff shared by the natural and skipped paths. */
  handoff: { checkpointId: 'chapter-01-start'; objectiveId: 'secure-first-door' } | null;
};

const HANDOFF = {
  checkpointId: 'chapter-01-start',
  objectiveId: 'secure-first-door',
} as const;

/**
 * Owns the complete entry sequence without depending on DOM, Audio, or Three.
 * Call `advance` from a transient render ref; its snapshots are deliberately
 * suitable for a consumer to render without promoting frame state into React.
 */
export class EntryDirector {
  private phase: EntryDirectorPhase = 'preflight';
  private elapsedMs = 0;
  private lastNowMs: number | null = null;
  private skipRequested = false;

  advance(input: EntryDirectorInput): EntryDirectorSnapshot {
    this.skipRequested ||= input.skip === true;
    const deltaMs = this.deltaFor(input);

    if (this.phase === 'preflight') {
      if (!input.sceneReady) return this.snapshot(input.reducedMotion === true);
      this.phase = this.skipRequested ? 'handoff' : 'brand';
      this.elapsedMs = 0;
      if (this.phase === 'handoff') return this.snapshot(input.reducedMotion === true);
    }

    if (this.skipRequested && this.phase !== 'handoff' && this.phase !== 'playing') {
      this.phase = 'handoff';
      this.elapsedMs = 0;
      return this.snapshot(input.reducedMotion === true);
    }

    // Handoff is intentionally observable for one advance call. This gives
    // both the natural and skipped paths the exact same game-start snapshot.
    if (this.phase === 'handoff') {
      this.phase = 'playing';
      return this.snapshot(input.reducedMotion === true);
    }

    if (this.phase !== 'playing') this.consume(deltaMs, input.reducedMotion === true);
    return this.snapshot(input.reducedMotion === true);
  }

  reset(): EntryDirectorSnapshot {
    this.phase = 'preflight';
    this.elapsedMs = 0;
    this.lastNowMs = null;
    this.skipRequested = false;
    return this.snapshot(false);
  }

  private deltaFor(input: EntryDirectorInput): number {
    if (typeof input.deltaMs === 'number') return Number.isFinite(input.deltaMs) ? Math.max(0, input.deltaMs) : 0;
    if (typeof input.nowMs !== 'number' || !Number.isFinite(input.nowMs)) return 0;
    const previous = this.lastNowMs;
    this.lastNowMs = input.nowMs;
    return previous === null ? 0 : Math.max(0, input.nowMs - previous);
  }

  private consume(deltaMs: number, reducedMotion: boolean): void {
    let remaining = deltaMs;
    while (remaining > 0 && this.phase !== 'handoff' && this.phase !== 'playing') {
      const durationMs = this.durationFor(this.phase, reducedMotion);
      const untilTransition = Math.max(0, durationMs - this.elapsedMs);
      const consumed = Math.min(remaining, untilTransition);
      this.elapsedMs += consumed;
      remaining -= consumed;
      if (this.elapsedMs + .0001 < durationMs) return;

      this.elapsedMs = 0;
      this.phase = this.nextPhase(this.phase);
    }
  }

  private durationFor(phase: EntryDirectorPhase, reducedMotion: boolean): number {
    if (phase === 'brand') return LAST_BELL_ENTRY_TIMING.brandMs;
    if (phase === 'cold-open') return LAST_BELL_ENTRY_TIMING.coldOpenMs;
    if (phase === 'aperture') {
      return reducedMotion
        ? LAST_BELL_ENTRY_TIMING.reducedMotionCrossfadeMs
        : LAST_BELL_ENTRY_TIMING.apertureMs;
    }
    return 0;
  }

  private nextPhase(phase: EntryDirectorPhase): EntryDirectorPhase {
    if (phase === 'brand') return 'cold-open';
    if (phase === 'cold-open') return 'aperture';
    if (phase === 'aperture') return 'handoff';
    return phase;
  }

  private snapshot(reducedMotion: boolean): EntryDirectorSnapshot {
    if (this.phase === 'preflight') {
      return {
        phase: this.phase,
        sceneVisibility: 'hidden',
        inputEnabled: false,
        effectIds: [],
        transition: { kind: 'none', durationMs: 0 },
        handoff: null,
      };
    }

    if (this.phase === 'brand') {
      return {
        phase: this.phase,
        sceneVisibility: 'hidden',
        inputEnabled: false,
        effectIds: ['entry.brand-card'],
        transition: { kind: 'none', durationMs: 0 },
        handoff: null,
      };
    }

    if (this.phase === 'cold-open') {
      return {
        phase: this.phase,
        sceneVisibility: 'cinematic',
        inputEnabled: false,
        effectIds: ['entry.cold-open'],
        transition: { kind: 'none', durationMs: 0 },
        handoff: null,
      };
    }

    if (this.phase === 'aperture') {
      const transition = reducedMotion
        ? { kind: 'crossfade' as const, durationMs: LAST_BELL_ENTRY_TIMING.reducedMotionCrossfadeMs }
        : { kind: 'aperture' as const, durationMs: LAST_BELL_ENTRY_TIMING.apertureMs };
      return {
        phase: this.phase,
        sceneVisibility: 'revealing',
        inputEnabled: false,
        effectIds: reducedMotion ? ['entry.reduced-motion-crossfade'] : ['entry.aperture-radial-warp'],
        transition,
        handoff: null,
      };
    }

    return {
      phase: this.phase,
      sceneVisibility: 'interactive',
      inputEnabled: this.phase === 'playing',
      effectIds: [],
      transition: { kind: 'none', durationMs: 0 },
      handoff: HANDOFF,
    };
  }
}

/**
 * Advances an already-ready entry through its single observable handoff and
 * returns the exact interactive snapshot. Checkpoint resume uses this same
 * path, so it cannot leave a mounted Canvas in the seated cinematic phase.
 */
export function skipEntryToPlaying(
  director: EntryDirector,
  input: Omit<EntryDirectorInput, 'skip'>,
): EntryDirectorSnapshot | null {
  const handoff = director.advance({ ...input, skip: true });
  if (handoff.phase !== 'handoff') return null;
  const playing = director.advance(input);
  return playing.phase === 'playing' ? playing : null;
}
