export type PerceptionState = 'idle' | 'investigate' | 'search' | 'chase';

export type PerceptionEvent = Readonly<{
  type: 'light-warning' | 'investigate' | 'search' | 'chase' | 'idle';
  source?: 'light' | 'noise' | 'lost-contact';
}>;

export type PerceptionInput = Readonly<{
  distance: number;
  /** Signed degrees from the centre of an agent's flashlight beam. */
  beamAngleDegrees: number;
  directLight: boolean;
  lineOfSight: boolean;
  exposureDeltaSeconds: number;
  /** Normalized 0–1 environmental noise at the agent. */
  noise: number;
  /** Normalized 0–1 world occlusion; any positive occlusion blocks direct light. */
  occlusion: number;
}>;

export type PerceptionSnapshot = Readonly<{
  state: PerceptionState;
  directLightDetected: boolean;
  exposureSeconds: number;
  events: readonly PerceptionEvent[];
}>;

export type PerceptionTuning = Readonly<{
  maxDirectLightDistance: number;
  maxBeamAngleDegrees: number;
  investigateExposureSeconds: number;
  chaseExposureSeconds: number;
  exposureDecayPerSecond: number;
  noiseInvestigateThreshold: number;
  investigateHoldSeconds: number;
  searchSeconds: number;
}>;

export const DEFAULT_PERCEPTION_TUNING: PerceptionTuning = {
  maxDirectLightDistance: 10,
  maxBeamAngleDegrees: 24,
  investigateExposureSeconds: .3,
  chaseExposureSeconds: .9,
  exposureDecayPerSecond: .6,
  noiseInvestigateThreshold: .55,
  investigateHoldSeconds: 1.2,
  searchSeconds: 2.4,
};

/**
 * Renderer-independent perception. `observe` is the sole seam: a scene may
 * derive its inputs from raycasts, but shadow maps never become AI truth.
 */
export class Perception {
  private state: PerceptionState = 'idle';
  private exposureSeconds = 0;
  private noContactSeconds = 0;
  private warningArmed = false;
  private investigatedByLight = false;
  private readonly tuning: PerceptionTuning;

  constructor(tuning: Partial<PerceptionTuning> = {}) {
    this.tuning = { ...DEFAULT_PERCEPTION_TUNING, ...tuning };
  }

  observe(input: PerceptionInput): PerceptionSnapshot {
    const events: PerceptionEvent[] = [];
    const deltaSeconds = Math.max(0, Number.isFinite(input.exposureDeltaSeconds) ? input.exposureDeltaSeconds : 0);
    const directLightDetected = this.detectsDirectLight(input);
    const effectiveNoise = clamp01(input.noise) * (1 - clamp01(input.occlusion));

    if (directLightDetected) {
      this.noContactSeconds = 0;
      this.exposureSeconds = Math.min(this.tuning.chaseExposureSeconds, this.exposureSeconds + deltaSeconds);
      if (!this.warningArmed) {
        this.warningArmed = true;
        events.push({ type: 'light-warning', source: 'light' });
      }
      if (this.exposureSeconds >= this.tuning.investigateExposureSeconds && !this.investigatedByLight) {
        this.investigatedByLight = true;
        this.enter('investigate', 'light', events);
      }
      if (this.investigatedByLight && this.exposureSeconds >= this.tuning.chaseExposureSeconds) {
        this.enter('chase', 'light', events);
      }
    } else {
      this.warningArmed = false;
      this.exposureSeconds = Math.max(0, this.exposureSeconds - deltaSeconds * this.tuning.exposureDecayPerSecond);
      this.handleLostContact(deltaSeconds, effectiveNoise, events);
    }

    if (!directLightDetected && effectiveNoise >= this.tuning.noiseInvestigateThreshold && this.state === 'idle') {
      this.enter('investigate', 'noise', events);
      this.noContactSeconds = 0;
    }

    return {
      state: this.state,
      directLightDetected,
      exposureSeconds: this.exposureSeconds,
      events,
    };
  }

  reset(): PerceptionSnapshot {
    this.state = 'idle';
    this.exposureSeconds = 0;
    this.noContactSeconds = 0;
    this.warningArmed = false;
    this.investigatedByLight = false;
    return { state: this.state, directLightDetected: false, exposureSeconds: 0, events: [] };
  }

  private detectsDirectLight(input: PerceptionInput): boolean {
    return input.directLight
      && input.lineOfSight
      && clamp01(input.occlusion) === 0
      && Number.isFinite(input.distance)
      && input.distance >= 0
      && input.distance <= this.tuning.maxDirectLightDistance
      && Math.abs(input.beamAngleDegrees) <= this.tuning.maxBeamAngleDegrees;
  }

  private handleLostContact(deltaSeconds: number, effectiveNoise: number, events: PerceptionEvent[]): void {
    if (effectiveNoise >= this.tuning.noiseInvestigateThreshold) {
      this.noContactSeconds = 0;
      if (this.state === 'chase') this.enter('investigate', 'noise', events);
      return;
    }

    this.noContactSeconds += deltaSeconds;
    if (this.state === 'chase') {
      this.enter('search', 'lost-contact', events);
      this.noContactSeconds = 0;
      return;
    }
    if (this.state === 'investigate' && this.noContactSeconds >= this.tuning.investigateHoldSeconds) {
      this.enter('search', 'lost-contact', events);
      this.noContactSeconds = 0;
      return;
    }
    if (this.state === 'search' && this.noContactSeconds >= this.tuning.searchSeconds) {
      this.enter('idle', 'lost-contact', events);
      this.noContactSeconds = 0;
    }
  }

  private enter(next: PerceptionState, source: NonNullable<PerceptionEvent['source']>, events: PerceptionEvent[]): void {
    if (this.state === next) return;
    this.state = next;
    events.push({ type: next, source });
  }
}

export function createPerception(tuning?: Partial<PerceptionTuning>): Perception {
  return new Perception(tuning);
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}
