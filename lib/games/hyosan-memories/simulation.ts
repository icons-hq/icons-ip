import { seededRng } from '@/lib/games/seed';

export const HYOSAN_FIXED_TIMESTEP_MS = 1000 / 60;

export interface HyosanInputFrame {
  moveX: number;
  moveY: number;
  attackPressed: boolean;
  skillPressed: boolean;
  dashPressed: boolean;
}

export const EMPTY_HYOSAN_INPUT: Readonly<HyosanInputFrame> = Object.freeze({
  moveX: 0,
  moveY: 0,
  attackPressed: false,
  skillPressed: false,
  dashPressed: false,
});

interface HyosanPoint {
  x: number;
  y: number;
}

export interface HyosanZombieSnapshot extends HyosanPoint {
  id: string;
  health: number;
  defeated: boolean;
}

export interface HyosanZombieDefinition extends HyosanPoint {
  id: string;
  health: number;
  speed: number;
}

export interface HyosanEncounterDefinition {
  player: HyosanPoint;
  zombies: readonly HyosanZombieDefinition[];
}

export interface HyosanSimulationSnapshot {
  step: number;
  elapsedMs: number;
  player: HyosanPoint & {
    health: number;
    facingX: number;
    facingY: number;
    dashing: boolean;
    invulnerable: boolean;
    defeated: boolean;
  };
  zombies: readonly HyosanZombieSnapshot[];
  room: {
    locked: boolean;
    cleared: boolean;
    started: boolean;
    exited: boolean;
  };
}

export type HyosanSimulationEvent =
  | { step: number; type: 'room_locked'; zombieCount: number }
  | { step: number; type: 'zombie_spawned'; zombieId: string; x: number; y: number }
  | { step: number; type: 'player_attack'; combo: 1 | 2 | 3; directionX: number; directionY: number }
  | { step: number; type: 'zombie_hit'; zombieId: string; combo: 1 | 2 | 3; damage: number }
  | { step: number; type: 'zombie_defeated'; zombieId: string }
  | { step: number; type: 'room_cleared' }
  | { step: number; type: 'room_unlocked' }
  | { step: number; type: 'room_exited' }
  | { step: number; type: 'player_dashed'; directionX: number; directionY: number }
  | { step: number; type: 'player_hit'; zombieId: string; damage: number }
  | { step: number; type: 'player_defeated' }
  | { step: number; type: 'skill_used' };

export interface HyosanSimulationOptions {
  seed: string;
  zombieCount?: number;
  encounter?: Readonly<HyosanEncounterDefinition>;
}

export interface HyosanSimulation {
  step(input: HyosanInputFrame): void;
  getSnapshot(): HyosanSimulationSnapshot;
  getEventLog(): readonly HyosanSimulationEvent[];
  getEventsSince(index: number): readonly HyosanSimulationEvent[];
}

export const HYOSAN_ROOM_BOUNDS = Object.freeze({ left: 72, right: 1208, top: 72, bottom: 648 });
export const HYOSAN_EXIT_BOUNDS = Object.freeze({ left: 552, right: 728, top: 24, completeY: 32 });
const ROOM = HYOSAN_ROOM_BOUNDS;
const PLAYER_SPEED_PER_STEP = 3.5;
const ATTACK_COOLDOWN_STEPS = 6;
const COMBO_WINDOW_STEPS = 20;
const ATTACK_RANGE = 86;
const COMBO_DAMAGE = Object.freeze([1, 1, 2] as const);
const DASH_DURATION_STEPS = 10;
const DASH_INVULNERABLE_STEPS = 13;
const DASH_COOLDOWN_STEPS = 45;
const DASH_SPEED_PER_STEP = 10;
const CONTACT_RANGE = 28;
const CONTACT_DAMAGE_COOLDOWN_STEPS = 45;

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

function normalizeMovement(input: HyosanInputFrame): HyosanPoint {
  const length = Math.hypot(input.moveX, input.moveY);
  if (length === 0) return { x: 0, y: 0 };
  const scale = Math.min(1, length) / length;
  return { x: input.moveX * scale, y: input.moveY * scale };
}

function createZombies(seed: string, count: number): HyosanZombieDefinition[] {
  const random = seededRng(seed);
  return Array.from({ length: count }, (_, index) => ({
    id: `student-zombie-${String(index + 1).padStart(2, '0')}`,
    x: Math.round((ROOM.left + 70 + random() * (ROOM.right - ROOM.left - 140)) * 1000) / 1000,
    y: Math.round((ROOM.top + 70 + random() * 280) * 1000) / 1000,
    health: 3,
    speed: 1.15,
  }));
}

function distanceSquared(first: HyosanPoint, second: HyosanPoint): number {
  const x = first.x - second.x;
  const y = first.y - second.y;
  return x * x + y * y;
}

function normalizedDirection(from: HyosanPoint, to: HyosanPoint): HyosanPoint {
  const x = to.x - from.x;
  const y = to.y - from.y;
  const length = Math.hypot(x, y);
  return length === 0 ? { x: 1, y: 0 } : { x: x / length, y: y / length };
}

export function createHyosanSimulation(options: HyosanSimulationOptions): HyosanSimulation {
  const definitions = options.encounter?.zombies ?? createZombies(options.seed, options.zombieCount ?? 24);
  const zombies = definitions.map((zombie) => ({ ...zombie, defeated: false }));
  const zombieCount = zombies.length;
  const player = { ...(options.encounter?.player ?? { x: 640, y: 580 }), health: 5 };
  const events: HyosanSimulationEvent[] = [
    { step: 0, type: 'room_locked', zombieCount },
    ...zombies.map((zombie) => ({
      step: 0 as const,
      type: 'zombie_spawned' as const,
      zombieId: zombie.id,
      x: zombie.x,
      y: zombie.y,
    })),
  ];
  let currentStep = 0;
  let combo: 1 | 2 | 3 = 1;
  let lastAttackStep = Number.NEGATIVE_INFINITY;
  let facing = { x: 1, y: 0 };
  let dashDirection = { x: 1, y: 0 };
  let dashUntilStep = Number.NEGATIVE_INFINITY;
  let invulnerableUntilStep = Number.NEGATIVE_INFINITY;
  let dashCooldownUntilStep = Number.NEGATIVE_INFINITY;
  let lastPlayerHitStep = Number.NEGATIVE_INFINITY;
  let roomLocked = zombieCount > 0;
  let roomCleared = zombieCount === 0;
  let roomStarted = false;
  let roomExited = false;

  return {
    step(input) {
      currentStep += 1;
      const playerCanAct = player.health > 0 && !roomExited;
      roomStarted ||= playerCanAct && (
        input.moveX !== 0
        || input.moveY !== 0
        || input.attackPressed
        || input.skillPressed
        || input.dashPressed
      );
      const movement = normalizeMovement(playerCanAct ? input : EMPTY_HYOSAN_INPUT);
      if (movement.x !== 0 || movement.y !== 0) facing = movement;

      if (playerCanAct && input.dashPressed && currentStep > dashCooldownUntilStep) {
        dashDirection = { ...facing };
        dashUntilStep = currentStep + DASH_DURATION_STEPS - 1;
        invulnerableUntilStep = currentStep + DASH_INVULNERABLE_STEPS - 1;
        dashCooldownUntilStep = currentStep + DASH_COOLDOWN_STEPS - 1;
        events.push({
          step: currentStep,
          type: 'player_dashed',
          directionX: dashDirection.x,
          directionY: dashDirection.y,
        });
      }

      const dashing = currentStep <= dashUntilStep;
      const travel = dashing ? dashDirection : movement;
      const speed = dashing ? DASH_SPEED_PER_STEP : PLAYER_SPEED_PER_STEP;
      const nextX = player.x + travel.x * speed;
      const nextY = player.y + travel.y * speed;
      const enteringExit = !roomLocked
        && nextX >= HYOSAN_EXIT_BOUNDS.left
        && nextX <= HYOSAN_EXIT_BOUNDS.right
        && (player.y < ROOM.top || nextY < ROOM.top);
      if (enteringExit) {
        player.x = clamp(nextX, HYOSAN_EXIT_BOUNDS.left, HYOSAN_EXIT_BOUNDS.right);
        player.y = clamp(nextY, HYOSAN_EXIT_BOUNDS.top, ROOM.bottom);
      } else {
        player.x = clamp(nextX, ROOM.left, ROOM.right);
        player.y = clamp(nextY, ROOM.top, ROOM.bottom);
      }

      if (roomCleared && !roomExited && player.y <= HYOSAN_EXIT_BOUNDS.completeY) {
        roomExited = true;
        events.push({ step: currentStep, type: 'room_exited' });
      }

      if (roomStarted && player.health > 0) {
        for (const zombie of zombies.toSorted((first, second) => first.id.localeCompare(second.id))) {
          if (zombie.defeated || zombie.speed === 0) continue;
          const direction = normalizedDirection(zombie, player);
          zombie.x = clamp(zombie.x + direction.x * zombie.speed, ROOM.left, ROOM.right);
          zombie.y = clamp(zombie.y + direction.y * zombie.speed, ROOM.top, ROOM.bottom);
        }
      }

      if (playerCanAct && input.attackPressed && currentStep - lastAttackStep >= ATTACK_COOLDOWN_STEPS) {
        combo = currentStep - lastAttackStep <= COMBO_WINDOW_STEPS
          ? (combo === 3 ? 1 : (combo + 1) as 1 | 2 | 3)
          : 1;
        lastAttackStep = currentStep;

        const nearest = zombies
          .filter((zombie) => !zombie.defeated)
          .toSorted((first, second) => {
            const distanceDifference = distanceSquared(player, first) - distanceSquared(player, second);
            return distanceDifference === 0 ? first.id.localeCompare(second.id) : distanceDifference;
          })[0];
        if (nearest && distanceSquared(player, nearest) <= ATTACK_RANGE * ATTACK_RANGE) {
          facing = normalizedDirection(player, nearest);
        }

        events.push({
          step: currentStep,
          type: 'player_attack',
          combo,
          directionX: facing.x,
          directionY: facing.y,
        });

        const damage = COMBO_DAMAGE[combo - 1];
        for (const zombie of zombies.toSorted((first, second) => first.id.localeCompare(second.id))) {
          if (zombie.defeated || distanceSquared(player, zombie) > ATTACK_RANGE * ATTACK_RANGE) continue;
          const direction = normalizedDirection(player, zombie);
          if (direction.x * facing.x + direction.y * facing.y < 0.45) continue;
          zombie.health = Math.max(0, zombie.health - damage);
          events.push({
            step: currentStep,
            type: 'zombie_hit',
            zombieId: zombie.id,
            combo,
            damage,
          });
          if (zombie.health === 0) {
            zombie.defeated = true;
            events.push({ step: currentStep, type: 'zombie_defeated', zombieId: zombie.id });
          }
        }

        if (roomLocked && zombies.every((zombie) => zombie.defeated)) {
          roomLocked = false;
          roomCleared = true;
          events.push({ step: currentStep, type: 'room_cleared' });
          events.push({ step: currentStep, type: 'room_unlocked' });
        }
      }
      if (playerCanAct && input.skillPressed) events.push({ step: currentStep, type: 'skill_used' });

      if (
        roomStarted
        && player.health > 0
        && currentStep > invulnerableUntilStep
        && currentStep - lastPlayerHitStep >= CONTACT_DAMAGE_COOLDOWN_STEPS
      ) {
        const touchingZombie = zombies
          .filter((zombie) => !zombie.defeated && distanceSquared(player, zombie) <= CONTACT_RANGE * CONTACT_RANGE)
          .toSorted((first, second) => first.id.localeCompare(second.id))[0];
        if (touchingZombie) {
          player.health = Math.max(0, player.health - 1);
          lastPlayerHitStep = currentStep;
          events.push({
            step: currentStep,
            type: 'player_hit',
            zombieId: touchingZombie.id,
            damage: 1,
          });
          if (player.health === 0) events.push({ step: currentStep, type: 'player_defeated' });
        }
      }
    },

    getSnapshot() {
      return {
        step: currentStep,
        elapsedMs: currentStep * HYOSAN_FIXED_TIMESTEP_MS,
        player: {
          ...player,
          facingX: facing.x,
          facingY: facing.y,
          dashing: currentStep <= dashUntilStep,
          invulnerable: currentStep <= invulnerableUntilStep,
          defeated: player.health === 0,
        },
        zombies: zombies.map((zombie) => ({ ...zombie })),
        room: {
          locked: roomLocked,
          cleared: roomCleared,
          started: roomStarted,
          exited: roomExited,
        },
      };
    },

    getEventLog() {
      return events.map((event) => ({ ...event }));
    },

    getEventsSince(index) {
      return events.slice(Math.max(0, index)).map((event) => ({ ...event }));
    },
  };
}
