export type ChasePosition = { x: number; z: number };

export type ChaseEnemy = ChasePosition;

export const LAST_BELL_CHASE_SPEED = 1.15;
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
  let nearest = Number.POSITIVE_INFINITY;
  for (const enemy of enemies) {
    const dx = player.x - enemy.x;
    const dz = player.z - enemy.z;
    const length = Math.hypot(dx, dz);
    if (length > .001) {
      enemy.x += (dx / length) * speed * deltaSeconds;
      enemy.z += (dz / length) * speed * deltaSeconds;
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
  const player = { x: 0, z: 48 };
  const enemies = LAST_BELL_CHASE_SPAWN.map((enemy) => ({ ...enemy }));
  let minimumDistance = Number.POSITIVE_INFINITY;
  for (let elapsed = 0; elapsed < seconds; elapsed += 1 / 30) {
    player.z += playerSpeed / 30;
    const distance = enemySpeed === LAST_BELL_CHASE_SPEED
      ? stepLastBellEscapeChase(player, enemies, 1 / 30, false)
      : stepCustomChase(player, enemies, 1 / 30, enemySpeed);
    minimumDistance = Math.min(minimumDistance, distance);
    if (distance < 1.5) return { captured: true, completed: false, minimumDistance };
    if (player.z >= 53) return { captured: false, completed: true, minimumDistance };
  }
  return { captured: false, completed: player.z >= 53, minimumDistance };
}

function stepCustomChase(player: ChasePosition, enemies: ChaseEnemy[], deltaSeconds: number, speed: number): number {
  let nearest = Number.POSITIVE_INFINITY;
  for (const enemy of enemies) {
    const dx = player.x - enemy.x;
    const dz = player.z - enemy.z;
    const length = Math.hypot(dx, dz);
    if (length > .001) {
      enemy.x += (dx / length) * speed * deltaSeconds;
      enemy.z += (dz / length) * speed * deltaSeconds;
    }
    nearest = Math.min(nearest, Math.hypot(player.x - enemy.x, player.z - enemy.z));
  }
  return nearest;
}
