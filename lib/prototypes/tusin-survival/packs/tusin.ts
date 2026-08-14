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
  type ProvenanceRecord,
  type TextReviewStatus,
  type TimelineEntry,
} from './types';

const ticks = (seconds: number) => seconds * 60;

const originalDesign = provenance(
  'original-game-design',
  'tusin-survival-pack-v1',
  'repo://docs/prototypes/tusin-survival-spec.md#4-first-content-pack',
  '승인된 first-playable 명세에서 새로 설계한 콘텐츠다.',
  '타 게임의 수치, recipe, 웨이브 표를 사용하지 않고 6분 성장곡선에 맞춰 작성했다.',
);
const proposalReference = provenance(
  'rights-approved-proposal',
  '20260811-tusin-reincarnation-proposal',
  'internal://rights-approved-proposal/20260811-tusin-reincarnation-proposal',
  '권리 승인된 내부 제안서의 캐릭터 및 시각 방향을 참조한다.',
  '런타임 에셋은 제안서 원본을 복사하지 않고 별도 도트 자산으로 제작한다.',
);
const officialEpisodeReference = provenance(
  'ip-official-episode',
  'tusin-episode-motif-review',
  'repo://docs/prototypes/tusin-survival-spec.md#4-first-content-pack',
  '명세에서 공식 회차 모티프로 분류한 범위만 사용한다.',
  '게임 효과와 수치는 모두 프로토타입을 위해 새로 설계했다.',
);
const collaborationReference = provenance(
  'licensed-collab-only',
  'tusin-collaboration-name-review',
  'repo://docs/prototypes/tusin-survival-spec.md#4-first-content-pack',
  '라이선스 콜라보에서만 확인된 명칭으로 출시 전 감수가 필요하다.',
  '명칭 존재만 보조 근거로 사용하고 동작과 수치는 새로 설계했다.',
);
const generatedAsset = provenance(
  'generated-original',
  'tusin-survival-generated-assets-v1',
  'internal://generated-assets/tusin-survival/v1',
  '제안서 근거를 이용해 새로 생성하고 후처리할 프로토타입 에셋 슬롯이다.',
  '현재 팩은 logical asset URI만 선언하며 생성 기록과 최종 hash는 에셋 단계에서 채운다.',
);

function text(
  value: string,
  records: ProvenanceRecord[] = [originalDesign],
  status: TextReviewStatus = 'reviewed-prototype',
) {
  return copy(value, records, status);
}

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

const actives: ActiveContentDefinition[] = [
  {
    id: 'basic-sword-strike',
    name: text('기본 검격'),
    description: text('바라보는 방향의 가까운 적을 가르는 짧고 빠른 검격이다.'),
    behavior: [{ kind: 'pierce', target: 'facing', pattern: 'short-forward-cleave' }],
    levels: activeLevels(
      '기본 검격',
      [originalDesign],
      tuning({ cooldownTicks: 34, damage: 18, area: 420, speedPerTick: 1, durationTicks: 8, pierce: 3 }),
      { cooldownTicks: -2, damage: 6, area: 55, pierce: 1 },
    ),
    assetIds: ['active-basic-sword-strike-icon', 'active-basic-sword-strike-vfx'],
    designProvenance: [originalDesign],
  },
  {
    id: 'cloud-dragon-ascent',
    name: text('운룡등천', [collaborationReference], 'internal-placeholder'),
    description: text('가장 가까운 적 무리를 향해 솟구치는 검기를 발사한다.'),
    behavior: [{ kind: 'projectile', target: 'nearest-cluster', pattern: 'ascending-wave' }],
    levels: activeLevels(
      '운룡등천',
      [originalDesign],
      tuning({ cooldownTicks: 82, damage: 30, area: 330, speedPerTick: 520, durationTicks: 56, pierce: 4 }),
      { cooldownTicks: -4, damage: 9, amount: 0.25, area: 35, pierce: 1 },
    ),
    assetIds: ['active-cloud-dragon-ascent-icon', 'active-cloud-dragon-ascent-vfx'],
    designProvenance: [collaborationReference, originalDesign],
  },
  {
    id: 'sword-of-light',
    name: text('빛의 검', [collaborationReference], 'internal-placeholder'),
    description: text('빛의 검편이 전투자를 공전하며 접근하는 적을 끊어낸다.'),
    behavior: [{ kind: 'orbit', target: 'radial', pattern: 'alternating-blades' }],
    levels: activeLevels(
      '빛의 검',
      [originalDesign],
      tuning({ cooldownTicks: 76, damage: 13, amount: 2, area: 260, speedPerTick: 180, durationTicks: 170, pierce: 2 }),
      { cooldownTicks: -3, damage: 5, amount: 0.5, area: 24, speedPerTick: 12, durationTicks: 20 },
    ),
    assetIds: ['active-sword-of-light-icon', 'active-sword-of-light-vfx'],
    designProvenance: [collaborationReference, originalDesign],
  },
  {
    id: 'gram-dragon-slayer',
    name: text('용살검 그람', [collaborationReference], 'internal-placeholder'),
    description: text('가장 강한 적을 향해 무거운 일격을 투사하는 대검 기술이다.'),
    behavior: [{ kind: 'pierce', target: 'nearest', pattern: 'heavy-line-breaker' }],
    levels: activeLevels(
      '용살검 그람',
      [originalDesign],
      tuning({ cooldownTicks: 104, damage: 58, area: 390, speedPerTick: 650, durationTicks: 46, pierce: 7, knockback: 28 }),
      { cooldownTicks: -5, damage: 16, area: 40, pierce: 1, knockback: 4 },
    ),
    assetIds: ['active-gram-dragon-slayer-icon', 'active-gram-dragon-slayer-vfx'],
    designProvenance: [collaborationReference, originalDesign],
  },
  {
    id: 'lightning-fall',
    name: text('낙뢰'),
    description: text('적이 가장 빽빽한 지점에 번개를 떨어뜨려 연쇄 피해를 준다.'),
    behavior: [{ kind: 'chain', target: 'nearest-cluster', pattern: 'descending-bolt' }],
    levels: activeLevels(
      '낙뢰',
      [originalDesign],
      tuning({ cooldownTicks: 92, damage: 32, area: 300, speedPerTick: 1, durationTicks: 12, chainTargets: 3, knockback: 4 }),
      { cooldownTicks: -4, damage: 9, area: 30, chainTargets: 1 },
    ),
    assetIds: ['active-lightning-fall-icon', 'active-lightning-fall-vfx'],
    designProvenance: [originalDesign],
  },
  {
    id: 'black-dragon-chain',
    name: text('블랙 드래곤 체인'),
    description: text('검은 사슬이 주변을 휘감고 적을 느리게 하며 반복 타격한다.'),
    behavior: [
      { kind: 'aura', target: 'radial', pattern: 'coiling-chain' },
      { kind: 'status', target: 'radial', pattern: 'drag-inward', statusId: 'dragged' },
    ],
    levels: activeLevels(
      '블랙 드래곤 체인',
      [originalDesign],
      tuning({ cooldownTicks: 128, damage: 20, amount: 2, area: 360, speedPerTick: 260, durationTicks: 145, pierce: 4, knockback: -4 }),
      { cooldownTicks: -5, damage: 7, amount: 0.25, area: 45, durationTicks: 18, pierce: 1 },
    ),
    assetIds: ['active-black-dragon-chain-icon', 'active-black-dragon-chain-vfx'],
    designProvenance: [originalDesign],
  },
];

const passives: PassiveContentDefinition[] = [
  {
    id: 'wall-of-iron',
    name: text('Wall of Iron', [officialEpisodeReference]),
    description: text('피해를 견디는 힘과 최대 생명력을 높인다.', [officialEpisodeReference, originalDesign]),
    levels: passiveLevels('Wall of Iron', [originalDesign], [
      [{ stat: 'armor', value: 1 }],
      [{ stat: 'armor', value: 1 }, { stat: 'maxHealth', value: 0.08 }],
      [{ stat: 'armor', value: 2 }, { stat: 'maxHealth', value: 0.12 }],
    ]),
    assetIds: ['passive-wall-of-iron-icon'],
    designProvenance: [officialEpisodeReference, originalDesign],
  },
  {
    id: 'hermes-secret-skill',
    name: text("Hermes's Secret Skill", [officialEpisodeReference]),
    description: text('이동 속도를 높이고 자동 기술의 재사용 주기를 줄인다.', [officialEpisodeReference, originalDesign]),
    levels: passiveLevels("Hermes's Secret Skill", [originalDesign], [
      [{ stat: 'moveSpeed', value: 0.08 }],
      [{ stat: 'moveSpeed', value: 0.1 }, { stat: 'cooldown', value: -0.04 }],
      [{ stat: 'moveSpeed', value: 0.12 }, { stat: 'cooldown', value: -0.06 }],
    ]),
    assetIds: ['passive-hermes-secret-skill-icon'],
    designProvenance: [officialEpisodeReference, originalDesign],
  },
  {
    id: 'purification-ring',
    name: text('정화의 반지'),
    description: text('공격 범위와 경험치 회수 반경을 넓힌다.'),
    levels: passiveLevels('정화의 반지', [originalDesign], [
      [{ stat: 'area', value: 0.08 }],
      [{ stat: 'area', value: 0.1 }, { stat: 'pickupRadius', value: 0.12 }],
      [{ stat: 'area', value: 0.14 }, { stat: 'pickupRadius', value: 0.18 }],
    ]),
    assetIds: ['passive-purification-ring-icon'],
    designProvenance: [originalDesign],
  },
  {
    id: 'dragon-heart',
    name: text('Dragon Heart', [officialEpisodeReference]),
    description: text('모든 공격의 위력과 최대 생명력을 높인다.', [officialEpisodeReference, originalDesign]),
    levels: passiveLevels('Dragon Heart', [originalDesign], [
      [{ stat: 'might', value: 0.09 }],
      [{ stat: 'might', value: 0.12 }, { stat: 'maxHealth', value: 0.08 }],
      [{ stat: 'might', value: 0.16 }, { stat: 'maxHealth', value: 0.12 }],
    ]),
    assetIds: ['passive-dragon-heart-icon'],
    designProvenance: [officialEpisodeReference, originalDesign],
  },
  {
    id: 'regressors-memory',
    name: text('회귀자의 기억'),
    description: text('지속형 기술이 오래 남고 자동 기술의 주기를 줄인다.'),
    levels: passiveLevels('회귀자의 기억', [originalDesign], [
      [{ stat: 'duration', value: 0.1 }],
      [{ stat: 'duration', value: 0.14 }, { stat: 'cooldown', value: -0.03 }],
      [{ stat: 'duration', value: 0.2 }, { stat: 'cooldown', value: -0.05 }],
    ]),
    assetIds: ['passive-regressors-memory-icon'],
    designProvenance: [originalDesign],
  },
  {
    id: 'last-human',
    name: text('최후의 인간'),
    description: text('몰려드는 적이 많을수록 버틸 수 있도록 위력과 방어를 보강한다.'),
    levels: passiveLevels('최후의 인간', [originalDesign], [
      [{ stat: 'might', value: 0.06 }],
      [{ stat: 'might', value: 0.08 }, { stat: 'area', value: 0.06 }],
      [{ stat: 'might', value: 0.12 }, { stat: 'area', value: 0.08 }, { stat: 'armor', value: 1 }],
    ]),
    assetIds: ['passive-last-human-icon'],
    designProvenance: [originalDesign],
  },
];

const evolutions: EvolutionContentDefinition[] = [
  ['iron-wall-sword-path', '철벽검로', 'basic-sword-strike', 'wall-of-iron',
    [{ kind: 'pierce', target: 'facing', pattern: 'wide-counter-cleave' }],
    tuning({ cooldownTicks: 24, damage: 92, amount: 2, area: 780, speedPerTick: 1, durationTicks: 12, pierce: 12, knockback: 38 })],
  ['swift-cloud-dragon', '신속운룡', 'cloud-dragon-ascent', 'hermes-secret-skill',
    [{ kind: 'projectile', target: 'nearest-cluster', pattern: 'returning-ascending-waves' }],
    tuning({ cooldownTicks: 48, damage: 70, amount: 3, area: 520, speedPerTick: 780, durationTicks: 80, pierce: 8, knockback: 18 })],
  ['purifying-light-sword', '정화광검', 'sword-of-light', 'purification-ring',
    [{ kind: 'orbit', target: 'radial', pattern: 'expanding-light-lattice' }],
    tuning({ cooldownTicks: 52, damage: 46, amount: 8, area: 440, speedPerTick: 260, durationTicks: 260, pierce: 5, knockback: 14 })],
  ['requiem', '레퀴엠', 'gram-dragon-slayer', 'dragon-heart',
    [{ kind: 'pierce', target: 'nearest', pattern: 'execution-line' }],
    tuning({ cooldownTicks: 76, damage: 210, amount: 2, area: 620, speedPerTick: 900, durationTicks: 58, pierce: 20, knockback: 60 })],
  ['regression-thunder', '회귀천뢰', 'lightning-fall', 'regressors-memory',
    [{ kind: 'chain', target: 'nearest-cluster', pattern: 'echoing-thunder-field' }],
    tuning({ cooldownTicks: 58, damage: 86, amount: 2, area: 560, speedPerTick: 1, durationTicks: 42, chainTargets: 9, knockback: 12 })],
  ['last-dragon-shackle', '최후의 용쇄', 'black-dragon-chain', 'last-human',
    [{ kind: 'summon', target: 'radial', pattern: 'four-chain-dragons' },
      { kind: 'status', target: 'radial', pattern: 'bind-and-collapse', statusId: 'bound' }],
    tuning({ cooldownTicks: 82, damage: 66, amount: 4, area: 760, speedPerTick: 420, durationTicks: 250, pierce: 10, chainTargets: 4, knockback: -12 })],
].map(([id, name, activeId, passiveId, behavior, combat]) => ({
  id: id as string,
  name: text(name as string),
  description: text(`${name as string} · 대응 무기와 패시브를 완성해 여는 게임 오리지널 진화다.`),
  recipe: {
    activeId: activeId as string,
    passiveId: passiveId as string,
    activeLevel: 5,
    passiveMinLevel: 1,
    requiresEvolutionChest: true,
  },
  behavior: behavior as EvolutionContentDefinition['behavior'],
  tuning: combat as CombatTuning,
  effect: text(`${name as string}이 고유 패턴으로 전장을 제압한다.`),
  assetIds: [`evolution-${id as string}-icon`, `evolution-${id as string}-vfx`],
  designProvenance: [originalDesign],
}));

const enemyArchetypes: EnemyContentDefinition[] = [
  {
    id: 'demon-scout',
    name: text('마신군 척후병'),
    description: text('수적 우세로 길을 막는 빠른 근접 병력이다.'),
    ai: { kind: 'chase', preferredRange: 0, decisionIntervalTicks: 18 },
    engine: { maxHp: 34, moveSpeedPerTick: 13, contactDamage: 6, contactRadius: 170, scoreValue: 42, dropXp: 3 },
    spriteAssetId: 'enemy-demon-scout-sprite',
    designProvenance: [originalDesign],
  },
  {
    id: 'ruin-lancer',
    name: text('멸망의 창병'),
    description: text('거리를 재다가 직선 돌진으로 대형을 가르는 병력이다.'),
    ai: { kind: 'charge', preferredRange: 1_600, decisionIntervalTicks: 96 },
    engine: { maxHp: 82, moveSpeedPerTick: 9, contactDamage: 14, contactRadius: 220, scoreValue: 96, dropXp: 6 },
    spriteAssetId: 'enemy-ruin-lancer-sprite',
    designProvenance: [originalDesign],
  },
  {
    id: 'shadow-hexer',
    name: text('암영 주술사'),
    description: text('중거리에서 검은 파편을 던지며 측면을 압박한다.'),
    ai: { kind: 'ranged-orbit', preferredRange: 2_400, decisionIntervalTicks: 72 },
    engine: { maxHp: 58, moveSpeedPerTick: 8, contactDamage: 10, contactRadius: 190, scoreValue: 120, dropXp: 7 },
    spriteAssetId: 'enemy-shadow-hexer-sprite',
    designProvenance: [originalDesign],
  },
  {
    id: 'doom-wing',
    name: text('파멸의 익수'),
    description: text('넓은 호를 그리며 빈 공간으로 파고드는 비행형 병력이다.'),
    ai: { kind: 'strafe', preferredRange: 1_100, decisionIntervalTicks: 44 },
    engine: { maxHp: 105, moveSpeedPerTick: 16, contactDamage: 18, contactRadius: 240, scoreValue: 178, dropXp: 10 },
    spriteAssetId: 'enemy-doom-wing-sprite',
    designProvenance: [originalDesign],
  },
];

const bossEnemies: Record<string, EnemyDefinition> = {
  'abyss-armored-captain': {
    maxHp: 2_800,
    moveSpeedPerTick: 7,
    contactDamage: 24,
    contactRadius: 420,
    scoreValue: 0,
    dropXp: 75,
  },
  'black-dragon-siege-mage': {
    maxHp: 6_400,
    moveSpeedPerTick: 6,
    contactDamage: 32,
    contactRadius: 460,
    scoreValue: 0,
    dropXp: 140,
  },
  'demon-army-vanguard': {
    maxHp: 22_000,
    moveSpeedPerTick: 8,
    contactDamage: 45,
    contactRadius: 620,
    scoreValue: 0,
    dropXp: 0,
  },
};

const midbosses: BossDefinition[] = [
  { id: 'midboss-abyss-captain', enemyId: 'abyss-armored-captain', spawnTick: ticks(120), killBonus: 1_500 },
  { id: 'midboss-siege-mage', enemyId: 'black-dragon-siege-mage', spawnTick: ticks(240), killBonus: 3_200 },
];
const finalBoss: BossDefinition = {
  id: 'final-boss-demon-vanguard',
  enemyId: 'demon-army-vanguard',
  spawnTick: ticks(360),
  killBonus: 9_000,
};

const timeline: TimelineEntry[] = [
  { kind: 'wave', id: 'opening-scouts', atTick: ticks(0), untilTick: ticks(45), cadenceTicks: ticks(5), budget: 12, enemyIds: ['demon-scout'] },
  { kind: 'wave', id: 'lancer-pressure', atTick: ticks(45), untilTick: ticks(90), cadenceTicks: ticks(6), budget: 18, enemyIds: ['demon-scout', 'ruin-lancer'] },
  { kind: 'wave', id: 'hexer-crossfire', atTick: ticks(90), untilTick: ticks(120), cadenceTicks: ticks(5), budget: 23, enemyIds: ['demon-scout', 'shadow-hexer'] },
  { kind: 'midboss', id: 'first-midboss', atTick: ticks(120), bossId: 'midboss-abyss-captain' },
  { kind: 'wave', id: 'post-captain-surge', atTick: ticks(120), untilTick: ticks(195), cadenceTicks: ticks(4), budget: 31, enemyIds: ['demon-scout', 'ruin-lancer', 'shadow-hexer'] },
  { kind: 'wave', id: 'wing-entry', atTick: ticks(195), untilTick: ticks(240), cadenceTicks: ticks(4), budget: 39, enemyIds: ['demon-scout', 'doom-wing'] },
  { kind: 'wave', id: 'siege-approach', atTick: ticks(210), untilTick: ticks(240), cadenceTicks: ticks(3), budget: 47, enemyIds: ['ruin-lancer', 'shadow-hexer', 'doom-wing'] },
  { kind: 'midboss', id: 'second-midboss', atTick: ticks(240), bossId: 'midboss-siege-mage' },
  { kind: 'wave', id: 'all-fronts', atTick: ticks(240), untilTick: ticks(330), cadenceTicks: ticks(3), budget: 58, enemyIds: ['demon-scout', 'ruin-lancer', 'shadow-hexer', 'doom-wing'] },
  { kind: 'wave', id: 'last-stand', atTick: ticks(330), untilTick: ticks(360), cadenceTicks: ticks(2), budget: 72, enemyIds: ['demon-scout', 'ruin-lancer', 'shadow-hexer', 'doom-wing'] },
  { kind: 'final-boss-transition', id: 'demon-vanguard-transition', atTick: ticks(360), bossId: 'final-boss-demon-vanguard' },
];

const waves: WaveDefinition[] = [
  { tick: ticks(0), enemyId: 'demon-scout', count: 10 },
  { tick: ticks(45), enemyId: 'ruin-lancer', count: 6 },
  { tick: ticks(90), enemyId: 'shadow-hexer', count: 8 },
  { tick: ticks(135), enemyId: 'demon-scout', count: 28 },
  { tick: ticks(195), enemyId: 'doom-wing', count: 10 },
  { tick: ticks(240), enemyId: 'ruin-lancer', count: 18 },
  { tick: ticks(285), enemyId: 'shadow-hexer', count: 22 },
  { tick: ticks(315), enemyId: 'doom-wing', count: 18 },
  { tick: ticks(345), enemyId: 'demon-scout', count: 54 },
];

const assetSlots: Array<[string, AssetManifestEntry['kind'], ProvenanceRecord[]]> = [
  ['zephyr-sprite', 'sprite', [proposalReference, generatedAsset]],
  ['zephyr-portrait', 'portrait', [proposalReference, generatedAsset]],
  ...actives.flatMap((active) => [
    [active.assetIds[0]!, 'icon', [generatedAsset]],
    [active.assetIds[1]!, 'vfx', [generatedAsset]],
  ] as Array<[string, AssetManifestEntry['kind'], ProvenanceRecord[]]>),
  ...passives.map((passive) => [passive.assetIds[0]!, 'icon', [generatedAsset]] as [string, AssetManifestEntry['kind'], ProvenanceRecord[]]),
  ...evolutions.flatMap((evolution) => [
    [evolution.assetIds[0]!, 'icon', [generatedAsset]],
    [evolution.assetIds[1]!, 'vfx', [generatedAsset]],
  ] as Array<[string, AssetManifestEntry['kind'], ProvenanceRecord[]]>),
  ...enemyArchetypes.map((enemy) => [enemy.spriteAssetId, 'sprite', [generatedAsset]] as [string, AssetManifestEntry['kind'], ProvenanceRecord[]]),
  ['midboss-abyss-captain-sprite', 'sprite', [generatedAsset]],
  ['midboss-siege-mage-sprite', 'sprite', [generatedAsset]],
  ['final-boss-demon-vanguard-sprite', 'sprite', [generatedAsset]],
  ['final-boss-demon-vanguard-cutin', 'cutin', [generatedAsset]],
  ['last-battle-bgm', 'bgm', [generatedAsset]],
];

const xpCurve = {
  maxLevel: 54,
  base: 7,
  linear: 4,
  quadraticNumerator: 1,
  quadraticDenominator: 6,
};

export const tusinSurvivalPack = {
  schemaVersion: CONTENT_PACK_SCHEMA_VERSION,
  id: 'tusin-survival-internal-v1',
  lifecycle: 'internal-prototype',
  physicalRewardsEnabled: false,
  engineVersion: 'survival-engine-v1',
  contentVersion: 'tusin-survival-pack-v1',
  maxTicks: ticks(450),
  world: { width: 120_000, height: 80_000 },
  player: {
    startX: 60_000,
    startY: 40_000,
    maxHp: 126,
    moveSpeedPerTick: 22,
    pickupRadius: 900,
    weaponId: 'basic-sword-strike',
  },
  weapons: Object.fromEntries([
    ...actives.map((active) => [active.id, toEngineWeapon(active.levels[0]!.tuning)]),
    ...evolutions.map((evolution) => [evolution.id, toEngineWeapon(evolution.tuning)]),
  ]),
  enemies: {
    ...Object.fromEntries(enemyArchetypes.map((enemy) => [enemy.id, enemy.engine])),
    ...bossEnemies,
  },
  waves,
  level: {
    xpThresholds: buildXpThresholds(
      xpCurve.maxLevel,
      xpCurve.base,
      xpCurve.linear,
      xpCurve.quadraticNumerator,
      xpCurve.quadraticDenominator,
    ),
    offerCount: 3,
    upgrades: [
      ...actives.flatMap((active) => active.levels.slice(1).map((level) => ({
        id: `${active.id}-level-${level.level}`,
        damageDelta: level.tuning.damage - active.levels[level.level - 2]!.tuning.damage,
        cooldownDeltaTicks:
          level.tuning.cooldownTicks - active.levels[level.level - 2]!.tuning.cooldownTicks,
      }))),
      ...passives.flatMap((passive) => passive.levels.map((level) => ({
        id: `${passive.id}-level-${level.level}`,
      }))),
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
  simulation: {
    ticksPerSecond: 60,
    stageDurationTicks: ticks(360),
    bossFightBudgetTicks: ticks(90),
  },
  slotRules: { activeLimit: 6, passiveLimit: 6, activeMaxLevel: 5, passiveMaxLevel: 3 },
  characters: [
    {
      id: 'zephyr',
      name: text('제피르', [proposalReference]),
      description: text('회귀 전 마지막 전장에서 살아남는 검의 전투자다.', [proposalReference, originalDesign]),
      startingActiveId: 'basic-sword-strike',
      stats: { maxHp: 126, moveSpeedPerTick: 22, pickupRadius: 900, armor: 1, might: 1 },
      spriteAssetId: 'zephyr-sprite',
      portraitAssetId: 'zephyr-portrait',
      designProvenance: [proposalReference, originalDesign],
    },
  ],
  actives,
  passives,
  evolutions,
  enemyArchetypes,
  bossContent: {
    midbosses: [
      {
        id: 'midboss-abyss-captain',
        enemyId: 'abyss-armored-captain',
        name: text('심연의 철갑대장'),
        description: text('전열을 잠그고 충격파로 이동 공간을 좁히는 첫 중간보스다.'),
        intro: text('철갑대장이 전열을 봉쇄한다.'),
        targetFightTicks: { minimum: ticks(18), maximum: ticks(32) },
        designProvenance: [originalDesign],
      },
      {
        id: 'midboss-siege-mage',
        enemyId: 'black-dragon-siege-mage',
        name: text('흑룡 공성마도사'),
        description: text('위험 지대를 순차 배치해 후반 빌드를 시험하는 두 번째 중간보스다.'),
        intro: text('검은 마력이 전장을 가른다.'),
        targetFightTicks: { minimum: ticks(24), maximum: ticks(40) },
        designProvenance: [originalDesign],
      },
    ],
    finalBoss: {
      id: 'final-boss-demon-vanguard',
      enemyId: 'demon-army-vanguard',
      name: text('마신군 선봉장'),
      description: text('원작 결말을 바꾸지 않는 게임 오리지널 최종 전투 지휘관이다.'),
      intro: text('6분의 전선이 멎고 마신군 선봉장이 모습을 드러낸다.'),
      targetFightTicks: { minimum: ticks(60), maximum: ticks(90) },
      designProvenance: [originalDesign],
    },
  },
  timeline,
  xpCurve,
  chestRules: {
    evolutionSources: ['midboss-abyss-captain', 'midboss-siege-mage'],
    preferEligibleRecipe: true,
    fallback: 'upgrade-owned',
  },
  theme: {
    title: text('투신전생기 서바이벌', [proposalReference, originalDesign]),
    stageName: text('회귀 전 최후의 전장'),
    clearCopy: text('선봉장을 쓰러뜨렸다 · 테스트 클리어'),
    lossCopy: text('전선이 무너졌다 · 빌드를 바꾸어 다시 도전'),
    colors: {
      background: '#090b18',
      ground: '#17152a',
      accent: '#78b7ff',
      danger: '#dc4c67',
      experience: '#6de4d0',
    },
  },
  assets: assetSlots.map(([id, kind, records]) => ({
    id,
    kind,
    uri: `asset://tusin-survival/${id}`,
    status: 'planned',
    contentHash: null,
    provenance: records,
  })),
  mockRewards: [
    {
      id: 'SCORE_BRONZE',
      rewardKind: 'digital_mock',
      condition: { kind: 'score', minimum: 10_000 },
      provisional: false,
      reviewStatus: 'not_required',
      label: text('테스트 디지털 카드 + 프로필 배지'),
      notice: text('테스트 보상 · 실제 지급되지 않음'),
    },
    {
      id: 'SCORE_SILVER',
      rewardKind: 'digital_mock',
      condition: { kind: 'score', minimum: 25_000 },
      provisional: false,
      reviewStatus: 'not_required',
      label: text('테스트 상위 디지털 카드 + 프로필 배지'),
      notice: text('테스트 보상 · 실제 지급되지 않음'),
    },
    {
      id: 'MIDBOSS_ONE',
      rewardKind: 'purchase_access_mock',
      condition: { kind: 'midboss', bossId: 'midboss-abyss-captain' },
      provisional: false,
      reviewStatus: 'not_required',
      label: text('테스트 한정 굿즈 구매 접근권'),
      notice: text('테스트 보상 · 실제 지급되지 않음'),
    },
    {
      id: 'MIDBOSS_TWO',
      rewardKind: 'purchase_access_mock',
      condition: { kind: 'midboss', bossId: 'midboss-siege-mage' },
      provisional: false,
      reviewStatus: 'not_required',
      label: text('테스트 한정 굿즈 구매 접근권'),
      notice: text('테스트 보상 · 실제 지급되지 않음'),
    },
    {
      id: 'FINAL_BOSS',
      rewardKind: 'purchase_access_mock',
      condition: {
        kind: 'final-boss',
        bossId: 'final-boss-demon-vanguard',
        purchaseWindowHours: 24,
      },
      provisional: false,
      reviewStatus: 'not_required',
      label: text('테스트 재고보장 정가 구매권(24시간)'),
      notice: text('테스트 보상 · 실제 지급되지 않음'),
    },
    {
      id: 'SPEEDRUN_TOP_N',
      rewardKind: 'physical_goods_candidate_mock',
      condition: {
        kind: 'speedrun',
        bossId: 'final-boss-demon-vanguard',
        provisionalTopN: 10,
        reviewWindowHours: 72,
        claimWindowDays: 7,
        unclaimedPolicy: 'next-ranked',
        shippingPayer: 'operator',
      },
      provisional: true,
      reviewStatus: 'manual_review',
      label: text('테스트 무료 실물 굿즈 후보 · 잠정'),
      notice: text('테스트 보상 · 실제 지급되지 않음'),
    },
  ],
} satisfies ContentPack;
