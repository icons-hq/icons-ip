import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { geometricTestPack } from './geometric';
import { tusinSurvivalPack } from './tusin';
import type { ContentPack } from './types';
import { validateContentPack } from './validator';

function clonePack(pack: ContentPack): ContentPack {
  return structuredClone(pack);
}

describe('tusinSurvivalPack', () => {
  it('6분 first-playable 콘텐츠와 안전 게이트를 완결한다', () => {
    expect(tusinSurvivalPack.physicalRewardsEnabled).toBe(false);
    expect(tusinSurvivalPack.simulation).toMatchObject({
      ticksPerSecond: 60,
      stageDurationTicks: 21_600,
    });
    expect(tusinSurvivalPack.slotRules).toEqual({
      activeLimit: 6,
      passiveLimit: 6,
      activeMaxLevel: 5,
      passiveMaxLevel: 3,
    });
    expect(tusinSurvivalPack.characters).toHaveLength(1);
    expect(tusinSurvivalPack.enemyArchetypes).toHaveLength(4);
    expect(tusinSurvivalPack.midbosses).toHaveLength(2);
    expect(tusinSurvivalPack.finalBoss).not.toBeNull();
    expect(tusinSurvivalPack.actives).toHaveLength(6);
    expect(tusinSurvivalPack.passives).toHaveLength(6);
    expect(tusinSurvivalPack.evolutions).toHaveLength(6);
    expect(tusinSurvivalPack.timeline.at(-1)).toMatchObject({
      kind: 'final-boss-transition',
      atTick: 21_600,
    });
    expect(validateContentPack(tusinSurvivalPack)).toEqual([]);
  });

  it('슬롯 수보다 콘텐츠가 부족하거나 레벨 계약이 어긋난 팩을 거부한다', () => {
    const invalid = clonePack(tusinSurvivalPack);
    invalid.actives.pop();
    invalid.passives[0]!.levels.pop();

    expect(validateContentPack(invalid).map((issue) => issue.code)).toEqual(
      expect.arrayContaining(['INSUFFICIENT_SLOT_CONTENT', 'INVALID_LEVEL_COUNT']),
    );
  });

  it('모든 진화가 서로 다른 active/passive를 정확한 조건으로 참조하게 한다', () => {
    const activeIds = tusinSurvivalPack.evolutions.map((evolution) => evolution.recipe.activeId);
    const passiveIds = tusinSurvivalPack.evolutions.map((evolution) => evolution.recipe.passiveId);

    expect(new Set(activeIds).size).toBe(6);
    expect(new Set(passiveIds).size).toBe(6);
    expect(
      tusinSurvivalPack.evolutions.every(
        (evolution) =>
          evolution.recipe.activeLevel === tusinSurvivalPack.slotRules.activeMaxLevel &&
          evolution.recipe.passiveMinLevel === 1 &&
          evolution.recipe.requiresEvolutionChest,
      ),
    ).toBe(true);

    const invalid = clonePack(tusinSurvivalPack);
    invalid.evolutions[0]!.recipe.activeId = 'missing-active';
    invalid.evolutions[1]!.recipe.passiveId = invalid.evolutions[0]!.recipe.passiveId;

    expect(validateContentPack(invalid).map((issue) => issue.code)).toEqual(
      expect.arrayContaining(['UNKNOWN_REFERENCE', 'DUPLICATE_RECIPE_TARGET']),
    );
  });

  it('사용자-facing 텍스트의 provenance 누락과 미검증 단독 출시 승격을 막는다', () => {
    const missing = clonePack(tusinSurvivalPack);
    missing.actives[0]!.name.provenance = [];

    expect(validateContentPack(missing).map((issue) => issue.code)).toContain('MISSING_PROVENANCE');

    const unreviewedRelease = clonePack(tusinSurvivalPack);
    unreviewedRelease.actives[0]!.name = {
      text: '검증되지 않은 출시 명칭',
      status: 'release-ready',
      provenance: [
        {
          class: 'secondary-unverified',
          sourceId: 'fan-summary-only',
          sourceUrl: 'internal://secondary/fan-summary-only',
          sourceNote: '공식 근거가 없는 2차 정리',
          reviewedAt: '2026-08-14',
          reviewer: 'prototype-content-review',
          originalDesignNotes: '출시 전 권리자 감수가 필요하다.',
        },
      ],
    };

    expect(validateContentPack(unreviewedRelease).map((issue) => issue.code)).toContain(
      'UNREVIEWED_RELEASE_TEXT',
    );

    const unknownClass = clonePack(tusinSurvivalPack);
    Object.assign(unknownClass.actives[0]!.name.provenance[0]!, {
      class: 'unknown-provenance-class',
    });

    expect(validateContentPack(unknownClass).map((issue) => issue.code)).toContain(
      'INCOMPLETE_PROVENANCE',
    );

    const missingField = clonePack(tusinSurvivalPack);
    Object.assign(missingField.actives[0]!.name.provenance[0]!, {
      sourceNote: undefined,
    });

    expect(validateContentPack(missingField).map((issue) => issue.code)).toContain(
      'INCOMPLETE_PROVENANCE',
    );
  });

  it('알 수 없거나 지급 안전 계약이 불완전한 mock reward 규칙을 fail closed한다', () => {
    const unknownKind = clonePack(tusinSurvivalPack);
    Object.assign(unknownKind.mockRewards[0]!, {
      rewardKind: 'purchase_access',
    });

    const invalidThreshold = clonePack(tusinSurvivalPack);
    Object.assign(invalidThreshold.mockRewards[0]!.condition, { minimum: 0 });

    const unsafeNotice = clonePack(tusinSurvivalPack);
    unsafeNotice.mockRewards[0]!.notice.text = '실제 지급';

    const unknownFinalBoss = clonePack(tusinSurvivalPack);
    Object.assign(unknownFinalBoss.mockRewards[4]!.condition, {
      bossId: 'missing-final-boss',
    });

    const inconsistentReview = clonePack(tusinSurvivalPack);
    inconsistentReview.mockRewards[5]!.provisional = false;

    const invalidUnclaimedPolicy = clonePack(tusinSurvivalPack);
    Object.assign(invalidUnclaimedPolicy.mockRewards[5]!.condition, {
      unclaimedPolicy: 'expire',
    });

    const invalidShippingPayer = clonePack(tusinSurvivalPack);
    Object.assign(invalidShippingPayer.mockRewards[5]!.condition, {
      shippingPayer: 'winner',
    });

    for (const invalid of [
      unknownKind,
      invalidThreshold,
      unsafeNotice,
      unknownFinalBoss,
      inconsistentReview,
      invalidUnclaimedPolicy,
      invalidShippingPayer,
    ]) {
      expect(validateContentPack(invalid).map((issue) => issue.code)).toContain(
        'INVALID_MOCK_REWARD',
      );
    }
  });

  it('레벨 기반 spawn 배율이 유효한 레벨과 양수 배율만 받게 한다', () => {
    const invalidLevel = clonePack(tusinSurvivalPack);
    invalidLevel.spawnLevelScaling = [{
      minimumPlayerLevel: 1.5,
      cadenceScale: 0.6,
      budgetScale: 1.5,
    }];

    const invalidCadence = clonePack(tusinSurvivalPack);
    invalidCadence.spawnLevelScaling = [{
      minimumPlayerLevel: 2,
      cadenceScale: 0,
      budgetScale: 1.5,
    }];

    const invalidBudget = clonePack(tusinSurvivalPack);
    invalidBudget.spawnLevelScaling = [{
      minimumPlayerLevel: 2,
      cadenceScale: 0.6,
      budgetScale: Number.NaN,
    }];

    for (const invalid of [invalidLevel, invalidCadence, invalidBudget]) {
      expect(validateContentPack(invalid).map((issue) => issue.code)).toContain(
        'INVALID_SPAWN_SCALING',
      );
    }
  });

  it('고밀도 웨이브용으로 모든 active와 evolution의 전투 예산을 상향한다', () => {
    const activeBudget = Object.fromEntries(tusinSurvivalPack.actives.map((active) => {
      const first = active.levels[0]!.tuning;
      const maximum = active.levels.at(-1)!.tuning;
      return [active.id, {
        first: {
          cooldownTicks: first.cooldownTicks,
          damage: first.damage,
          amount: first.amount,
          area: first.area,
          durationTicks: first.durationTicks,
          pierce: first.pierce,
          chainTargets: first.chainTargets,
        },
        maximum: {
          cooldownTicks: maximum.cooldownTicks,
          damage: maximum.damage,
          amount: maximum.amount,
          area: maximum.area,
          durationTicks: maximum.durationTicks,
          pierce: maximum.pierce,
          chainTargets: maximum.chainTargets,
        },
      }];
    }));

    expect(activeBudget).toEqual({
      'basic-sword-strike': {
        first: { cooldownTicks: 30, damage: 24, amount: 1, area: 560, durationTicks: 10, pierce: 5, chainTargets: 0 },
        maximum: { cooldownTicks: 22, damage: 56, amount: 1, area: 680, durationTicks: 10, pierce: 13, chainTargets: 0 },
      },
      'cloud-dragon-ascent': {
        first: { cooldownTicks: 70, damage: 40, amount: 1, area: 480, durationTicks: 90, pierce: 7, chainTargets: 0 },
        maximum: { cooldownTicks: 54, damage: 84, amount: 2, area: 660, durationTicks: 90, pierce: 15, chainTargets: 0 },
      },
      'sword-of-light': {
        first: { cooldownTicks: 68, damage: 16, amount: 2, area: 360, durationTicks: 220, pierce: 4, chainTargets: 0 },
        maximum: { cooldownTicks: 56, damage: 36, amount: 5, area: 488, durationTicks: 320, pierce: 8, chainTargets: 0 },
      },
      'gram-dragon-slayer': {
        first: { cooldownTicks: 88, damage: 76, amount: 1, area: 560, durationTicks: 85, pierce: 12, chainTargets: 0 },
        maximum: { cooldownTicks: 68, damage: 148, amount: 1, area: 760, durationTicks: 85, pierce: 20, chainTargets: 0 },
      },
      'lightning-fall': {
        first: { cooldownTicks: 76, damage: 42, amount: 1, area: 460, durationTicks: 18, pierce: 1, chainTargets: 6 },
        maximum: { cooldownTicks: 60, damage: 86, amount: 1, area: 620, durationTicks: 18, pierce: 1, chainTargets: 14 },
      },
      'black-dragon-chain': {
        first: { cooldownTicks: 104, damage: 26, amount: 2, area: 520, durationTicks: 190, pierce: 7, chainTargets: 0 },
        maximum: { cooldownTicks: 84, damage: 58, amount: 3, area: 740, durationTicks: 278, pierce: 15, chainTargets: 0 },
      },
    });

    const evolutionBudget = Object.fromEntries(tusinSurvivalPack.evolutions.map((evolution) => [
      evolution.id,
      {
        cooldownTicks: evolution.tuning.cooldownTicks,
        damage: evolution.tuning.damage,
        amount: evolution.tuning.amount,
        area: evolution.tuning.area,
        speedPerTick: evolution.tuning.speedPerTick,
        durationTicks: evolution.tuning.durationTicks,
        pierce: evolution.tuning.pierce,
        chainTargets: evolution.tuning.chainTargets,
      },
    ]));

    expect(evolutionBudget).toEqual({
      'iron-wall-sword-path': { cooldownTicks: 20, damage: 120, amount: 2, area: 1200, speedPerTick: 1, durationTicks: 16, pierce: 24, chainTargets: 0 },
      'swift-cloud-dragon': { cooldownTicks: 42, damage: 88, amount: 3, area: 760, speedPerTick: 240, durationTicks: 120, pierce: 14, chainTargets: 0 },
      'purifying-light-sword': { cooldownTicks: 46, damage: 58, amount: 9, area: 620, speedPerTick: 300, durationTicks: 330, pierce: 8, chainTargets: 0 },
      requiem: { cooldownTicks: 68, damage: 250, amount: 2, area: 900, speedPerTick: 260, durationTicks: 110, pierce: 32, chainTargets: 0 },
      'regression-thunder': { cooldownTicks: 50, damage: 105, amount: 2, area: 760, speedPerTick: 1, durationTicks: 54, pierce: 1, chainTargets: 15 },
      'last-dragon-shackle': { cooldownTicks: 72, damage: 82, amount: 4, area: 1050, speedPerTick: 480, durationTicks: 320, pierce: 18, chainTargets: 6 },
    });
  });
});

describe('geometricTestPack', () => {
  it('동일한 공용 계약을 통과하면서 IP 팩에 의존하지 않는다', () => {
    const enginePacks: ContentPack[] = [tusinSurvivalPack, geometricTestPack];

    expect(enginePacks).toHaveLength(2);
    expect(validateContentPack(geometricTestPack)).toEqual([]);
    expect(geometricTestPack.simulation).toEqual(tusinSurvivalPack.simulation);
    expect(geometricTestPack.slotRules).toEqual(tusinSurvivalPack.slotRules);

    const source = readFileSync(new URL('./geometric.ts', import.meta.url), 'utf8');
    expect(source).not.toMatch(/from\s+['"][^'"]*tusin[^'"]*['"]/i);
    expect(JSON.stringify(geometricTestPack)).not.toMatch(/제피르|마신군|투신전생기/);
  });
});
