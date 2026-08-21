import type { BossDefinition, EnemyDefinition, WaveDefinition } from '../engine/types';
import {
  activeLevels,
  buildXpThresholds,
  copy,
  passiveLevels,
  provenance,
} from './builders';
import {
  CONTENT_PACK_SCHEMA_VERSION,
  toEngineWeapon,
  type ActiveContentDefinition,
  type AssetManifestEntry,
  type CombatTuning,
  type ContentPack,
  type EnemyContentDefinition,
  type EvolutionContentDefinition,
  type PassiveContentDefinition,
  type TimelineEntry,
} from './types';

const ticks = (seconds: number) => seconds * 60;
const fixtureDesign = provenance(
  'original-game-design',
  'geometric-engine-fixture-v1',
  'design://geometric-engine-fixture/v1',
  '공용 엔진 경계를 검증하기 위한 무IP 도형 콘텐츠다.',
  '모든 이름, 수치, 패턴은 이 자동 테스트 팩을 위해 작성했다.',
);
const fixtureAsset = provenance(
  'generated-original',
  'geometric-engine-fixture-assets-v1',
  'asset://geometric-engine-fixture/provenance/v1',
  '런타임 기본 도형으로 생성하는 테스트 전용 벡터 슬롯이다.',
  '외부 또는 IP 에셋을 사용하지 않는다.',
);
const text = (value: string) => copy(value, [fixtureDesign]);

function tuning(values: Partial<CombatTuning>): CombatTuning {
  return {
    cooldownTicks: 60,
    damage: 10,
    amount: 1,
    area: 240,
    speedPerTick: 240,
    durationTicks: 60,
    pierce: 1,
    chainTargets: 0,
    knockback: 10,
    ...values,
  };
}

const activeSeeds = [
  { id: 'line-beam', name: '직선 광선', kind: 'projectile' as const, target: 'facing' as const, pattern: 'thin-line', base: tuning({ cooldownTicks: 36, damage: 17, area: 180, speedPerTick: 620, durationTicks: 44, pierce: 3 }), delta: { cooldownTicks: -2, damage: 6, area: 20, pierce: 1 } },
  { id: 'orbiting-dot', name: '회전 점', kind: 'orbit' as const, target: 'radial' as const, pattern: 'single-orbit', base: tuning({ cooldownTicks: 72, damage: 12, amount: 2, area: 210, speedPerTick: 170, durationTicks: 180 }), delta: { cooldownTicks: -3, damage: 5, amount: 0.5, durationTicks: 18 } },
  { id: 'pulse-ring', name: '파동 고리', kind: 'aura' as const, target: 'radial' as const, pattern: 'expanding-ring', base: tuning({ cooldownTicks: 94, damage: 25, area: 390, speedPerTick: 160, durationTicks: 48, pierce: 5 }), delta: { cooldownTicks: -4, damage: 8, area: 35, pierce: 1 } },
  { id: 'chain-segment', name: '연쇄 선분', kind: 'chain' as const, target: 'nearest' as const, pattern: 'angular-chain', base: tuning({ cooldownTicks: 88, damage: 28, area: 240, chainTargets: 3 }), delta: { cooldownTicks: -4, damage: 7, chainTargets: 1 } },
  { id: 'piercing-triangle', name: '관통 삼각', kind: 'pierce' as const, target: 'nearest-cluster' as const, pattern: 'triangle-lance', base: tuning({ cooldownTicks: 108, damage: 52, area: 330, speedPerTick: 700, durationTicks: 48, pierce: 7 }), delta: { cooldownTicks: -5, damage: 14, area: 32, pierce: 1 } },
  { id: 'summoned-hexagon', name: '소환 육각', kind: 'summon' as const, target: 'random-visible' as const, pattern: 'stationary-hexagon', base: tuning({ cooldownTicks: 126, damage: 21, amount: 2, area: 300, durationTicks: 150, pierce: 3 }), delta: { cooldownTicks: -5, damage: 7, amount: 0.25, area: 28, durationTicks: 15 } },
];

const actives: ActiveContentDefinition[] = activeSeeds.map((seed) => ({
  id: seed.id,
  name: text(seed.name),
  description: text(`${seed.name} 패턴으로 자동 공격하는 도형 테스트 무기다.`),
  behavior: [{ kind: seed.kind, target: seed.target, pattern: seed.pattern }],
  levels: activeLevels(seed.name, [fixtureDesign], seed.base, seed.delta),
  assetIds: [`active-${seed.id}-icon`, `active-${seed.id}-vfx`],
  designProvenance: [fixtureDesign],
}));

const passiveSeeds = [
  { id: 'red-scale', name: '붉은 배율', levels: [[{ stat: 'might' as const, value: 0.07 }], [{ stat: 'might' as const, value: 0.1 }], [{ stat: 'might' as const, value: 0.14 }]] },
  { id: 'blue-cycle', name: '푸른 주기', levels: [[{ stat: 'cooldown' as const, value: -0.04 }], [{ stat: 'cooldown' as const, value: -0.06 }], [{ stat: 'cooldown' as const, value: -0.09 }]] },
  { id: 'green-radius', name: '초록 반경', levels: [[{ stat: 'area' as const, value: 0.08 }], [{ stat: 'area' as const, value: 0.12 }], [{ stat: 'area' as const, value: 0.17 }]] },
  { id: 'yellow-vector', name: '노랑 벡터', levels: [[{ stat: 'moveSpeed' as const, value: 0.08 }], [{ stat: 'moveSpeed' as const, value: 0.1 }], [{ stat: 'moveSpeed' as const, value: 0.14 }]] },
  { id: 'violet-duration', name: '보라 지속', levels: [[{ stat: 'duration' as const, value: 0.1 }], [{ stat: 'duration' as const, value: 0.15 }], [{ stat: 'duration' as const, value: 0.21 }]] },
  { id: 'white-shell', name: '흰 외피', levels: [[{ stat: 'armor' as const, value: 1 }], [{ stat: 'armor' as const, value: 1 }, { stat: 'maxHealth' as const, value: 0.08 }], [{ stat: 'armor' as const, value: 2 }, { stat: 'maxHealth' as const, value: 0.12 }]] },
];

const passives: PassiveContentDefinition[] = passiveSeeds.map((seed) => ({
  id: seed.id,
  name: text(seed.name),
  description: text(`${seed.name} 값으로 공용 능력치 modifier를 검증한다.`),
  levels: passiveLevels(seed.name, [fixtureDesign], seed.levels),
  assetIds: [`passive-${seed.id}-icon`],
  designProvenance: [fixtureDesign],
}));

const evolutionSeeds = [
  ['thick-line', '굵은 직선', 'line-beam', 'red-scale', 'pierce', 'facing', 'wide-line', tuning({ cooldownTicks: 24, damage: 88, amount: 2, area: 420, speedPerTick: 820, durationTicks: 60, pierce: 12 })],
  ['double-orbit', '이중 궤도', 'orbiting-dot', 'blue-cycle', 'orbit', 'radial', 'counter-rotating-orbits', tuning({ cooldownTicks: 44, damage: 42, amount: 8, area: 360, speedPerTick: 260, durationTicks: 260, pierce: 4 })],
  ['stacked-pulse', '중첩 파동', 'pulse-ring', 'green-radius', 'aura', 'radial', 'triple-ring', tuning({ cooldownTicks: 58, damage: 74, amount: 3, area: 650, speedPerTick: 220, durationTicks: 80, pierce: 10 })],
  ['branch-grid', '분기 격자', 'chain-segment', 'yellow-vector', 'chain', 'nearest-cluster', 'branching-grid', tuning({ cooldownTicks: 56, damage: 62, amount: 2, area: 420, chainTargets: 10, pierce: 3 })],
  ['infinite-triangle', '무한 삼각', 'piercing-triangle', 'violet-duration', 'pierce', 'nearest', 'recursive-triangles', tuning({ cooldownTicks: 72, damage: 180, amount: 3, area: 540, speedPerTick: 940, durationTicks: 84, pierce: 18 })],
  ['hexagon-cluster', '육각 군집', 'summoned-hexagon', 'white-shell', 'summon', 'random-visible', 'six-node-cluster', tuning({ cooldownTicks: 78, damage: 68, amount: 6, area: 520, durationTicks: 240, pierce: 8 })],
] as const;

const evolutions: EvolutionContentDefinition[] = evolutionSeeds.map(
  ([id, name, activeId, passiveId, kind, target, pattern, combat]) => ({
    id,
    name: text(name),
    description: text(`${name}은 도형 규칙만 사용하는 테스트 진화다.`),
    recipe: {
      activeId,
      passiveId,
      activeLevel: 5,
      passiveMinLevel: 1,
      requiresEvolutionChest: true,
    },
    behavior: [{ kind, target, pattern }],
    tuning: combat,
    effect: text(`${name} 진화 패턴을 실행한다.`),
    assetIds: [`evolution-${id}-icon`, `evolution-${id}-vfx`],
    designProvenance: [fixtureDesign],
  }),
);

const enemyArchetypes: EnemyContentDefinition[] = [
  { id: 'small-circle', name: text('작은 원'), description: text('일정한 속도로 중심을 쫓는다.'), ai: { kind: 'chase', preferredRange: 0, decisionIntervalTicks: 20 }, engine: { maxHp: 32, moveSpeedPerTick: 13, contactDamage: 5, contactRadius: 150, scoreValue: 40, dropXp: 3 }, spriteAssetId: 'enemy-small-circle-sprite', designProvenance: [fixtureDesign] },
  { id: 'fast-triangle', name: text('빠른 삼각형'), description: text('직선 돌진으로 위치 이동을 요구한다.'), ai: { kind: 'charge', preferredRange: 1_500, decisionIntervalTicks: 90 }, engine: { maxHp: 72, moveSpeedPerTick: 17, contactDamage: 12, contactRadius: 190, scoreValue: 92, dropXp: 6 }, spriteAssetId: 'enemy-fast-triangle-sprite', designProvenance: [fixtureDesign] },
  { id: 'heavy-square', name: text('무거운 사각형'), description: text('느리지만 넓은 접촉 영역으로 길을 막는다.'), ai: { kind: 'chase', preferredRange: 0, decisionIntervalTicks: 28 }, engine: { maxHp: 118, moveSpeedPerTick: 7, contactDamage: 18, contactRadius: 260, scoreValue: 140, dropXp: 9 }, spriteAssetId: 'enemy-heavy-square-sprite', designProvenance: [fixtureDesign] },
  { id: 'ranged-diamond', name: text('원거리 마름모'), description: text('중거리 궤도를 유지하며 접근 각도를 바꾼다.'), ai: { kind: 'ranged-orbit', preferredRange: 2_300, decisionIntervalTicks: 68 }, engine: { maxHp: 56, moveSpeedPerTick: 9, contactDamage: 9, contactRadius: 180, scoreValue: 118, dropXp: 7 }, spriteAssetId: 'enemy-ranged-diamond-sprite', designProvenance: [fixtureDesign] },
];

const bossEnemies: Record<string, EnemyDefinition> = {
  'pentagon-sentinel': { maxHp: 2_600, moveSpeedPerTick: 8, contactDamage: 22, contactRadius: 410, scoreValue: 0, dropXp: 70 },
  'octagon-collider': { maxHp: 6_100, moveSpeedPerTick: 7, contactDamage: 30, contactRadius: 480, scoreValue: 0, dropXp: 135 },
  'dodecagon-core': { maxHp: 21_000, moveSpeedPerTick: 8, contactDamage: 42, contactRadius: 610, scoreValue: 0, dropXp: 0 },
};
const midbosses: BossDefinition[] = [
  { id: 'midboss-pentagon', enemyId: 'pentagon-sentinel', spawnTick: ticks(120), killBonus: 1_400 },
  { id: 'midboss-octagon', enemyId: 'octagon-collider', spawnTick: ticks(240), killBonus: 3_000 },
];
const finalBoss: BossDefinition = {
  id: 'final-boss-dodecagon',
  enemyId: 'dodecagon-core',
  spawnTick: ticks(360),
  killBonus: 8_800,
};

const timeline: TimelineEntry[] = [
  { kind: 'wave', id: 'circles', atTick: ticks(0), untilTick: ticks(45), cadenceTicks: ticks(5), budget: 12, enemyIds: ['small-circle'] },
  { kind: 'wave', id: 'triangles', atTick: ticks(45), untilTick: ticks(90), cadenceTicks: ticks(6), budget: 18, enemyIds: ['small-circle', 'fast-triangle'] },
  { kind: 'wave', id: 'diamonds', atTick: ticks(90), untilTick: ticks(120), cadenceTicks: ticks(5), budget: 23, enemyIds: ['small-circle', 'ranged-diamond'] },
  { kind: 'midboss', id: 'pentagon', atTick: ticks(120), bossId: 'midboss-pentagon' },
  { kind: 'wave', id: 'squares', atTick: ticks(120), untilTick: ticks(195), cadenceTicks: ticks(4), budget: 31, enemyIds: ['small-circle', 'fast-triangle', 'heavy-square'] },
  { kind: 'wave', id: 'mixed-angles', atTick: ticks(195), untilTick: ticks(240), cadenceTicks: ticks(4), budget: 39, enemyIds: ['fast-triangle', 'heavy-square', 'ranged-diamond'] },
  { kind: 'wave', id: 'compression', atTick: ticks(210), untilTick: ticks(240), cadenceTicks: ticks(3), budget: 47, enemyIds: ['small-circle', 'heavy-square', 'ranged-diamond'] },
  { kind: 'midboss', id: 'octagon', atTick: ticks(240), bossId: 'midboss-octagon' },
  { kind: 'wave', id: 'all-shapes', atTick: ticks(240), untilTick: ticks(330), cadenceTicks: ticks(3), budget: 58, enemyIds: ['small-circle', 'fast-triangle', 'heavy-square', 'ranged-diamond'] },
  { kind: 'wave', id: 'dense-shapes', atTick: ticks(330), untilTick: ticks(360), cadenceTicks: ticks(2), budget: 72, enemyIds: ['small-circle', 'fast-triangle', 'heavy-square', 'ranged-diamond'] },
  { kind: 'final-boss-transition', id: 'dodecagon-transition', atTick: ticks(360), bossId: 'final-boss-dodecagon' },
];
const waves: WaveDefinition[] = [
  { tick: ticks(0), enemyId: 'small-circle', count: 10 },
  { tick: ticks(45), enemyId: 'fast-triangle', count: 6 },
  { tick: ticks(90), enemyId: 'ranged-diamond', count: 8 },
  { tick: ticks(150), enemyId: 'heavy-square', count: 10 },
  { tick: ticks(210), enemyId: 'fast-triangle', count: 18 },
  { tick: ticks(255), enemyId: 'ranged-diamond', count: 20 },
  { tick: ticks(300), enemyId: 'heavy-square', count: 24 },
  { tick: ticks(345), enemyId: 'small-circle', count: 54 },
];
const xpCurve = {
  maxLevel: 54,
  base: 7,
  linear: 4,
  quadraticNumerator: 1,
  quadraticDenominator: 6,
};

const assetSlots: Array<[string, AssetManifestEntry['kind']]> = [
  ['circle-runner-sprite', 'sprite'],
  ['circle-runner-portrait', 'portrait'],
  ...actives.flatMap((active) => [[active.assetIds[0]!, 'icon'], [active.assetIds[1]!, 'vfx']] as Array<[string, AssetManifestEntry['kind']]>),
  ...passives.map((passive) => [passive.assetIds[0]!, 'icon'] as [string, AssetManifestEntry['kind']]),
  ...evolutions.flatMap((evolution) => [[evolution.assetIds[0]!, 'icon'], [evolution.assetIds[1]!, 'vfx']] as Array<[string, AssetManifestEntry['kind']]>),
  ...enemyArchetypes.map((enemy) => [enemy.spriteAssetId, 'sprite'] as [string, AssetManifestEntry['kind']]),
  ['pentagon-sentinel-sprite', 'sprite'],
  ['octagon-collider-sprite', 'sprite'],
  ['dodecagon-core-sprite', 'sprite'],
  ['dodecagon-core-cutin', 'cutin'],
];

export const geometricTestPack = {
  schemaVersion: CONTENT_PACK_SCHEMA_VERSION,
  id: 'geometric-engine-fixture-v1',
  lifecycle: 'internal-prototype',
  physicalRewardsEnabled: false,
  engineVersion: 'survival-engine-v1',
  contentVersion: 'geometric-test-pack-v1',
  maxTicks: ticks(450),
  world: { width: 120_000, height: 80_000 },
  player: { startX: 60_000, startY: 40_000, maxHp: 120, moveSpeedPerTick: 22, pickupRadius: 900, weaponId: 'line-beam' },
  weapons: Object.fromEntries([
    ...actives.map((active) => [active.id, toEngineWeapon(active.levels[0]!.tuning)]),
    ...evolutions.map((evolution) => [evolution.id, toEngineWeapon(evolution.tuning)]),
  ]),
  enemies: { ...Object.fromEntries(enemyArchetypes.map((enemy) => [enemy.id, enemy.engine])), ...bossEnemies },
  waves,
  level: {
    xpThresholds: buildXpThresholds(xpCurve.maxLevel, xpCurve.base, xpCurve.linear, xpCurve.quadraticNumerator, xpCurve.quadraticDenominator),
    offerCount: 3,
    upgrades: [
      ...actives.flatMap((active) => active.levels.slice(1).map((level) => ({ id: `${active.id}-level-${level.level}`, damageDelta: level.tuning.damage - active.levels[level.level - 2]!.tuning.damage, cooldownDeltaTicks: level.tuning.cooldownTicks - active.levels[level.level - 2]!.tuning.cooldownTicks }))),
      ...passives.flatMap((passive) => passive.levels.map((level) => ({ id: `${passive.id}-level-${level.level}` }))),
    ],
  },
  midbosses,
  finalBoss,
  scoring: {
    speedBonusBase: 5_400,
    speedBonusPerTick: 1,
    clearBonus: 4_000,
    noHitBonus: 2_000,
  },
  simulation: { ticksPerSecond: 60, stageDurationTicks: ticks(360), bossFightBudgetTicks: ticks(90) },
  slotRules: { activeLimit: 6, passiveLimit: 6, activeMaxLevel: 5, passiveMaxLevel: 3 },
  characters: [{ id: 'circle-runner', name: text('원형 탐사체'), description: text('공용 이동·공격 seam을 검증하는 단색 원형 캐릭터다.'), startingActiveId: 'line-beam', stats: { maxHp: 120, moveSpeedPerTick: 22, pickupRadius: 900, armor: 1, might: 1 }, spriteAssetId: 'circle-runner-sprite', portraitAssetId: 'circle-runner-portrait', designProvenance: [fixtureDesign] }],
  actives,
  passives,
  evolutions,
  enemyArchetypes,
  bossContent: {
    midbosses: [
      { id: 'midboss-pentagon', enemyId: 'pentagon-sentinel', name: text('오각형 감시자'), description: text('첫 encounter seam을 검증한다.'), intro: text('오각형 감시자가 나타났다.'), targetFightTicks: { minimum: ticks(18), maximum: ticks(32) }, designProvenance: [fixtureDesign] },
      { id: 'midboss-octagon', enemyId: 'octagon-collider', name: text('팔각형 충돌체'), description: text('두 번째 encounter seam을 검증한다.'), intro: text('팔각형 충돌체가 나타났다.'), targetFightTicks: { minimum: ticks(24), maximum: ticks(40) }, designProvenance: [fixtureDesign] },
    ],
    finalBoss: { id: 'final-boss-dodecagon', enemyId: 'dodecagon-core', name: text('십이각형 중심핵'), description: text('6분 이후 별도 boss clock을 검증한다.'), intro: text('일반 웨이브가 멈추고 중심핵이 나타났다.'), targetFightTicks: { minimum: ticks(60), maximum: ticks(90) }, designProvenance: [fixtureDesign] },
  },
  timeline,
  xpCurve,
  chestRules: { evolutionSources: ['midboss-pentagon', 'midboss-octagon'], preferEligibleRecipe: true, fallback: 'upgrade-owned' },
  theme: {
    title: text('도형 생존 테스트'),
    stageName: text('격자 실험장'),
    clearCopy: text('중심핵 제거 · 테스트 클리어'),
    lossCopy: text('도형 신호 소실 · 다시 실행'),
    colors: { background: '#101218', ground: '#1d2330', accent: '#62a8ff', danger: '#ff5f6f', experience: '#56e39f' },
  },
  assets: assetSlots.map(([id, kind]) => ({ id, kind, uri: `asset://geometric-engine-fixture/${id}`, status: 'planned', contentHash: null, provenance: [fixtureAsset] })),
  mockRewards: [
    {
      id: 'SCORE_BRONZE',
      rewardKind: 'digital_mock',
      condition: { kind: 'score', minimum: 10_000 },
      provisional: false,
      reviewStatus: 'not_required',
      label: text('테스트 점수 표식'),
      notice: text('테스트 보상 · 실제 지급되지 않음'),
    },
    {
      id: 'MIDBOSS_ONE',
      rewardKind: 'purchase_access_mock',
      condition: { kind: 'midboss', bossId: 'midboss-pentagon' },
      provisional: false,
      reviewStatus: 'not_required',
      label: text('첫 encounter 표식'),
      notice: text('테스트 보상 · 실제 지급되지 않음'),
    },
    {
      id: 'MIDBOSS_TWO',
      rewardKind: 'purchase_access_mock',
      condition: { kind: 'midboss', bossId: 'midboss-octagon' },
      provisional: false,
      reviewStatus: 'not_required',
      label: text('두 번째 encounter 표식'),
      notice: text('테스트 보상 · 실제 지급되지 않음'),
    },
    {
      id: 'FINAL_BOSS',
      rewardKind: 'purchase_access_mock',
      condition: {
        kind: 'final-boss',
        bossId: 'final-boss-dodecagon',
        purchaseWindowHours: 24,
      },
      provisional: false,
      reviewStatus: 'not_required',
      label: text('최종 encounter 표식'),
      notice: text('테스트 보상 · 실제 지급되지 않음'),
    },
    {
      id: 'SPEEDRUN_TOP_N',
      rewardKind: 'physical_goods_candidate_mock',
      condition: {
        kind: 'speedrun',
        bossId: 'final-boss-dodecagon',
        provisionalTopN: 10,
        reviewWindowHours: 72,
        claimWindowDays: 7,
        unclaimedPolicy: 'next-ranked',
        shippingPayer: 'operator',
      },
      provisional: true,
      reviewStatus: 'manual_review',
      label: text('잠정 속도 표식'),
      notice: text('테스트 보상 · 실제 지급되지 않음'),
    },
  ],
} satisfies ContentPack;
