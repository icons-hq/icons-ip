import { LAST_BELL_FIXED_STEP } from './movement';

export type ChasePosition = { x: number; z: number };

export type ChaseEnemy = ChasePosition;

export const LAST_BELL_CHASE_SPEED = 1.15;
export const LAST_BELL_HIDDEN_STANDOFF = 2.6;
export const LAST_BELL_CHASE_SPAWN: readonly ChaseEnemy[] = [
  { x: -1.35, z: 43.4 },
  { x: 1.35, z: 44.1 },
];

/** One deterministic escape step. Enemies wake behind the player and steer in x/z space. */
export function stepLastBellEscapeChase(
  player: ChasePosition,
  enemies: ChaseEnemy[],
  deltaSeconds: number,
  hiding: boolean,
): number {
  const speed = hiding ? .34 : LAST_BELL_CHASE_SPEED;
  return stepChaseInternal(player, enemies, deltaSeconds, speed, hiding ? LAST_BELL_HIDDEN_STANDOFF : 0);
}

function stepChaseInternal(
  player: ChasePosition,
  enemies: ChaseEnemy[],
  deltaSeconds: number,
  speed: number,
  minimumDistance = 0,
): number {
  let nearest = Number.POSITIVE_INFINITY;
  for (const enemy of enemies) {
    const dx = player.x - enemy.x;
    const dz = player.z - enemy.z;
    const length = Math.hypot(dx, dz);
    if (length > .001) {
      const travel = Math.min(speed * deltaSeconds, Math.max(0, length - minimumDistance));
      enemy.x += (dx / length) * travel;
      enemy.z += (dz / length) * travel;
    }
    nearest = Math.min(nearest, Math.hypot(player.x - enemy.x, player.z - enemy.z));
  }
  return nearest;
}

export function simulateLastBellEscape(
  seconds: number,
  playerSpeed: number,
  enemySpeed = LAST_BELL_CHASE_SPEED,
): { captured: boolean; completed: boolean; minimumDistance: number } {
  return simulateLastBellEscapeAtCadence(seconds, playerSpeed, 30, enemySpeed);
}

export function simulateLastBellEscapeAtCadence(
  seconds: number,
  playerSpeed: number,
  renderHz: number,
  enemySpeed = LAST_BELL_CHASE_SPEED,
): { captured: boolean; completed: boolean; minimumDistance: number } {
  const player = { x: 0, z: 48 };
  const enemies = LAST_BELL_CHASE_SPAWN.map((enemy) => ({ ...enemy }));
  const renderStep = 1 / renderHz;
  let accumulator = 0;
  let elapsed = 0;
  let minimumDistance = Number.POSITIVE_INFINITY;
  while (elapsed < seconds - 1e-9) {
    const renderDelta = Math.min(renderStep, seconds - elapsed);
    elapsed += renderDelta;
    accumulator += renderDelta;
    while (accumulator >= LAST_BELL_FIXED_STEP - 1e-10) {
      player.z += playerSpeed * LAST_BELL_FIXED_STEP;
      const distance = stepChaseInternal(player, enemies, LAST_BELL_FIXED_STEP, enemySpeed);
      minimumDistance = Math.min(minimumDistance, distance);
      accumulator -= LAST_BELL_FIXED_STEP;
      if (distance < 1.5) return { captured: true, completed: false, minimumDistance };
      if (player.z >= 53) return { captured: false, completed: true, minimumDistance };
    }
  }
  return { captured: false, completed: player.z >= 53, minimumDistance };
}

export function simulateLastBellHideRecovery(
  hiddenSeconds = 5,
): { hiddenDistance: number; releasedDistance: number } {
  const player = { x: -2, z: 48 };
  const enemies = LAST_BELL_CHASE_SPAWN.map((enemy) => ({ ...enemy }));
  let hiddenDistance = Number.POSITIVE_INFINITY;
  for (let elapsed = 0; elapsed < hiddenSeconds - 1e-9; elapsed += LAST_BELL_FIXED_STEP) {
    hiddenDistance = Math.min(hiddenDistance, stepLastBellEscapeChase(player, enemies, LAST_BELL_FIXED_STEP, true));
  }
  const releasedDistance = stepLastBellEscapeChase(player, enemies, LAST_BELL_FIXED_STEP, false);
  return { hiddenDistance, releasedDistance };
}
