import type {
  EnemyDefinition,
  VersionedPack,
  WeaponDefinition,
} from '../engine/types';

export const CONTENT_PACK_SCHEMA_VERSION = 1;

export const PROVENANCE_CLASSES = [
  'vs-official-reference',
  'ip-official-canon',
  'ip-official-episode',
  'ip-official-localized',
  'rights-approved-proposal',
  'licensed-collab-only',
  'secondary-unverified',
  'design-proposal',
  'original-game-design',
  'generated-original',
] as const;

export type ProvenanceClass = (typeof PROVENANCE_CLASSES)[number];

export interface ProvenanceRecord {
  class: ProvenanceClass;
  sourceId: string;
  sourceUrl: string;
  sourceNote: string;
  reviewedAt: string;
  reviewer: string;
  originalDesignNotes: string;
}

export type TextReviewStatus =
  | 'internal-placeholder'
  | 'reviewed-prototype'
  | 'release-ready';

export interface ProvenancedText {
  text: string;
  status: TextReviewStatus;
  provenance: ProvenanceRecord[];
}

export type BehaviorKind =
  | 'projectile'
  | 'orbit'
  | 'aura'
  | 'chain'
  | 'pierce'
  | 'status'
  | 'summon';

export type TargetPolicy =
  | 'facing'
  | 'nearest'
  | 'nearest-cluster'
  | 'radial'
  | 'random-visible';

export interface BehaviorBlock {
  kind: BehaviorKind;
  target: TargetPolicy;
  pattern: string;
  statusId?: string;
}

export interface CombatTuning {
  cooldownTicks: number;
  damage: number;
  amount: number;
  area: number;
  speedPerTick: number;
  durationTicks: number;
  pierce: number;
  chainTargets: number;
  knockback: number;
}

export interface ActiveLevelDefinition {
  level: number;
  tuning: CombatTuning;
  effect: ProvenancedText;
}

export interface ActiveContentDefinition {
  id: string;
  name: ProvenancedText;
  description: ProvenancedText;
  behavior: BehaviorBlock[];
  levels: ActiveLevelDefinition[];
  assetIds: string[];
  designProvenance: ProvenanceRecord[];
}

export type PassiveStat =
  | 'might'
  | 'armor'
  | 'maxHealth'
  | 'moveSpeed'
  | 'cooldown'
  | 'area'
  | 'duration'
  | 'pickupRadius';

export interface PassiveModifier {
  stat: PassiveStat;
  value: number;
}

export interface PassiveLevelDefinition {
  level: number;
  modifiers: PassiveModifier[];
  effect: ProvenancedText;
}

export interface PassiveContentDefinition {
  id: string;
  name: ProvenancedText;
  description: ProvenancedText;
  levels: PassiveLevelDefinition[];
  assetIds: string[];
  designProvenance: ProvenanceRecord[];
}

export interface EvolutionRecipe {
  activeId: string;
  passiveId: string;
  activeLevel: number;
  passiveMinLevel: number;
  requiresEvolutionChest: boolean;
}

export interface EvolutionContentDefinition {
  id: string;
  name: ProvenancedText;
  description: ProvenancedText;
  recipe: EvolutionRecipe;
  behavior: BehaviorBlock[];
  tuning: CombatTuning;
  effect: ProvenancedText;
  assetIds: string[];
  designProvenance: ProvenanceRecord[];
}

export interface CharacterContentDefinition {
  id: string;
  name: ProvenancedText;
  description: ProvenancedText;
  startingActiveId: string;
  stats: {
    maxHp: number;
    moveSpeedPerTick: number;
    pickupRadius: number;
    armor: number;
    might: number;
  };
  spriteAssetId: string;
  portraitAssetId: string;
  designProvenance: ProvenanceRecord[];
}

export type EnemyAiKind =
  | 'chase'
  | 'charge'
  | 'strafe'
  | 'ranged-orbit'
  | 'boss-pattern';

export interface EnemyContentDefinition {
  id: string;
  name: ProvenancedText;
  description: ProvenancedText;
  ai: {
    kind: EnemyAiKind;
    preferredRange: number;
    decisionIntervalTicks: number;
  };
  engine: EnemyDefinition;
  spriteAssetId: string;
  designProvenance: ProvenanceRecord[];
}

export interface BossContentDefinition {
  id: string;
  enemyId: string;
  name: ProvenancedText;
  description: ProvenancedText;
  intro: ProvenancedText;
  targetFightTicks: { minimum: number; maximum: number };
  designProvenance: ProvenanceRecord[];
}

export type TimelineEntry =
  | {
      kind: 'wave';
      id: string;
      atTick: number;
      untilTick: number;
      cadenceTicks: number;
      budget: number;
      enemyIds: string[];
    }
  | { kind: 'midboss'; id: string; atTick: number; bossId: string }
  | { kind: 'final-boss-transition'; id: string; atTick: number; bossId: string };

export interface AssetManifestEntry {
  id: string;
  kind: 'sprite' | 'portrait' | 'icon' | 'vfx' | 'sfx' | 'bgm' | 'cutin';
  uri: string;
  status: 'planned' | 'generated' | 'reviewed';
  contentHash: string | null;
  provenance: ProvenanceRecord[];
}

export const MOCK_REWARD_KINDS = [
  'digital_mock',
  'purchase_access_mock',
  'physical_goods_candidate_mock',
] as const;

export type MockRewardKind = (typeof MOCK_REWARD_KINDS)[number];

export type MockRewardReviewStatus = 'not_required' | 'manual_review';

export type MockRewardCondition =
  | { kind: 'score'; minimum: number }
  | { kind: 'midboss'; bossId: string }
  | { kind: 'final-boss'; bossId: string; purchaseWindowHours: number }
  | {
      kind: 'speedrun';
      bossId: string;
      provisionalTopN: number;
      reviewWindowHours: number;
      claimWindowDays: number;
      unclaimedPolicy: 'next-ranked';
      shippingPayer: 'operator';
    };

export interface MockRewardRule {
  id: string;
  rewardKind: MockRewardKind;
  condition: MockRewardCondition;
  provisional: boolean;
  reviewStatus: MockRewardReviewStatus;
  label: ProvenancedText;
  notice: ProvenancedText;
}

export type MockRewardProgram = readonly MockRewardRule[];

export interface ContentPack extends VersionedPack {
  schemaVersion: typeof CONTENT_PACK_SCHEMA_VERSION;
  id: string;
  lifecycle: 'internal-prototype';
  physicalRewardsEnabled: false;
  simulation: {
    ticksPerSecond: 60;
    stageDurationTicks: number;
    bossFightBudgetTicks: number;
  };
  slotRules: {
    activeLimit: number;
    passiveLimit: number;
    activeMaxLevel: number;
    passiveMaxLevel: number;
  };
  characters: CharacterContentDefinition[];
  actives: ActiveContentDefinition[];
  passives: PassiveContentDefinition[];
  evolutions: EvolutionContentDefinition[];
  enemyArchetypes: EnemyContentDefinition[];
  bossContent: {
    midbosses: BossContentDefinition[];
    finalBoss: BossContentDefinition;
  };
  timeline: TimelineEntry[];
  spawnLevelScaling?: Array<{
    minimumPlayerLevel: number;
    cadenceScale: number;
    budgetScale: number;
  }>;
  xpCurve: {
    maxLevel: number;
    base: number;
    linear: number;
    quadraticNumerator: number;
    quadraticDenominator: number;
  };
  chestRules: {
    evolutionSources: string[];
    preferEligibleRecipe: boolean;
    fallback: 'upgrade-owned';
  };
  theme: {
    title: ProvenancedText;
    stageName: ProvenancedText;
    clearCopy: ProvenancedText;
    lossCopy: ProvenancedText;
    colors: {
      background: string;
      ground: string;
      accent: string;
      danger: string;
      experience: string;
    };
  };
  assets: AssetManifestEntry[];
  mockRewards: MockRewardRule[];
}

export function toEngineWeapon(tuning: CombatTuning): WeaponDefinition {
  return {
    cooldownTicks: tuning.cooldownTicks,
    damage: tuning.damage,
    projectileSpeedPerTick: tuning.speedPerTick,
    projectileTtlTicks: tuning.durationTicks,
    hitRadius: Math.max(1, Math.round(tuning.area / 2)),
  };
}
