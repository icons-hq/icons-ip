export const SIMULATION_HZ = 60;
export const REPLAY_SCHEMA_VERSION = 1 as const;

export type RunState =
  | 'RUNNING'
  | 'LEVEL_UP'
  | 'CHEST'
  | 'FINAL_TRANSITION'
  | 'FINAL_BOSS'
  | 'PAUSED'
  | 'RESULTS_CLEAR'
  | 'RESULTS_LOSS';

export interface WeaponDefinition {
  cooldownTicks: number;
  damage: number;
  projectileSpeedPerTick: number;
  projectileTtlTicks: number;
  hitRadius: number;
}

export interface EnemyDefinition {
  maxHp: number;
  moveSpeedPerTick: number;
  contactDamage: number;
  contactRadius: number;
  scoreValue: number;
  dropXp: number;
}

export interface WaveDefinition {
  tick: number;
  enemyId: string;
  count: number;
  x?: number;
  y?: number;
}

export interface UpgradeDefinition {
  id: string;
  damageDelta?: number;
  cooldownDeltaTicks?: number;
  heal?: number;
}

export interface BossDefinition {
  id: string;
  enemyId: string;
  spawnTick: number;
  killBonus: number;
  x?: number;
  y?: number;
}

/** Immutable balance/content input pinned into a replay header by version. */
export interface VersionedPack {
  engineVersion: string;
  contentVersion: string;
  maxTicks: number;
  world: { width: number; height: number };
  player: {
    startX: number;
    startY: number;
    maxHp: number;
    moveSpeedPerTick: number;
    pickupRadius: number;
    weaponId: string;
  };
  weapons: Record<string, WeaponDefinition>;
  enemies: Record<string, EnemyDefinition>;
  waves: WaveDefinition[];
  level: {
    xpThresholds: number[];
    offerCount: number;
    upgrades: UpgradeDefinition[];
  };
  midbosses: BossDefinition[];
  finalBoss: BossDefinition | null;
  scoring: {
    speedBonusBase: number;
    speedBonusPerTick: number;
    clearBonus: number;
    noHitBonus: number;
  };
}

/** Quantized user intent; derived combat events never enter the authority log. */
export type RecordedCommand =
  | { tick: number; type: 'move'; x: number; y: number }
  | { tick: number; type: 'choose-level-offer'; offerIndex: number }
  | { tick: number; type: 'resolve-chest'; choiceIndex: number }
  | { tick: number; type: 'pause' }
  | { tick: number; type: 'resume' }
  | { tick: number; type: 'continue-final-transition' };

/** Commands plus the last tick observed by the recording runtime. */
export interface RecordedRun {
  commands: RecordedCommand[];
  recordedThroughTick: number;
}

export interface BossMilestone {
  id: string;
  kind: 'MID_BOSS' | 'FINAL_BOSS';
  spawnTick: number;
  killTick: number | null;
}

export interface BuildItemSnapshot {
  id: string;
  name: string;
  level: number;
  maxLevel: number;
  evolvedInto: string | null;
}

export interface ChestSnapshot {
  sourceBossId: string;
  eligibleEvolutionIds: string[];
  fallbackItemIds: string[];
}

/** Runtime-facing canonical summary derived entirely from the simulation. */
export interface RunResult {
  state: RunState;
  simulationHz: typeof SIMULATION_HZ;
  completionTicks: number;
  stageTicks: number;
  bossFightTicks: number;
  rawScore: number;
  kills: number;
  bossSplitTicks: number | null;
  bosses: BossMilestone[];
  player: {
    x: number;
    y: number;
    hp: number;
    maxHp: number;
    level: number;
    xp: number;
  };
  world: {
    enemies: number;
    projectiles: number;
    pickups: number;
  };
  build: {
    actives: BuildItemSnapshot[];
    passives: BuildItemSnapshot[];
    evolutions: BuildItemSnapshot[];
  };
  weaponDamage: Record<string, number>;
  pendingLevelOffer: {
    offeredAtTick: number;
    options: string[];
  } | null;
  pendingChest: ChestSnapshot | null;
}

/** Public seam output: canonical result plus digest of the complete final state. */
export interface ReplayHeader {
  replaySchemaVersion: typeof REPLAY_SCHEMA_VERSION;
  engineVersion: string;
  contentPackId: string;
  contentVersion: string;
  contentHash: string;
  seed: string;
  simulationHz: typeof SIMULATION_HZ;
  prngAlgorithmVersion: string;
}

export interface ReplayOutcome {
  header: ReplayHeader;
  status: ReplayStatus;
  result: RunResult;
  stateDigest: string;
}

export type ReplayStatus = 'TERMINAL' | 'BLOCKED' | 'INCOMPLETE';
