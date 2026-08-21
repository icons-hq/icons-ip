export const SURVIVAL_ARCADE_DURATION_MS = 180_000;
export const SURVIVAL_ARCADE_FIXED_STEP_MS = 1000 / 30;

export type SurvivalArcadeInput = { x: number; y: number };
export type SurvivalArcadeHazard = { id: string; x: number; y: number; vx: number; vy: number; radius: number };
export type SurvivalArcadeResultType = 'survived' | 'caught';

export type SurvivalArcadeState = {
  elapsedMs: number;
  player: { x: number; y: number; radius: number };
  hazards: SurvivalArcadeHazard[];
  resultType: SurvivalArcadeResultType | null;
};

export const initialSurvivalArcadeState: SurvivalArcadeState = {
  elapsedMs: 0,
  player: { x: 50, y: 78, radius: 4.5 },
  hazards: [
    { id: 'corridor-east', x: 18, y: 0, vx: 0, vy: 22, radius: 5.5 },
    { id: 'corridor-west', x: 82, y: 100, vx: 0, vy: -20, radius: 5.5 },
    { id: 'crossing', x: 0, y: 44, vx: 18, vy: 0, radius: 5 },
  ],
  resultType: null,
};

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function bounce(hazard: SurvivalArcadeHazard, deltaMs: number): SurvivalArcadeHazard {
  const seconds = deltaMs / 1000;
  let x = hazard.x + hazard.vx * seconds;
  let y = hazard.y + hazard.vy * seconds;
  let vx = hazard.vx;
  let vy = hazard.vy;
  if (x < 0 || x > 100) {
    x = clamp(x, 0, 100);
    vx *= -1;
  }
  if (y < 0 || y > 100) {
    y = clamp(y, 0, 100);
    vy *= -1;
  }
  return { ...hazard, x, y, vx, vy };
}

export function stepSurvivalArcade(
  state: SurvivalArcadeState,
  input: SurvivalArcadeInput,
  deltaMs = SURVIVAL_ARCADE_FIXED_STEP_MS,
): SurvivalArcadeState {
  if (state.resultType !== null || !Number.isFinite(deltaMs) || deltaMs <= 0) return state;
  const magnitude = Math.hypot(input.x, input.y);
  const scale = magnitude > 1 ? 1 / magnitude : 1;
  const seconds = deltaMs / 1000;
  const player = {
    ...state.player,
    x: clamp(state.player.x + input.x * scale * 34 * seconds, state.player.radius, 100 - state.player.radius),
    y: clamp(state.player.y + input.y * scale * 34 * seconds, state.player.radius, 100 - state.player.radius),
  };
  const hazards = state.hazards.map((hazard) => bounce(hazard, deltaMs));
  const caught = hazards.some((hazard) => Math.hypot(player.x - hazard.x, player.y - hazard.y) <= player.radius + hazard.radius);
  const nextElapsedMs = state.elapsedMs + deltaMs;
  // A 30Hz step cannot represent 1/30s exactly in binary. Snap only at the
  // authored finish line so render cadence cannot require an extra frame.
  const elapsedMs = nextElapsedMs >= SURVIVAL_ARCADE_DURATION_MS - .01
    ? SURVIVAL_ARCADE_DURATION_MS
    : nextElapsedMs;
  return {
    elapsedMs,
    player,
    hazards,
    resultType: caught ? 'caught' : elapsedMs >= SURVIVAL_ARCADE_DURATION_MS ? 'survived' : null,
  };
}
