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
