import type {
  CombatTuning,
  ContentPack,
} from '../packs/types';
import {
  SIMULATION_HZ,
  type BuildItemSnapshot,
  type ChestSnapshot,
  type RecordedCommand,
  type RecordedRun,
  type RunResult,
} from './types';
import { createNamespacedRng, type NamespacedRng } from './prng';

export type { BuildItemSnapshot, ChestSnapshot } from './types';

export const RUNTIME_HZ = SIMULATION_HZ;

export type RuntimeMode =
  | 'READY'
  | 'RUNNING'
  | 'LEVEL_UP'
  | 'CHEST'
  | 'FINAL_TRANSITION'
  | 'FINAL_BOSS'
  | 'RESULT_CLEAR'
  | 'RESULT_LOSS'
  | 'PAUSED';

export interface MoveIntent {
  x: number;
  y: number;
}

export interface RuntimeEntitySnapshot {
  id: number;
  x: number;
  y: number;
  radius: number;
}

export interface PlayerSnapshot extends RuntimeEntitySnapshot {
  hp: number;
  maxHp: number;
  level: number;
  xp: number;
  xpToNext: number | null;
  facingX: number;
  facingY: number;
  invulnerableTicks: number;
}

export type EnemyRole = 'NORMAL' | 'MID_BOSS' | 'FINAL_BOSS';

export interface EnemySnapshot extends RuntimeEntitySnapshot {
  enemyId: string;
  role: EnemyRole;
  hp: number;
  maxHp: number;
}

export type ProjectileKind =
  | 'CLEAVE'
  | 'PROJECTILE'
  | 'ORBIT'
  | 'HEAVY_PROJECTILE'
  | 'CHAIN'
  | 'AURA';

export interface ProjectileSnapshot extends RuntimeEntitySnapshot {
  weaponId: string;
  kind: ProjectileKind;
  rotation: number;
  ttlTicks: number;
}

export interface PickupSnapshot extends RuntimeEntitySnapshot {
  kind: 'XP' | 'CHEST';
  value: number;
}

export interface VfxSnapshot extends RuntimeEntitySnapshot {
  kind: 'HIT' | 'SLASH' | 'CHAIN' | 'LEVEL_UP' | 'CHEST' | 'BOSS_WARNING';
  weaponId: string | null;
  ttlTicks: number;
}

export interface LevelOfferSnapshot {
  id: string;
  kind: 'ACTIVE' | 'PASSIVE';
  name: string;
  description: string;
  currentLevel: number;
  nextLevel: number;
  newSlot: boolean;
}

export interface BossScoreSnapshot {
  id: string;
  role: 'MID_BOSS' | 'FINAL_BOSS';
  spawnTick: number;
  killTick: number | null;
  killBonus: number;
}

export interface RuntimeScoreSnapshot {
  rawScore: number;
  kills: number;
  bossSplitTicks: number | null;
  bosses: BossScoreSnapshot[];
  weaponDamage: Record<string, number>;
}

export interface RuntimeDebugSnapshot {
  active: boolean;
  invincible: boolean;
  timeScale: 1 | 2 | 4 | 8;
}

export interface RuntimeSnapshot {
  seed: string;
  mode: RuntimeMode;
  tick: number;
  stageTick: number;
  bossFightTicks: number;
  player: PlayerSnapshot;
  enemies: EnemySnapshot[];
  projectiles: ProjectileSnapshot[];
  pickups: PickupSnapshot[];
  vfx: VfxSnapshot[];
  offers: LevelOfferSnapshot[];
  chest: ChestSnapshot | null;
  build: {
    actives: BuildItemSnapshot[];
    passives: BuildItemSnapshot[];
    evolutions: BuildItemSnapshot[];
  };
  score: RuntimeScoreSnapshot;
  debug: RuntimeDebugSnapshot;
  metrics: {
    enemyCount: number;
    projectileCount: number;
    pickupCount: number;
  };
}

export interface RuntimeDebugOptions {
  invincible?: boolean;
  timeScale?: 1 | 2 | 4 | 8;
}

export interface InteractiveRuntime {
  start(): RuntimeSnapshot;
  /** Advances one 60Hz tick, or the configured fixed number of debug time-scale ticks. */
  step(intent?: MoveIntent): RuntimeSnapshot;
  chooseOffer(index: number): RuntimeSnapshot;
  resolveChest(choiceIndex?: number): RuntimeSnapshot;
  togglePause(): RuntimeSnapshot;
  continueFinalTransition(): RuntimeSnapshot;
  setDebug(options: RuntimeDebugOptions): RuntimeSnapshot;
  /** Forward-only jump. Skipped waves and bosses grant no score, drops, or milestones. */
  debugJumpToStageTick(tick: number): RuntimeSnapshot;
  debugGrantXp(amount: number): RuntimeSnapshot;
  debugSpawnChest(sourceBossId?: string): RuntimeSnapshot;
  debugDamageEnemy(enemyInstanceId: number, amount: number): RuntimeSnapshot;
  /** Creates a bounded synthetic load scene without making a leaderboard-eligible run. */
  debugPopulateStress(enemyCount?: number, projectileCount?: number): RuntimeSnapshot;
  getSnapshot(): RuntimeSnapshot;
  getRecordedCommands(): RecordedCommand[];
  getRecordedRun(): RecordedRun;
  getRunResult(): RunResult;
  /** Canonical headless driver used by replay; it owns all mode transition rules. */
  advanceReplay(
    commandsAtCurrentTick: readonly RecordedCommand[],
    allowStep?: boolean,
  ): ReplayAdvanceStatus;
  getDeterministicState(): unknown;
}

export type ReplayAdvanceStatus = 'ADVANCED' | 'BLOCKED' | 'TERMINAL' | 'INCOMPLETE';

export interface InteractiveRuntimeOptions {
  /** Replay creates a non-recording session and applies the supplied log explicitly. */
  recordCommands?: boolean;
}

type OwnedItem = { id: string; level: number; evolvedInto: string | null };
type ProjectileState = ProjectileSnapshot & {
  vx: number;
  vy: number;
  damage: number;
  remainingHits: number;
  hitEnemyIds: Set<number>;
  orbitAngle: number;
  orbitDistance: number;
};
type PickupState = PickupSnapshot & { sourceBossId: string | null };

const COLLISION_CELL_SIZE = 2_000;
const INPUT_PRECISION = 1_000;
const WORLD_PRECISION = 1_024;
const ANGLE_PRECISION = 1_000_000;

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
}

function quantize(value: number, precision: number): number {
  return Math.round(value * precision) / precision;
}

function quantizeWorld(value: number): number {
  return quantize(value, WORLD_PRECISION);
}

function quantizeAngle(value: number): number {
  return quantize(value, ANGLE_PRECISION);
}

function distanceSquared(leftX: number, leftY: number, rightX: number, rightY: number): number {
  return (leftX - rightX) ** 2 + (leftY - rightY) ** 2;
}

function quantizeAxis(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.round(clamp(value, -1, 1) * INPUT_PRECISION) / INPUT_PRECISION;
}

function quantizeIntent(intent: MoveIntent): MoveIntent {
  return { x: quantizeAxis(intent.x), y: quantizeAxis(intent.y) };
}

function sameIntent(left: MoveIntent, right: MoveIntent): boolean {
  return left.x === right.x && left.y === right.y;
}

function projectileKindFor(
  pack: ContentPack,
  activeId: string,
  tuning: CombatTuning,
): ProjectileKind {
  const active = pack.actives.find((candidate) => candidate.id === activeId);
  const kinds = new Set(active?.behavior.map((block) => block.kind) ?? []);
  if (kinds.has('orbit')) return 'ORBIT';
  if (kinds.has('chain')) return 'CHAIN';
  if (kinds.has('aura') || kinds.has('status') || kinds.has('summon')) return 'AURA';
  if (kinds.has('pierce')) return tuning.speedPerTick <= 1 ? 'CLEAVE' : 'HEAVY_PROJECTILE';
  return 'PROJECTILE';
}

function runtimeModeToRunState(mode: RuntimeMode): RunResult['state'] {
  // Preserve the existing UI mode API while emitting the spec's RESULTS_* result states.
  if (mode === 'RESULT_CLEAR') return 'RESULTS_CLEAR';
  if (mode === 'RESULT_LOSS') return 'RESULTS_LOSS';
  if (mode === 'READY') return 'RUNNING';
  return mode;
}

export function normalizeRecordedCommands(
  commands: readonly RecordedCommand[],
): RecordedCommand[] {
  return commands
    .map((command) => (
      command.type === 'move'
        ? { ...command, x: quantizeAxis(command.x), y: quantizeAxis(command.y) }
        : { ...command }
    ))
    .filter((command) => Number.isSafeInteger(command.tick) && command.tick >= 0)
    .sort((left, right) => left.tick - right.tick);
}

class ContentPackRuntime implements InteractiveRuntime {
  private readonly pack: ContentPack;
  private readonly seed: string;
  private readonly offerRandom: NamespacedRng;
  private readonly spawnRandom: NamespacedRng;
  private readonly weaponRandom: NamespacedRng;
  private readonly dropRandom: NamespacedRng;
  private readonly recordCommands: boolean;
  private readonly commands: RecordedCommand[] = [];
  private currentIntent: MoveIntent = { x: 0, y: 0 };
  private mode: RuntimeMode = 'READY';
  private resumeMode: 'RUNNING' | 'FINAL_BOSS' = 'RUNNING';
  private tick = 0;
  private stageTick = 0;
  private bossFightTicks = 0;
  private player: PlayerSnapshot;
  private enemies: EnemySnapshot[] = [];
  private projectiles: ProjectileState[] = [];
  private pickups: PickupState[] = [];
  private vfx: VfxSnapshot[] = [];
  private offers: LevelOfferSnapshot[] = [];
  private chest: ChestSnapshot | null = null;
  private actives: OwnedItem[] = [];
  private passives: OwnedItem[] = [];
  private evolutions: OwnedItem[] = [];
  private score = 0;
  private kills = 0;
  private weaponDamage: Record<string, number> = {};
  private bosses: BossScoreSnapshot[] = [];
  private bossSplitTicks: number | null = null;
  private debug: RuntimeDebugSnapshot = { active: false, invincible: false, timeScale: 1 };
  private nextEntityId = 1;
  private spawnedMidbossIds = new Set<string>();
  private weaponCooldowns: Record<string, number> = {};
  private finalTransitionPending = false;
  private playerWasHit = false;

  constructor(pack: ContentPack, seed: string, options: InteractiveRuntimeOptions = {}) {
    this.pack = pack;
    this.seed = seed;
    this.recordCommands = options.recordCommands ?? true;
    this.offerRandom = createNamespacedRng(seed, 'offer');
    this.spawnRandom = createNamespacedRng(seed, 'spawn');
    this.weaponRandom = createNamespacedRng(seed, 'weapon');
    this.dropRandom = createNamespacedRng(seed, 'drop');
    this.actives = [{ id: pack.player.weaponId, level: 1, evolvedInto: null }];
    const character = this.pack.characters[0]!;
    this.player = {
      id: 0,
      x: this.pack.player.startX,
      y: this.pack.player.startY,
      radius: 250,
      hp: character.stats.maxHp,
      maxHp: character.stats.maxHp,
      level: 1,
      xp: 0,
      xpToNext: this.pack.level.xpThresholds[0] ?? null,
      facingX: 0,
      facingY: 1,
      invulnerableTicks: 0,
    };
  }

  start() {
    if (this.mode === 'READY') this.mode = 'RUNNING';
    return this.getSnapshot();
  }

  step(intent: MoveIntent = this.currentIntent) {
    if (this.mode !== 'RUNNING' && this.mode !== 'FINAL_BOSS') return this.getSnapshot();
    const quantized = quantizeIntent(intent);
    if (!sameIntent(quantized, this.currentIntent)) {
      this.currentIntent = quantized;
      this.record({ tick: this.tick, type: 'move', ...quantized });
    }
    const steps = this.debug.timeScale;
    for (let count = 0; count < steps; count += 1) {
      if (this.mode !== 'RUNNING' && this.mode !== 'FINAL_BOSS') break;
      this.simulateTick(this.currentIntent);
    }
    return this.getSnapshot();
  }

  chooseOffer(index: number) {
    if (this.mode !== 'LEVEL_UP') return this.getSnapshot();
    const offer = this.offers[index];
    if (!offer) return this.getSnapshot();
    this.record({ tick: this.tick, type: 'choose-level-offer', offerIndex: index });
    const collection = offer.kind === 'ACTIVE' ? this.actives : this.passives;
    const owned = collection.find((item) => item.id === offer.id);
    if (owned) owned.level = offer.nextLevel;
    else collection.push({ id: offer.id, level: 1, evolvedInto: null });
    this.offers = [];
    this.resumeAfterModal();
    return this.getSnapshot();
  }

  resolveChest(choiceIndex = 0) {
    if (this.mode !== 'CHEST' || !this.chest) return this.getSnapshot();
    const selectedIndex = Math.max(0, Math.floor(choiceIndex));
    const availableIds = this.chest.eligibleEvolutionIds.length > 0
      ? this.chest.eligibleEvolutionIds
      : this.chest.fallbackItemIds;
    if (!availableIds[selectedIndex]) return this.getSnapshot();
    this.record({ tick: this.tick, type: 'resolve-chest', choiceIndex: selectedIndex });
    const evolutionId = this.chest.eligibleEvolutionIds[selectedIndex];
    if (evolutionId) {
      const evolution = this.pack.evolutions.find((candidate) => candidate.id === evolutionId);
      const active = evolution
        ? this.actives.find((item) => item.id === evolution.recipe.activeId)
        : undefined;
      if (evolution && active && !active.evolvedInto) {
        active.evolvedInto = evolution.id;
        this.evolutions.push({ id: evolution.id, level: 1, evolvedInto: null });
      }
    } else {
      const fallbackId = this.chest.fallbackItemIds[selectedIndex];
      const active = this.actives.find((item) => item.id === fallbackId);
      const passive = this.passives.find((item) => item.id === fallbackId);
      if (active) active.level = Math.min(this.pack.slotRules.activeMaxLevel, active.level + 1);
      if (passive) passive.level = Math.min(this.pack.slotRules.passiveMaxLevel, passive.level + 1);
    }
    this.chest = null;
    this.resumeAfterModal();
    return this.getSnapshot();
  }

  togglePause() {
    if (this.mode === 'PAUSED') {
      this.record({ tick: this.tick, type: 'resume' });
      this.mode = this.resumeMode;
    }
    else if (this.mode === 'RUNNING' || this.mode === 'FINAL_BOSS') {
      this.record({ tick: this.tick, type: 'pause' });
      this.resumeMode = this.mode;
      this.mode = 'PAUSED';
    }
    return this.getSnapshot();
  }

  continueFinalTransition() {
    if (this.mode !== 'FINAL_TRANSITION') return this.getSnapshot();
    this.record({ tick: this.tick, type: 'continue-final-transition' });
    this.mode = 'FINAL_BOSS';
    this.resumeMode = 'FINAL_BOSS';
    const boss = this.pack.finalBoss;
    if (boss) {
      this.spawnEnemy(
        boss.enemyId,
        'FINAL_BOSS',
        boss.x ?? this.player.x + 5_500,
        boss.y ?? this.player.y,
      );
      this.bosses.push({
        id: boss.id,
        role: 'FINAL_BOSS',
        spawnTick: this.tick,
        killTick: null,
        killBonus: boss.killBonus,
      });
    }
    return this.getSnapshot();
  }

  setDebug(options: RuntimeDebugOptions) {
    this.debug = {
      active: true,
      invincible: options.invincible ?? this.debug.invincible,
      timeScale: options.timeScale ?? this.debug.timeScale,
    };
    return this.getSnapshot();
  }

  debugJumpToStageTick(tick: number) {
    this.debug.active = true;
    const target = clamp(
      Math.max(this.stageTick, Math.floor(tick)),
      0,
      this.pack.simulation.stageDurationTicks,
    );
    this.tick += Math.max(0, target - this.stageTick);
    this.stageTick = target;
    for (const entry of this.pack.timeline) {
      if (entry.kind === 'midboss' && entry.atTick < target) {
        this.spawnedMidbossIds.add(entry.bossId);
      }
    }
    return this.getSnapshot();
  }

  debugGrantXp(amount: number) {
    this.debug.active = true;
    this.player.xp += Math.max(0, Math.floor(amount));
    this.maybeOpenLevelOffer();
    return this.getSnapshot();
  }

  debugSpawnChest(sourceBossId?: string) {
    this.debug.active = true;
    this.chest = this.createChest(sourceBossId ?? this.pack.midbosses[0]?.id ?? 'debug-chest');
    this.resumeMode = this.mode === 'FINAL_BOSS' ? 'FINAL_BOSS' : 'RUNNING';
    this.mode = 'CHEST';
    return this.getSnapshot();
  }

  debugDamageEnemy(enemyInstanceId: number, amount: number) {
    this.debug.active = true;
    const enemy = this.enemies.find((candidate) => candidate.id === enemyInstanceId);
    if (enemy) this.damageEnemy(enemy, Math.max(0, amount), null, true);
    return this.getSnapshot();
  }

  debugPopulateStress(enemyCount = 1_000, projectileCount = 1_500) {
    this.debug = { ...this.debug, active: true, invincible: true };
    this.enemies = [];
    this.projectiles = [];
    const enemyIds = this.pack.enemyArchetypes.map((enemy) => enemy.id);
    const boundedEnemyCount = Math.min(1_000, Math.max(0, Math.floor(enemyCount)));
    const boundedProjectileCount = Math.min(1_500, Math.max(0, Math.floor(projectileCount)));
    for (let index = 0; index < boundedEnemyCount; index += 1) {
      const angle = index * 2.399963229728653;
      const distance = 1_800 + (index % 37) * 145;
      this.spawnEnemy(
        enemyIds[index % enemyIds.length]!,
        'NORMAL',
        this.player.x + Math.cos(angle) * distance,
        this.player.y + Math.sin(angle) * distance,
      );
    }

    for (let index = 0; index < boundedProjectileCount; index += 1) {
      const active = this.pack.actives[index % this.pack.actives.length]!;
      const weaponId = active.id;
      const kind = projectileKindFor(this.pack, active.id, active.levels[0]!.tuning);
      const angle = index * 0.31;
      const distance = 260 + (index % 23) * 38;
      this.projectiles.push({
        id: this.nextEntityId++,
        weaponId,
        kind,
        x: this.player.x + Math.cos(angle) * distance,
        y: this.player.y + Math.sin(angle) * distance,
        radius: 110,
        rotation: angle,
        ttlTicks: 3_600,
        vx: Math.cos(angle) * 12,
        vy: Math.sin(angle) * 12,
        damage: 0,
        remainingHits: boundedEnemyCount + 1,
        hitEnemyIds: new Set<number>(),
        orbitAngle: angle,
        orbitDistance: distance,
      });
    }
    return this.getSnapshot();
  }

  getSnapshot(): RuntimeSnapshot {
    return {
      seed: this.seed,
      mode: this.mode,
      tick: this.tick,
      stageTick: this.stageTick,
      bossFightTicks: this.bossFightTicks,
      player: { ...this.player },
      enemies: this.enemies.map((enemy) => ({ ...enemy })),
      projectiles: this.projectiles.map((projectile) => ({
        id: projectile.id,
        weaponId: projectile.weaponId,
        kind: projectile.kind,
        x: projectile.x,
        y: projectile.y,
        radius: projectile.radius,
        rotation: projectile.rotation,
        ttlTicks: projectile.ttlTicks,
      })),
      pickups: this.pickups.map((pickup) => ({
        id: pickup.id,
        kind: pickup.kind,
        x: pickup.x,
        y: pickup.y,
        radius: pickup.radius,
        value: pickup.value,
      })),
      vfx: this.vfx.map((effect) => ({ ...effect })),
      offers: this.offers.map((offer) => ({ ...offer })),
      chest: this.chest ? { ...this.chest, eligibleEvolutionIds: [...this.chest.eligibleEvolutionIds], fallbackItemIds: [...this.chest.fallbackItemIds] } : null,
      build: {
        actives: this.actives.map((item) => this.buildItem(item, 'ACTIVE')),
        passives: this.passives.map((item) => this.buildItem(item, 'PASSIVE')),
        evolutions: this.evolutions.map((item) => this.buildEvolution(item)),
      },
      score: {
        rawScore: this.score,
        kills: this.kills,
        bossSplitTicks: this.bossSplitTicks,
        bosses: this.bosses.map((boss) => ({ ...boss })),
        weaponDamage: { ...this.weaponDamage },
      },
      debug: { ...this.debug },
      metrics: {
        enemyCount: this.enemies.length,
        projectileCount: this.projectiles.length,
        pickupCount: this.pickups.length,
      },
    };
  }

  getRecordedCommands(): RecordedCommand[] {
    return this.commands.map((command) => ({ ...command }));
  }

  getRecordedRun(): RecordedRun {
    return {
      commands: this.getRecordedCommands(),
      recordedThroughTick: this.tick + (this.mode === 'RESULT_CLEAR' ? 1 : 0),
    };
  }

  getRunResult(): RunResult {
    const snapshot = this.getSnapshot();
    const build = {
      actives: snapshot.build.actives.map((item) => ({ ...item })),
      passives: snapshot.build.passives.map((item) => ({ ...item })),
      evolutions: snapshot.build.evolutions.map((item) => ({ ...item })),
    };

    return {
      state: runtimeModeToRunState(snapshot.mode),
      simulationHz: RUNTIME_HZ,
      completionTicks: snapshot.tick,
      stageTicks: snapshot.stageTick,
      bossFightTicks: snapshot.bossFightTicks,
      rawScore: snapshot.score.rawScore,
      kills: snapshot.score.kills,
      bossSplitTicks: snapshot.score.bossSplitTicks,
      bosses: snapshot.score.bosses.map((boss) => ({
        id: boss.id,
        kind: boss.role === 'MID_BOSS' ? 'MID_BOSS' : 'FINAL_BOSS',
        spawnTick: boss.spawnTick,
        killTick: boss.killTick,
      })),
      player: {
        x: snapshot.player.x,
        y: snapshot.player.y,
        hp: snapshot.player.hp,
        maxHp: snapshot.player.maxHp,
        level: snapshot.player.level,
        xp: snapshot.player.xp,
      },
      world: {
        enemies: snapshot.metrics.enemyCount,
        projectiles: snapshot.metrics.projectileCount,
        pickups: snapshot.metrics.pickupCount,
      },
      build,
      weaponDamage: { ...snapshot.score.weaponDamage },
      pendingLevelOffer: snapshot.mode === 'LEVEL_UP'
        ? { offeredAtTick: snapshot.tick, options: snapshot.offers.map((offer) => offer.id) }
        : null,
      pendingChest: snapshot.chest
        ? {
            sourceBossId: snapshot.chest.sourceBossId,
            eligibleEvolutionIds: [...snapshot.chest.eligibleEvolutionIds],
            fallbackItemIds: [...snapshot.chest.fallbackItemIds],
          }
        : null,
    };
  }

  private applyRecordedCommand(command: RecordedCommand): boolean {
    if (command.tick !== this.tick) return false;
    if (command.type === 'move') {
      this.currentIntent = quantizeIntent(command);
      return true;
    }
    if (command.type === 'choose-level-offer') {
      if (this.mode !== 'LEVEL_UP' || !this.offers[command.offerIndex]) return false;
      this.chooseOffer(command.offerIndex);
      return true;
    }
    if (command.type === 'resolve-chest') {
      if (this.mode !== 'CHEST' || !this.chest) return false;
      const availableIds = this.chest.eligibleEvolutionIds.length > 0
        ? this.chest.eligibleEvolutionIds
        : this.chest.fallbackItemIds;
      if (!availableIds[command.choiceIndex]) return false;
      this.resolveChest(command.choiceIndex);
      return true;
    }
    if (command.type === 'pause') {
      if (this.mode !== 'RUNNING' && this.mode !== 'FINAL_BOSS') return false;
      this.togglePause();
      return true;
    }
    if (command.type === 'resume') {
      if (this.mode !== 'PAUSED') return false;
      this.togglePause();
      return true;
    }
    if (this.mode !== 'FINAL_TRANSITION') return false;
    this.continueFinalTransition();
    return true;
  }

  advanceReplay(
    commandsAtCurrentTick: readonly RecordedCommand[],
    allowStep = true,
  ): ReplayAdvanceStatus {
    for (const command of commandsAtCurrentTick) this.applyRecordedCommand(command);
    if (this.mode === 'RESULT_CLEAR' || this.mode === 'RESULT_LOSS') return 'TERMINAL';
    if (this.mode !== 'RUNNING' && this.mode !== 'FINAL_BOSS') return 'BLOCKED';
    if (!allowStep) return 'INCOMPLETE';
    this.step();
    const modeAfterStep: RuntimeMode = this.getSnapshot().mode;
    return modeAfterStep === 'RESULT_CLEAR' || modeAfterStep === 'RESULT_LOSS'
      ? 'TERMINAL'
      : 'ADVANCED';
  }

  getDeterministicState(): unknown {
    return {
      snapshot: this.getSnapshot(),
      resumeMode: this.resumeMode,
      currentIntent: { ...this.currentIntent },
      nextEntityId: this.nextEntityId,
      spawnedMidbossIds: [...this.spawnedMidbossIds].sort(),
      weaponCooldowns: { ...this.weaponCooldowns },
      finalTransitionPending: this.finalTransitionPending,
      playerWasHit: this.playerWasHit,
      rng: {
        offer: this.offerRandom.state(),
        spawn: this.spawnRandom.state(),
        weapon: this.weaponRandom.state(),
        drop: this.dropRandom.state(),
      },
      projectiles: this.projectiles.map((projectile) => ({
        ...projectile,
        hitEnemyIds: [...projectile.hitEnemyIds].sort((left, right) => left - right),
      })),
      pickups: this.pickups.map((pickup) => ({ ...pickup })),
    };
  }

  private record(command: RecordedCommand) {
    if (this.recordCommands) this.commands.push(command);
  }

  private maybeOpenLevelOffer() {
    if (this.mode === 'LEVEL_UP' || this.player.level >= this.pack.xpCurve.maxLevel) return;
    const threshold = this.pack.level.xpThresholds[this.player.level - 1];
    if (threshold === undefined || this.player.xp < threshold) return;
    this.player.xp -= threshold;
    this.player.level += 1;
    this.player.xpToNext = this.pack.level.xpThresholds[this.player.level - 1] ?? null;
    this.resumeMode = this.mode === 'FINAL_BOSS' ? 'FINAL_BOSS' : 'RUNNING';
    this.offers = this.createOffers();
    if (this.offers.length > 0) this.mode = 'LEVEL_UP';
  }

  private resumeAfterModal() {
    this.mode = this.resumeMode;
    this.refreshPlayerStats();
    this.maybeOpenLevelOffer();
    if (this.offers.length === 0) this.enterFinalTransition();
  }

  private refreshPlayerStats() {
    const priorMaxHp = this.player.maxHp;
    const ratio = priorMaxHp > 0 ? this.player.hp / priorMaxHp : 1;
    const maxHealthBonus = this.passives.reduce((total, owned) => {
      const definition = this.pack.passives.find((passive) => passive.id === owned.id);
      const level = definition?.levels[owned.level - 1];
      return total + (level?.modifiers
        .filter((modifier) => modifier.stat === 'maxHealth')
        .reduce((sum, modifier) => sum + modifier.value, 0) ?? 0);
    }, 0);
    this.player.maxHp = Math.round(this.pack.player.maxHp * (1 + maxHealthBonus));
    this.player.hp = Math.max(1, Math.min(this.player.maxHp, Math.round(this.player.maxHp * ratio)));
  }

  private createOffers() {
    const candidates: LevelOfferSnapshot[] = [];
    for (const active of this.pack.actives) {
      const owned = this.actives.find((item) => item.id === active.id);
      if (owned?.evolvedInto || (owned && owned.level >= this.pack.slotRules.activeMaxLevel)) continue;
      if (!owned && this.actives.length >= this.pack.slotRules.activeLimit) continue;
      candidates.push({
        id: active.id,
        kind: 'ACTIVE',
        name: active.name.text,
        description: active.description.text,
        currentLevel: owned?.level ?? 0,
        nextLevel: (owned?.level ?? 0) + 1,
        newSlot: !owned,
      });
    }
    for (const passive of this.pack.passives) {
      const owned = this.passives.find((item) => item.id === passive.id);
      if (owned && owned.level >= this.pack.slotRules.passiveMaxLevel) continue;
      if (!owned && this.passives.length >= this.pack.slotRules.passiveLimit) continue;
      candidates.push({
        id: passive.id,
        kind: 'PASSIVE',
        name: passive.name.text,
        description: passive.description.text,
        currentLevel: owned?.level ?? 0,
        nextLevel: (owned?.level ?? 0) + 1,
        newSlot: !owned,
      });
    }
    for (let index = candidates.length - 1; index > 0; index -= 1) {
      const other = Math.floor(this.offerRandom.nextFloat() * (index + 1));
      [candidates[index], candidates[other]] = [candidates[other]!, candidates[index]!];
    }
    return candidates.slice(0, this.pack.level.offerCount);
  }

  private simulateTick(intent: MoveIntent) {
    const phase = this.mode;
    if (phase === 'RUNNING') this.spawnScheduledEncounters();
    this.movePlayer(intent);
    this.moveEnemies();
    if (this.player.hp === 0) {
      this.tick += 1;
      if (phase === 'RUNNING') {
        this.stageTick = Math.min(this.pack.simulation.stageDurationTicks, this.stageTick + 1);
      }
      else this.bossFightTicks += 1;
      return;
    }
    this.fireAutomaticWeapons();
    this.updateProjectiles();
    if (this.mode === 'RESULT_CLEAR') return;
    this.updatePickups();
    this.updateVfx();
    if (this.player.invulnerableTicks > 0) this.player.invulnerableTicks -= 1;

    this.tick += 1;
    if (phase === 'RUNNING') {
      this.stageTick = Math.min(
        this.pack.simulation.stageDurationTicks,
        this.stageTick + 1,
      );
      if (this.stageTick === this.pack.simulation.stageDurationTicks) {
        this.prepareFinalTransition();
      }
    } else if (phase === 'FINAL_BOSS') {
      this.bossFightTicks += 1;
    }
  }

  private movePlayer(intent: MoveIntent) {
    const length = Math.hypot(intent.x, intent.y);
    if (length <= 0) return;
    const x = quantizeAngle(clamp(intent.x / length, -1, 1));
    const y = quantizeAngle(clamp(intent.y / length, -1, 1));
    const moveSpeed = this.pack.player.moveSpeedPerTick * this.passiveFactor('moveSpeed');
    this.player.facingX = x;
    this.player.facingY = y;
    this.player.x = quantizeWorld(clamp(
      this.player.x + x * moveSpeed,
      this.player.radius,
      this.pack.world.width - this.player.radius,
    ));
    this.player.y = quantizeWorld(clamp(
      this.player.y + y * moveSpeed,
      this.player.radius,
      this.pack.world.height - this.player.radius,
    ));
  }

  private moveEnemies() {
    for (const enemy of this.enemies) {
      if (enemy.hp <= 0) continue;
      const definition = this.pack.enemies[enemy.enemyId];
      if (!definition) continue;
      const content = this.pack.enemyArchetypes.find((item) => item.id === enemy.enemyId);
      let dx = this.player.x - enemy.x;
      let dy = this.player.y - enemy.y;
      const squaredDistanceToPlayer = dx * dx + dy * dy;
      const distance = Math.max(1, Math.sqrt(squaredDistanceToPlayer));
      dx /= distance;
      dy /= distance;
      if (content?.ai.kind === 'strafe') {
        const direction = enemy.id % 2 === 0 ? 1 : -1;
        const forwardX = dx;
        dx = dx * 0.7 - dy * 0.7 * direction;
        dy = dy * 0.7 + forwardX * 0.7 * direction;
      } else if (
        content?.ai.kind === 'ranged-orbit'
        && squaredDistanceToPlayer < content.ai.preferredRange ** 2
      ) {
        dx = -dx * 0.35 - dy;
        dy = -dy * 0.35 + (this.player.x - enemy.x) / distance;
      } else if (content?.ai.kind === 'charge' && this.tick % content.ai.decisionIntervalTicks < 18) {
        dx *= 1.8;
        dy *= 1.8;
      } else if (enemy.role !== 'NORMAL') {
        const sway = Math.sin((this.tick + enemy.id * 17) / 45) * 0.35;
        const forwardX = dx;
        dx -= dy * sway;
        dy += forwardX * sway;
      }
      enemy.x = quantizeWorld(clamp(
        enemy.x + dx * definition.moveSpeedPerTick,
        enemy.radius,
        this.pack.world.width - enemy.radius,
      ));
      enemy.y = quantizeWorld(clamp(
        enemy.y + dy * definition.moveSpeedPerTick,
        enemy.radius,
        this.pack.world.height - enemy.radius,
      ));

      if (
        !this.debug.invincible
        && this.player.invulnerableTicks === 0
        && distanceSquared(enemy.x, enemy.y, this.player.x, this.player.y)
          <= (enemy.radius + this.player.radius) ** 2
      ) {
        const armor = this.passiveFlat('armor');
        this.player.hp = Math.max(0, this.player.hp - Math.max(1, definition.contactDamage - armor));
        this.playerWasHit = true;
        this.player.invulnerableTicks = 30;
        if (this.player.hp === 0) {
          this.mode = 'RESULT_LOSS';
          return;
        }
      }
    }
  }

  private fireAutomaticWeapons() {
    const cooldownFactor = Math.max(0.35, this.passiveFactor('cooldown'));
    for (const active of this.actives) {
      const weaponId = active.evolvedInto ?? active.id;
      const remaining = (this.weaponCooldowns[weaponId] ?? 0) - 1;
      if (remaining > 0) {
        this.weaponCooldowns[weaponId] = remaining;
        continue;
      }
      const evolution = active.evolvedInto
        ? this.pack.evolutions.find((item) => item.id === active.evolvedInto)
        : null;
      const definition = this.pack.actives.find((item) => item.id === active.id);
      const tuning = evolution?.tuning ?? definition?.levels[active.level - 1]?.tuning;
      if (!tuning) continue;
      this.weaponCooldowns[weaponId] = Math.max(5, Math.round(tuning.cooldownTicks * cooldownFactor));
      this.fireWeapon(active.id, weaponId, tuning);
    }
  }

  private fireWeapon(
    baseActiveId: string,
    weaponId: string,
    tuning: CombatTuning,
  ) {
    const kind = projectileKindFor(this.pack, baseActiveId, tuning);
    const might = this.passiveFactor('might');
    const area = this.passiveFactor('area');
    const duration = this.passiveFactor('duration');
    const nearest = this.nearestEnemies(this.player.x, this.player.y, 12_000, 8);
    const primary = kind === 'HEAVY_PROJECTILE'
      ? [...nearest].sort((left, right) => right.hp - left.hp || left.id - right.id)[0]
      : nearest[0];
    const baseAngle = quantizeAngle(primary
      ? Math.atan2(primary.y - this.player.y, primary.x - this.player.x)
      : Math.atan2(this.player.facingY, this.player.facingX));
    const amount = Math.max(1, Math.round(tuning.amount));
    for (let index = 0; index < amount; index += 1) {
      if (this.projectiles.length >= 1_500) break;
      const spread = amount === 1 ? 0 : (index - (amount - 1) / 2) * 0.16;
      const angle = quantizeAngle(baseAngle + spread);
      const isStationary = kind === 'CLEAVE' || kind === 'CHAIN' || kind === 'AURA' || kind === 'ORBIT';
      const target = kind === 'CHAIN' ? nearest[index % Math.max(1, nearest.length)] : null;
      const radius = quantizeWorld(Math.max(90, tuning.area * area / 2));
      const x = quantizeWorld(target?.x ?? (
        kind === 'CLEAVE'
          ? this.player.x + Math.cos(angle) * radius * 0.65
          : this.player.x
      ));
      const y = quantizeWorld(target?.y ?? (
        kind === 'CLEAVE'
          ? this.player.y + Math.sin(angle) * radius * 0.65
          : this.player.y
      ));
      this.projectiles.push({
        id: this.nextEntityId++,
        weaponId,
        kind,
        x,
        y,
        radius,
        rotation: angle,
        ttlTicks: Math.max(2, Math.round(tuning.durationTicks * duration)),
        vx: isStationary ? 0 : quantizeWorld(Math.cos(angle) * tuning.speedPerTick),
        vy: isStationary ? 0 : quantizeWorld(Math.sin(angle) * tuning.speedPerTick),
        damage: Math.max(1, Math.round(tuning.damage * might)),
        remainingHits: kind === 'CHAIN'
          ? Math.max(1, tuning.chainTargets + 1)
          : Math.max(1, tuning.pierce),
        hitEnemyIds: new Set<number>(),
        orbitAngle: quantizeAngle(
          this.weaponRandom.nextFloat() * Math.PI * 2 + index * Math.PI * 2 / amount,
        ),
        orbitDistance: quantizeWorld(650 + index * 80),
      });
    }
    this.vfx.push({
      id: this.nextEntityId++,
      kind: kind === 'CHAIN' ? 'CHAIN' : 'SLASH',
      weaponId,
      x: this.player.x,
      y: this.player.y,
      radius: Math.max(240, tuning.area / 2),
      ttlTicks: 10,
    });
  }

  private updateProjectiles() {
    const buckets = this.buildEnemyBuckets();
    for (const projectile of this.projectiles) {
      projectile.ttlTicks -= 1;
      if (projectile.kind === 'ORBIT') {
        projectile.orbitAngle = quantizeAngle(projectile.orbitAngle + 0.075);
        projectile.x = quantizeWorld(
          this.player.x + Math.cos(projectile.orbitAngle) * projectile.orbitDistance,
        );
        projectile.y = quantizeWorld(
          this.player.y + Math.sin(projectile.orbitAngle) * projectile.orbitDistance,
        );
        projectile.rotation = quantizeAngle(projectile.orbitAngle + Math.PI / 2);
      } else if (projectile.kind === 'AURA') {
        projectile.x = this.player.x;
        projectile.y = this.player.y;
        projectile.rotation = quantizeAngle(projectile.rotation + 0.035);
      } else {
        projectile.x = quantizeWorld(projectile.x + projectile.vx);
        projectile.y = quantizeWorld(projectile.y + projectile.vy);
      }
      const candidates = this.queryBuckets(
        buckets,
        projectile.x,
        projectile.y,
        projectile.radius + 700,
      );
      for (const enemy of candidates) {
        if (enemy.hp <= 0 || projectile.hitEnemyIds.has(enemy.id)) continue;
        if (
          distanceSquared(enemy.x, enemy.y, projectile.x, projectile.y)
            > (enemy.radius + projectile.radius) ** 2
        ) continue;
        projectile.hitEnemyIds.add(enemy.id);
        projectile.remainingHits -= 1;
        this.damageEnemy(enemy, projectile.damage, projectile.weaponId, this.debug.invincible);
        this.vfx.push({
          id: this.nextEntityId++,
          kind: 'HIT',
          weaponId: projectile.weaponId,
          x: enemy.x,
          y: enemy.y,
          radius: Math.min(420, projectile.radius),
          ttlTicks: 8,
        });
        if (projectile.remainingHits <= 0) break;
      }
    }
    this.projectiles = this.projectiles.filter((projectile) => (
      projectile.ttlTicks > 0
      && projectile.remainingHits > 0
      && projectile.x > -2_000
      && projectile.y > -2_000
      && projectile.x < this.pack.world.width + 2_000
      && projectile.y < this.pack.world.height + 2_000
    ));
  }

  private updatePickups() {
    const pickupRadius = this.pack.player.pickupRadius * this.passiveFactor('pickupRadius');
    const remaining: PickupState[] = [];
    for (let index = 0; index < this.pickups.length; index += 1) {
      const pickup = this.pickups[index]!;
      const dx = this.player.x - pickup.x;
      const dy = this.player.y - pickup.y;
      const squaredDistance = dx * dx + dy * dy;
      const distance = Math.max(1, Math.sqrt(squaredDistance));
      if (pickup.kind === 'XP' && squaredDistance < (pickupRadius * 2) ** 2) {
        const speed = Math.min(360, 90 + (pickupRadius * 2 - distance) * 0.08);
        pickup.x = quantizeWorld(pickup.x + dx / distance * speed);
        pickup.y = quantizeWorld(pickup.y + dy / distance * speed);
      }
      if (
        distanceSquared(this.player.x, this.player.y, pickup.x, pickup.y)
          <= (this.player.radius + pickup.radius) ** 2
      ) {
        if (pickup.kind === 'XP') {
          this.player.xp += pickup.value;
          this.maybeOpenLevelOffer();
        } else {
          this.resumeMode = this.mode === 'FINAL_BOSS' ? 'FINAL_BOSS' : 'RUNNING';
          this.chest = this.createChest(pickup.sourceBossId ?? 'unknown-midboss');
          this.mode = 'CHEST';
        }
        if (this.mode === 'LEVEL_UP' || this.mode === 'CHEST') {
          remaining.push(...this.pickups.slice(index + 1));
          break;
        }
      } else {
        remaining.push(pickup);
      }
    }
    this.pickups = remaining;
  }

  private updateVfx() {
    for (const effect of this.vfx) effect.ttlTicks -= 1;
    this.vfx = this.vfx.filter((effect) => effect.ttlTicks > 0);
  }

  private prepareFinalTransition() {
    this.enemies = this.enemies.filter((enemy) => enemy.role !== 'NORMAL');
    this.pickups = this.pickups.filter((pickup) => pickup.kind !== 'XP');
    this.projectiles = [];
    this.finalTransitionPending = true;
    if (this.mode === 'LEVEL_UP' || this.mode === 'CHEST') return;
    this.enterFinalTransition();
  }

  private enterFinalTransition() {
    if (!this.finalTransitionPending) return;
    this.finalTransitionPending = false;
    this.mode = 'FINAL_TRANSITION';
    this.resumeMode = 'FINAL_BOSS';
    this.vfx.push({
      id: this.nextEntityId++,
      kind: 'BOSS_WARNING',
      weaponId: null,
      x: this.player.x,
      y: this.player.y,
      radius: 3_000,
      ttlTicks: 90,
    });
  }

  private passiveFactor(stat: 'might' | 'moveSpeed' | 'cooldown' | 'area' | 'duration' | 'pickupRadius') {
    return 1 + this.passiveFlat(stat);
  }

  private passiveFlat(stat: 'might' | 'armor' | 'moveSpeed' | 'cooldown' | 'area' | 'duration' | 'pickupRadius') {
    let value = 0;
    for (const owned of this.passives) {
      const definition = this.pack.passives.find((passive) => passive.id === owned.id);
      const level = definition?.levels[owned.level - 1];
      value += level?.modifiers
        .filter((modifier) => modifier.stat === stat)
        .reduce((sum, modifier) => sum + modifier.value, 0) ?? 0;
    }
    return value;
  }

  private nearestEnemies(x: number, y: number, radius: number, limit: number) {
    return this.queryBuckets(this.buildEnemyBuckets(), x, y, radius)
      .filter((enemy) => enemy.hp > 0)
      .map((enemy) => ({ enemy, distance: (enemy.x - x) ** 2 + (enemy.y - y) ** 2 }))
      .filter((candidate) => candidate.distance <= radius ** 2)
      .sort((left, right) => left.distance - right.distance || left.enemy.id - right.enemy.id)
      .slice(0, limit)
      .map((candidate) => candidate.enemy);
  }

  private buildEnemyBuckets() {
    const buckets = new Map<string, EnemySnapshot[]>();
    for (const enemy of this.enemies) {
      const key = this.bucketKey(enemy.x, enemy.y);
      const bucket = buckets.get(key);
      if (bucket) bucket.push(enemy);
      else buckets.set(key, [enemy]);
    }
    return buckets;
  }

  private queryBuckets(
    buckets: Map<string, EnemySnapshot[]>,
    x: number,
    y: number,
    radius: number,
  ) {
    const found: EnemySnapshot[] = [];
    const seen = new Set<number>();
    const minimumX = Math.floor((x - radius) / COLLISION_CELL_SIZE);
    const maximumX = Math.floor((x + radius) / COLLISION_CELL_SIZE);
    const minimumY = Math.floor((y - radius) / COLLISION_CELL_SIZE);
    const maximumY = Math.floor((y + radius) / COLLISION_CELL_SIZE);
    for (let cellY = minimumY; cellY <= maximumY; cellY += 1) {
      for (let cellX = minimumX; cellX <= maximumX; cellX += 1) {
        for (const enemy of buckets.get(`${cellX}:${cellY}`) ?? []) {
          if (!seen.has(enemy.id)) {
            seen.add(enemy.id);
            found.push(enemy);
          }
        }
      }
    }
    return found;
  }

  private bucketKey(x: number, y: number) {
    return `${Math.floor(x / COLLISION_CELL_SIZE)}:${Math.floor(y / COLLISION_CELL_SIZE)}`;
  }

  private spawnScheduledEncounters() {
    for (const entry of this.pack.timeline) {
      if (entry.kind === 'wave') {
        if (
          this.stageTick >= entry.atTick
          && this.stageTick < entry.untilTick
          && (this.stageTick - entry.atTick) % entry.cadenceTicks === 0
        ) {
          const available = Math.max(0, 220 - this.enemies.length);
          const count = Math.min(available, Math.max(1, Math.ceil(entry.budget / 8)));
          for (let index = 0; index < count; index += 1) {
            const enemyId = entry.enemyIds[Math.floor(this.spawnRandom.nextFloat() * entry.enemyIds.length)]!;
            this.spawnEnemy(enemyId, 'NORMAL');
          }
        }
      } else if (
        entry.kind === 'midboss'
        && this.stageTick + 1 >= entry.atTick
        && !this.spawnedMidbossIds.has(entry.bossId)
      ) {
        const boss = this.pack.midbosses.find((candidate) => candidate.id === entry.bossId);
        if (boss) {
          this.spawnedMidbossIds.add(entry.bossId);
          this.spawnEnemy(boss.enemyId, 'MID_BOSS', boss.x, boss.y);
          this.bosses.push({
            id: boss.id,
            role: 'MID_BOSS',
            spawnTick: entry.atTick,
            killTick: null,
            killBonus: boss.killBonus,
          });
        }
      }
    }
  }

  private spawnEnemy(enemyId: string, role: EnemyRole, x?: number, y?: number) {
    const definition = this.pack.enemies[enemyId];
    if (!definition) return;
    const angle = quantizeAngle(this.spawnRandom.nextFloat() * Math.PI * 2);
    const distance = quantizeWorld(
      role === 'NORMAL' ? 5_000 + this.spawnRandom.nextFloat() * 2_500 : 5_500,
    );
    this.enemies.push({
      id: this.nextEntityId++,
      enemyId,
      role,
      x: quantizeWorld(clamp(
        x ?? this.player.x + Math.cos(angle) * distance,
        300,
        this.pack.world.width - 300,
      )),
      y: quantizeWorld(clamp(
        y ?? this.player.y + Math.sin(angle) * distance,
        300,
        this.pack.world.height - 300,
      )),
      radius: Math.max(170, definition.contactRadius),
      hp: definition.maxHp,
      maxHp: definition.maxHp,
    });
  }

  private damageEnemy(
    enemy: EnemySnapshot,
    amount: number,
    weaponId: string | null,
    debugDamage = false,
  ) {
    const applied = Math.max(0, Math.min(enemy.hp, amount));
    enemy.hp -= applied;
    if (weaponId && applied > 0) {
      this.weaponDamage[weaponId] = (this.weaponDamage[weaponId] ?? 0) + applied;
    }
    if (enemy.hp > 0) return;

    this.enemies = this.enemies.filter((candidate) => candidate.id !== enemy.id);
    const definition = this.pack.enemies[enemy.enemyId];
    if (!debugDamage) {
      this.kills += 1;
      this.score += definition?.scoreValue ?? 0;
    }

    if (enemy.role === 'NORMAL') {
      if (!debugDamage && definition && definition.dropXp > 0) {
        this.pickups.push({
          id: this.nextEntityId++,
          kind: 'XP',
          x: quantizeWorld(enemy.x + (this.dropRandom.nextFloat() - 0.5) * 120),
          y: quantizeWorld(enemy.y + (this.dropRandom.nextFloat() - 0.5) * 120),
          radius: 100,
          value: definition.dropXp,
          sourceBossId: null,
        });
      }
      return;
    }

    const milestone = this.bosses.find((boss) => (
      boss.killTick === null
      && boss.role === enemy.role
      && (enemy.role === 'FINAL_BOSS'
        || this.pack.midbosses.find((candidate) => candidate.id === boss.id)?.enemyId === enemy.enemyId)
    ));
    if (milestone) {
      milestone.killTick = Math.max(this.tick, milestone.spawnTick);
      if (!debugDamage) this.score += milestone.killBonus;
    }

    if (enemy.role === 'MID_BOSS') {
      if (!debugDamage && milestone) {
        this.pickups.push({
          id: this.nextEntityId++,
          kind: 'CHEST',
          x: enemy.x,
          y: enemy.y,
          radius: 150,
          value: 1,
          sourceBossId: milestone.id,
        });
      }
      return;
    }

    this.bossSplitTicks = milestone
      ? Math.max(0, milestone.killTick! - milestone.spawnTick)
      : this.bossFightTicks;
    if (!debugDamage) {
      this.score += Math.max(
        0,
        this.pack.scoring.speedBonusBase
          - this.bossSplitTicks * this.pack.scoring.speedBonusPerTick,
      );
      this.score += this.pack.scoring.clearBonus;
      if (!this.playerWasHit) this.score += this.pack.scoring.noHitBonus;
    }
    this.mode = 'RESULT_CLEAR';
  }

  private createChest(sourceBossId: string): ChestSnapshot {
    const eligibleEvolutionIds = this.pack.evolutions
      .filter((evolution) => {
        const active = this.actives.find((item) => item.id === evolution.recipe.activeId);
        const passive = this.passives.find((item) => item.id === evolution.recipe.passiveId);
        return Boolean(
          active
          && !active.evolvedInto
          && active.level >= evolution.recipe.activeLevel
          && passive
          && passive.level >= evolution.recipe.passiveMinLevel,
        );
      })
      .map((evolution) => evolution.id);
    const fallbackItemIds = [
      ...this.actives
        .filter((item) => !item.evolvedInto && item.level < this.pack.slotRules.activeMaxLevel)
        .map((item) => item.id),
      ...this.passives
        .filter((item) => item.level < this.pack.slotRules.passiveMaxLevel)
        .map((item) => item.id),
    ];
    return { sourceBossId, eligibleEvolutionIds, fallbackItemIds };
  }

  private buildItem(item: OwnedItem, kind: 'ACTIVE' | 'PASSIVE'): BuildItemSnapshot {
    const definition = kind === 'ACTIVE'
      ? this.pack.actives.find((active) => active.id === item.id)
      : this.pack.passives.find((passive) => passive.id === item.id);
    return {
      id: item.id,
      name: definition?.name.text ?? item.id,
      level: item.level,
      maxLevel: kind === 'ACTIVE' ? this.pack.slotRules.activeMaxLevel : this.pack.slotRules.passiveMaxLevel,
      evolvedInto: item.evolvedInto,
    };
  }

  private buildEvolution(item: OwnedItem): BuildItemSnapshot {
    const definition = this.pack.evolutions.find((evolution) => evolution.id === item.id);
    return {
      id: item.id,
      name: definition?.name.text ?? item.id,
      level: 1,
      maxLevel: 1,
      evolvedInto: null,
    };
  }
}

export function createInteractiveRuntime(
  pack: ContentPack,
  seed: number | string,
  options: InteractiveRuntimeOptions = {},
): InteractiveRuntime {
  return new ContentPackRuntime(pack, String(seed), options);
}
