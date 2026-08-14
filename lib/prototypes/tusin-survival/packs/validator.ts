import {
  MOCK_REWARD_KINDS,
  PROVENANCE_CLASSES,
  type AssetManifestEntry,
  type ContentPack,
  type ProvenanceRecord,
  type ProvenancedText,
} from './types';

// Packs may eventually be loaded from JSON, where the TypeScript union cannot help.
const provenanceClasses = new Set<string>(PROVENANCE_CLASSES);
const mockRewardKinds = new Set<string>(MOCK_REWARD_KINDS);

export type PackValidationIssueCode =
  | 'PHYSICAL_REWARDS_MUST_BE_FALSE'
  | 'INVALID_SIMULATION'
  | 'INVALID_SPAWN_SCALING'
  | 'INVALID_SLOT_LIMIT'
  | 'INSUFFICIENT_SLOT_CONTENT'
  | 'INVALID_LEVEL_COUNT'
  | 'DUPLICATE_ID'
  | 'UNKNOWN_REFERENCE'
  | 'DUPLICATE_RECIPE_TARGET'
  | 'INVALID_RECIPE_LEVEL'
  | 'INVALID_TIMELINE'
  | 'INVALID_MOCK_REWARD'
  | 'MISSING_PROVENANCE'
  | 'INCOMPLETE_PROVENANCE'
  | 'UNREVIEWED_RELEASE_TEXT';

export interface PackValidationIssue {
  code: PackValidationIssueCode;
  path: string;
  message: string;
}

function duplicateIds(values: Array<{ id: string }>): string[] {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const value of values) {
    if (seen.has(value.id)) duplicates.add(value.id);
    seen.add(value.id);
  }
  return [...duplicates];
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}

function isCompleteProvenance(record: ProvenanceRecord): boolean {
  if (
    !provenanceClasses.has(record.class) ||
    !isNonEmptyString(record.sourceId) ||
    !isNonEmptyString(record.sourceUrl) ||
    !isNonEmptyString(record.sourceNote) ||
    !isNonEmptyString(record.reviewer) ||
    !isNonEmptyString(record.originalDesignNotes) ||
    typeof record.reviewedAt !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}$/.test(record.reviewedAt)
  ) {
    return false;
  }
  try {
    new URL(record.sourceUrl);
    return true;
  } catch {
    return false;
  }
}

export function validateContentPack(pack: ContentPack): PackValidationIssue[] {
  const issues: PackValidationIssue[] = [];
  const add = (code: PackValidationIssueCode, path: string, message: string) => {
    issues.push({ code, path, message });
  };

  if (pack.physicalRewardsEnabled !== false) {
    add(
      'PHYSICAL_REWARDS_MUST_BE_FALSE',
      'physicalRewardsEnabled',
      '프로토타입 콘텐츠 팩은 물리 보상을 활성화할 수 없다.',
    );
  }

  if (
    pack.simulation.ticksPerSecond !== 60 ||
    !Number.isInteger(pack.simulation.stageDurationTicks) ||
    pack.simulation.stageDurationTicks <= 0 ||
    !Number.isInteger(pack.simulation.bossFightBudgetTicks) ||
    pack.simulation.bossFightBudgetTicks <= 0 ||
    pack.maxTicks !==
      pack.simulation.stageDurationTicks + pack.simulation.bossFightBudgetTicks
  ) {
    add(
      'INVALID_SIMULATION',
      'simulation',
      '60Hz stage clock과 별도 boss budget이 maxTicks에 정확히 반영되어야 한다.',
    );
  }

  const spawnLevels = new Set<number>();
  for (const [index, tier] of (pack.spawnLevelScaling ?? []).entries()) {
    const valid =
      isPositiveInteger(tier.minimumPlayerLevel) &&
      Number.isFinite(tier.cadenceScale) &&
      tier.cadenceScale > 0 &&
      Number.isFinite(tier.budgetScale) &&
      tier.budgetScale > 0 &&
      !spawnLevels.has(tier.minimumPlayerLevel);
    if (!valid) {
      add(
        'INVALID_SPAWN_SCALING',
        `spawnLevelScaling.${index}`,
        'spawn tier는 중복 없는 양의 정수 레벨과 유한한 양수 배율을 가져야 한다.',
      );
    }
    spawnLevels.add(tier.minimumPlayerLevel);
  }

  if (
    !Number.isInteger(pack.slotRules.activeLimit) ||
    pack.slotRules.activeLimit <= 0 ||
    !Number.isInteger(pack.slotRules.passiveLimit) ||
    pack.slotRules.passiveLimit <= 0 ||
    !Number.isInteger(pack.slotRules.activeMaxLevel) ||
    pack.slotRules.activeMaxLevel <= 0 ||
    !Number.isInteger(pack.slotRules.passiveMaxLevel) ||
    pack.slotRules.passiveMaxLevel <= 0
  ) {
    add('INVALID_SLOT_LIMIT', 'slotRules', '슬롯과 레벨 상한은 양의 정수여야 한다.');
  }
  if (
    pack.actives.length < pack.slotRules.activeLimit ||
    pack.passives.length < pack.slotRules.passiveLimit
  ) {
    add(
      'INSUFFICIENT_SLOT_CONTENT',
      'slotRules',
      '선언한 슬롯을 채울 수 있는 active/passive 콘텐츠가 필요하다.',
    );
  }

  for (const [collectionName, values] of [
    ['characters', pack.characters],
    ['actives', pack.actives],
    ['passives', pack.passives],
    ['evolutions', pack.evolutions],
    ['enemyArchetypes', pack.enemyArchetypes],
    ['midbosses', pack.midbosses],
    ['timeline', pack.timeline],
    ['assets', pack.assets],
    ['mockRewards', pack.mockRewards],
  ] as const) {
    for (const duplicate of duplicateIds(values)) {
      add('DUPLICATE_ID', `${collectionName}.${duplicate}`, '같은 컬렉션에서 id가 중복되었다.');
    }
  }

  for (const active of pack.actives) {
    const levelsAreSequential = active.levels.every((level, index) => level.level === index + 1);
    if (active.levels.length !== pack.slotRules.activeMaxLevel || !levelsAreSequential) {
      add(
        'INVALID_LEVEL_COUNT',
        `actives.${active.id}.levels`,
        'active 레벨은 1부터 activeMaxLevel까지 빠짐없이 있어야 한다.',
      );
    }
  }
  for (const passive of pack.passives) {
    const levelsAreSequential = passive.levels.every((level, index) => level.level === index + 1);
    if (passive.levels.length !== pack.slotRules.passiveMaxLevel || !levelsAreSequential) {
      add(
        'INVALID_LEVEL_COUNT',
        `passives.${passive.id}.levels`,
        'passive 레벨은 1부터 passiveMaxLevel까지 빠짐없이 있어야 한다.',
      );
    }
  }

  const activeIds = new Set(pack.actives.map((active) => active.id));
  const passiveIds = new Set(pack.passives.map((passive) => passive.id));
  const enemyIds = new Set(Object.keys(pack.enemies));
  const midbossIds = new Set(pack.midbosses.map((boss) => boss.id));
  const assetIds = new Set(pack.assets.map((asset) => asset.id));

  for (const character of pack.characters) {
    if (!activeIds.has(character.startingActiveId)) {
      add(
        'UNKNOWN_REFERENCE',
        `characters.${character.id}.startingActiveId`,
        '존재하지 않는 시작 active를 참조한다.',
      );
    }
    for (const [path, assetId] of [
      ['spriteAssetId', character.spriteAssetId],
      ['portraitAssetId', character.portraitAssetId],
    ]) {
      if (!assetIds.has(assetId)) {
        add(
          'UNKNOWN_REFERENCE',
          `characters.${character.id}.${path}`,
          'asset manifest에 없는 자산을 참조한다.',
        );
      }
    }
  }
  if (!activeIds.has(pack.player.weaponId) || !pack.weapons[pack.player.weaponId]) {
    add(
      'UNKNOWN_REFERENCE',
      'player.weaponId',
      '플레이어 시작 무기는 rich active와 engine weapon에 모두 있어야 한다.',
    );
  }

  const recipeActiveIds = new Set<string>();
  const recipePassiveIds = new Set<string>();
  for (const evolution of pack.evolutions) {
    const recipe = evolution.recipe;
    if (!activeIds.has(recipe.activeId)) {
      add(
        'UNKNOWN_REFERENCE',
        `evolutions.${evolution.id}.recipe.activeId`,
        '존재하지 않는 active를 참조한다.',
      );
    }
    if (!passiveIds.has(recipe.passiveId)) {
      add(
        'UNKNOWN_REFERENCE',
        `evolutions.${evolution.id}.recipe.passiveId`,
        '존재하지 않는 passive를 참조한다.',
      );
    }
    if (recipeActiveIds.has(recipe.activeId) || recipePassiveIds.has(recipe.passiveId)) {
      add(
        'DUPLICATE_RECIPE_TARGET',
        `evolutions.${evolution.id}.recipe`,
        'first playable recipe는 active와 passive를 각각 한 번만 사용해야 한다.',
      );
    }
    recipeActiveIds.add(recipe.activeId);
    recipePassiveIds.add(recipe.passiveId);

    if (
      recipe.activeLevel !== pack.slotRules.activeMaxLevel ||
      recipe.passiveMinLevel < 1 ||
      recipe.passiveMinLevel > pack.slotRules.passiveMaxLevel ||
      !recipe.requiresEvolutionChest
    ) {
      add(
        'INVALID_RECIPE_LEVEL',
        `evolutions.${evolution.id}.recipe`,
        'recipe는 max active, 보유 passive, evolution chest 조건을 따라야 한다.',
      );
    }
    if (!pack.weapons[evolution.id]) {
      add(
        'UNKNOWN_REFERENCE',
        `weapons.${evolution.id}`,
        '진화 콘텐츠에는 대응하는 engine weapon 정의가 필요하다.',
      );
    }
  }

  for (const enemy of pack.enemyArchetypes) {
    if (!pack.enemies[enemy.id]) {
      add(
        'UNKNOWN_REFERENCE',
        `enemies.${enemy.id}`,
        'enemy metadata에는 대응하는 engine enemy 정의가 필요하다.',
      );
    }
    if (!assetIds.has(enemy.spriteAssetId)) {
      add(
        'UNKNOWN_REFERENCE',
        `enemyArchetypes.${enemy.id}.spriteAssetId`,
        'asset manifest에 없는 적 sprite를 참조한다.',
      );
    }
  }
  for (const boss of pack.midbosses) {
    if (!enemyIds.has(boss.enemyId)) {
      add(
        'UNKNOWN_REFERENCE',
        `midbosses.${boss.id}.enemyId`,
        '존재하지 않는 engine enemy를 참조한다.',
      );
    }
  }
  if (!pack.finalBoss || !enemyIds.has(pack.finalBoss.enemyId)) {
    add(
      'UNKNOWN_REFERENCE',
      'finalBoss',
      '최종보스와 대응 engine enemy가 필요하다.',
    );
  }

  for (const wave of pack.waves) {
    if (!enemyIds.has(wave.enemyId)) {
      add(
        'UNKNOWN_REFERENCE',
        `waves.${wave.tick}.${wave.enemyId}`,
        '존재하지 않는 engine enemy를 참조한다.',
      );
    }
    if (wave.tick < 0 || wave.tick >= pack.simulation.stageDurationTicks) {
      add('INVALID_TIMELINE', `waves.${wave.tick}`, '일반 웨이브는 6분 stage clock 안에 있어야 한다.');
    }
  }

  const finalTransitions = pack.timeline.filter(
    (entry) => entry.kind === 'final-boss-transition',
  );
  if (
    finalTransitions.length !== 1 ||
    finalTransitions[0]?.atTick !== pack.simulation.stageDurationTicks ||
    finalTransitions[0]?.bossId !== pack.finalBoss?.id
  ) {
    add(
      'INVALID_TIMELINE',
      'timeline.final-boss-transition',
      '정확히 한 번의 final transition이 stageDurationTicks에서 최종보스를 참조해야 한다.',
    );
  }
  for (const entry of pack.timeline) {
    if (entry.kind === 'wave') {
      if (
        entry.atTick < 0 ||
        entry.untilTick <= entry.atTick ||
        entry.untilTick > pack.simulation.stageDurationTicks ||
        entry.cadenceTicks <= 0 ||
        entry.enemyIds.some((id) => !enemyIds.has(id))
      ) {
        add('INVALID_TIMELINE', `timeline.${entry.id}`, 'wave timeline 값 또는 enemy 참조가 잘못되었다.');
      }
    } else if (entry.kind === 'midboss') {
      if (!midbossIds.has(entry.bossId) || entry.atTick >= pack.simulation.stageDurationTicks) {
        add('INVALID_TIMELINE', `timeline.${entry.id}`, '중간보스 timeline 참조가 잘못되었다.');
      }
    }
  }

  for (const source of pack.chestRules.evolutionSources) {
    if (!midbossIds.has(source)) {
      add(
        'UNKNOWN_REFERENCE',
        `chestRules.evolutionSources.${source}`,
        '존재하지 않는 중간보스를 evolution chest source로 참조한다.',
      );
    }
  }
  for (const reward of pack.mockRewards) {
    const value = reward as unknown as Record<string, unknown>;
    const condition = value.condition;
    let validCondition = false;

    if (isRecord(condition) && isNonEmptyString(condition.kind)) {
      switch (condition.kind) {
        case 'score':
          validCondition = isPositiveInteger(condition.minimum);
          break;
        case 'midboss':
          validCondition =
            isNonEmptyString(condition.bossId) && midbossIds.has(condition.bossId);
          break;
        case 'final-boss':
          validCondition =
            isNonEmptyString(condition.bossId) &&
            condition.bossId === pack.finalBoss?.id &&
            isPositiveInteger(condition.purchaseWindowHours);
          break;
        case 'speedrun':
          validCondition =
            isNonEmptyString(condition.bossId) &&
            condition.bossId === pack.finalBoss?.id &&
            isPositiveInteger(condition.provisionalTopN) &&
            isPositiveInteger(condition.reviewWindowHours) &&
            isPositiveInteger(condition.claimWindowDays) &&
            condition.unclaimedPolicy === 'next-ranked' &&
            condition.shippingPayer === 'operator';
          break;
      }
    }

    const validReviewState =
      typeof value.provisional === 'boolean' &&
      (value.reviewStatus === 'not_required' || value.reviewStatus === 'manual_review') &&
      value.provisional === (value.reviewStatus === 'manual_review');
    const validCopy =
      isRecord(value.label) &&
      isNonEmptyString(value.label.text) &&
      isRecord(value.notice) &&
      value.notice.text === '테스트 보상 · 실제 지급되지 않음';

    if (
      !isNonEmptyString(value.id) ||
      !isNonEmptyString(value.rewardKind) ||
      !mockRewardKinds.has(value.rewardKind) ||
      !validCondition ||
      !validReviewState ||
      !validCopy
    ) {
      add(
        'INVALID_MOCK_REWARD',
        `mockRewards.${isNonEmptyString(value.id) ? value.id : '<unknown>'}`,
        'mock reward는 알려진 mock kind, 유효한 조건, 비지급 고지와 일관된 검수 상태를 가져야 한다.',
      );
    }
  }

  const referencedAssetIds = [
    ...pack.actives.flatMap((active) => active.assetIds),
    ...pack.passives.flatMap((passive) => passive.assetIds),
    ...pack.evolutions.flatMap((evolution) => evolution.assetIds),
  ];
  for (const assetId of referencedAssetIds) {
    if (!assetIds.has(assetId)) {
      add(
        'UNKNOWN_REFERENCE',
        `assets.${assetId}`,
        '콘텐츠가 참조하는 asset manifest entry가 없다.',
      );
    }
  }

  function validateRecords(records: ProvenanceRecord[], path: string) {
    if (records.length === 0) {
      add('MISSING_PROVENANCE', path, 'provenance가 비어 있다.');
      return;
    }
    if (records.some((record) => !isCompleteProvenance(record))) {
      add('INCOMPLETE_PROVENANCE', path, 'provenance 필드 또는 source URL 형식이 불완전하다.');
    }
  }

  function validateText(value: ProvenancedText, path: string) {
    if (!value.text.trim()) {
      add('INCOMPLETE_PROVENANCE', `${path}.text`, '사용자-facing 텍스트가 비어 있다.');
    }
    validateRecords(value.provenance, `${path}.provenance`);
    if (
      value.status !== 'internal-placeholder' &&
      value.provenance.length > 0 &&
      value.provenance.every((record) => record.class === 'secondary-unverified')
    ) {
      add(
        'UNREVIEWED_RELEASE_TEXT',
        path,
        'secondary-unverified 단독 근거는 internal placeholder로만 사용할 수 있다.',
      );
    }
  }

  const texts: Array<[string, ProvenancedText]> = [];
  for (const character of pack.characters) {
    texts.push([`characters.${character.id}.name`, character.name]);
    texts.push([`characters.${character.id}.description`, character.description]);
    validateRecords(character.designProvenance, `characters.${character.id}.designProvenance`);
  }
  for (const active of pack.actives) {
    texts.push([`actives.${active.id}.name`, active.name]);
    texts.push([`actives.${active.id}.description`, active.description]);
    active.levels.forEach((level) =>
      texts.push([`actives.${active.id}.levels.${level.level}.effect`, level.effect]),
    );
    validateRecords(active.designProvenance, `actives.${active.id}.designProvenance`);
  }
  for (const passive of pack.passives) {
    texts.push([`passives.${passive.id}.name`, passive.name]);
    texts.push([`passives.${passive.id}.description`, passive.description]);
    passive.levels.forEach((level) =>
      texts.push([`passives.${passive.id}.levels.${level.level}.effect`, level.effect]),
    );
    validateRecords(passive.designProvenance, `passives.${passive.id}.designProvenance`);
  }
  for (const evolution of pack.evolutions) {
    texts.push([`evolutions.${evolution.id}.name`, evolution.name]);
    texts.push([`evolutions.${evolution.id}.description`, evolution.description]);
    texts.push([`evolutions.${evolution.id}.effect`, evolution.effect]);
    validateRecords(evolution.designProvenance, `evolutions.${evolution.id}.designProvenance`);
  }
  for (const enemy of pack.enemyArchetypes) {
    texts.push([`enemyArchetypes.${enemy.id}.name`, enemy.name]);
    texts.push([`enemyArchetypes.${enemy.id}.description`, enemy.description]);
    validateRecords(enemy.designProvenance, `enemyArchetypes.${enemy.id}.designProvenance`);
  }
  for (const boss of [...pack.bossContent.midbosses, pack.bossContent.finalBoss]) {
    texts.push([`bossContent.${boss.id}.name`, boss.name]);
    texts.push([`bossContent.${boss.id}.description`, boss.description]);
    texts.push([`bossContent.${boss.id}.intro`, boss.intro]);
    validateRecords(boss.designProvenance, `bossContent.${boss.id}.designProvenance`);
  }
  texts.push(['theme.title', pack.theme.title]);
  texts.push(['theme.stageName', pack.theme.stageName]);
  texts.push(['theme.clearCopy', pack.theme.clearCopy]);
  texts.push(['theme.lossCopy', pack.theme.lossCopy]);
  for (const reward of pack.mockRewards) {
    texts.push([`mockRewards.${reward.id}.label`, reward.label]);
    texts.push([`mockRewards.${reward.id}.notice`, reward.notice]);
  }
  for (const [path, value] of texts) validateText(value, path);

  for (const asset of pack.assets as AssetManifestEntry[]) {
    validateRecords(asset.provenance, `assets.${asset.id}.provenance`);
    if (asset.status !== 'planned' && !asset.contentHash) {
      add(
        'INCOMPLETE_PROVENANCE',
        `assets.${asset.id}.contentHash`,
        '생성 또는 검수된 asset에는 content hash가 필요하다.',
      );
    }
  }

  return issues;
}
