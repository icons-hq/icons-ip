import { describe, expect, it } from 'vitest';

import { geometricTestPack } from './packs/geometric';
import { tusinSurvivalPack } from './packs/tusin';
import {
  PHYSICAL_REWARDS_ENABLED,
  evaluateMockRewards,
  type MockRewardEvidence,
} from './rewards';

const emptyRun: MockRewardEvidence = {
  verified: true,
  rawScore: 9_999,
  defeatedBossIds: [],
  finalBossCleared: false,
  clearTick: null,
  bossSplitTicks: null,
  leaderboardRank: null,
  debug: false,
};

function evaluate(evidence: MockRewardEvidence) {
  return evaluateMockRewards(tusinSurvivalPack.mockRewards, evidence);
}

describe('evaluateMockRewards', () => {
  it('replay 검증이 끝나지 않은 런은 모든 모의 보상에서 fail closed한다', () => {
    const result = evaluate({
      ...emptyRun,
      rawScore: 99_999,
      verified: false,
    } as MockRewardEvidence);

    expect(result).toEqual({
      physicalRewardsEnabled: false,
      awards: [],
      excluded: true,
      exclusionReason: 'unverified_run',
    });
  });

  it('보상 조건이 없으면 실제 지급을 닫은 빈 모의 결과를 반환한다', () => {
    const result = evaluate(emptyRun);

    expect(PHYSICAL_REWARDS_ENABLED).toBe(false);
    expect(result).toEqual({
      physicalRewardsEnabled: false,
      awards: [],
      excluded: false,
      exclusionReason: null,
    });
  });

  it('팩이 정의한 점수 임계값과 서로 다른 문구를 순서대로 누적한다', () => {
    const result = evaluate({ ...emptyRun, rawScore: 25_000 });

    expect(result.awards).toEqual([
      {
        rule: 'SCORE_BRONZE',
        rewardKind: 'digital_mock',
        label: '테스트 디지털 카드 + 프로필 배지',
        notice: '테스트 보상 · 실제 지급되지 않음',
        provisional: false,
        reviewStatus: 'not_required',
        fulfillmentStatus: 'disabled',
        evidence: { rawScore: 25_000, threshold: 10_000 },
      },
      {
        rule: 'SCORE_SILVER',
        rewardKind: 'digital_mock',
        label: '테스트 상위 디지털 카드 + 프로필 배지',
        notice: '테스트 보상 · 실제 지급되지 않음',
        provisional: false,
        reviewStatus: 'not_required',
        fulfillmentStatus: 'disabled',
        evidence: { rawScore: 25_000, threshold: 25_000 },
      },
    ]);
  });

  it('두 번째 중간보스만 처치하면 첫 보상은 주지 않고 해당 보상만 준다', () => {
    const result = evaluate({
      ...emptyRun,
      defeatedBossIds: ['midboss-siege-mage'],
    });

    expect(result.awards).toEqual([
      {
        rule: 'MIDBOSS_TWO',
        rewardKind: 'purchase_access_mock',
        label: '테스트 한정 굿즈 구매 접근권',
        notice: '테스트 보상 · 실제 지급되지 않음',
        provisional: false,
        reviewStatus: 'not_required',
        fulfillmentStatus: 'disabled',
        evidence: { bossId: 'midboss-siege-mage' },
      },
    ]);
  });

  it('두 중간보스의 정확한 ID가 있으면 각 구매 접근권을 별도로 누적한다', () => {
    const result = evaluate({
      ...emptyRun,
      defeatedBossIds: ['midboss-abyss-captain', 'midboss-siege-mage'],
    });

    expect(result.awards.map((award) => award.rule)).toEqual([
      'MIDBOSS_ONE',
      'MIDBOSS_TWO',
    ]);
  });

  it('유효한 최종보스 클리어 기록에는 팩의 24시간 정가 구매권 모의를 추가한다', () => {
    const result = evaluate({
      ...emptyRun,
      defeatedBossIds: ['final-boss-demon-vanguard'],
      finalBossCleared: true,
      clearTick: 25_800,
      bossSplitTicks: 4_200,
    });

    expect(result.awards).toEqual([
      {
        rule: 'FINAL_BOSS',
        rewardKind: 'purchase_access_mock',
        label: '테스트 재고보장 정가 구매권(24시간)',
        notice: '테스트 보상 · 실제 지급되지 않음',
        provisional: false,
        reviewStatus: 'not_required',
        fulfillmentStatus: 'disabled',
        evidence: {
          bossId: 'final-boss-demon-vanguard',
          clearTick: 25_800,
          bossSplitTicks: 4_200,
          durationHours: 24,
        },
      },
    ]);
  });

  it('Top-N 클리어는 팩 임계값과 검수 기간을 사용한 잠정 실물 굿즈 후보만 만든다', () => {
    const result = evaluate({
      ...emptyRun,
      defeatedBossIds: ['final-boss-demon-vanguard'],
      finalBossCleared: true,
      clearTick: 25_800,
      bossSplitTicks: 4_200,
      leaderboardRank: 3,
    });

    expect(result.awards.at(-1)).toEqual({
      rule: 'SPEEDRUN_TOP_N',
      rewardKind: 'physical_goods_candidate_mock',
      label: '테스트 무료 실물 굿즈 후보 · 잠정',
      notice: '테스트 보상 · 실제 지급되지 않음',
      provisional: true,
      reviewStatus: 'manual_review',
      fulfillmentStatus: 'disabled',
      evidence: {
        bossId: 'final-boss-demon-vanguard',
        clearTick: 25_800,
        bossSplitTicks: 4_200,
        rank: 3,
        topN: 10,
        reviewWindowHours: 72,
        claimWindowDays: 7,
        unclaimedPolicy: 'next-ranked',
        shippingPayer: 'operator',
      },
    });
  });

  it('팩을 바꾸면 evaluator 코드 변경 없이 해당 팩의 임계값과 문구를 사용한다', () => {
    const result = evaluateMockRewards(geometricTestPack.mockRewards, {
      ...emptyRun,
      rawScore: 10_000,
    });

    expect(result.awards).toHaveLength(1);
    expect(result.awards[0]).toMatchObject({
      rule: 'SCORE_BRONZE',
      label: '테스트 점수 표식',
      evidence: { threshold: 10_000 },
    });
  });

  it('검증되지 않은 알 수 없는 reward kind는 evaluator에서도 보상 없음으로 닫는다', () => {
    const invalidProgram = structuredClone(tusinSurvivalPack.mockRewards);
    Object.assign(invalidProgram[0]!, { rewardKind: 'physical_goods' });

    const result = evaluateMockRewards(invalidProgram, {
      ...emptyRun,
      rawScore: 99_999,
    });

    expect(result.awards.map((award) => award.rule)).not.toContain('SCORE_BRONZE');
    expect(result.physicalRewardsEnabled).toBe(false);
  });

  it('디버그 런은 모든 조건을 충족해도 leaderboard와 모의 보상에서 제외한다', () => {
    const result = evaluate({
      verified: true,
      rawScore: 99_999,
      defeatedBossIds: [
        'midboss-abyss-captain',
        'midboss-siege-mage',
        'final-boss-demon-vanguard',
      ],
      finalBossCleared: true,
      clearTick: 24_000,
      bossSplitTicks: 2_400,
      leaderboardRank: 1,
      debug: true,
    });

    expect(result).toEqual({
      physicalRewardsEnabled: false,
      awards: [],
      excluded: true,
      exclusionReason: 'debug_run',
    });
  });

  it('같은 정상 런 입력은 여섯 규칙을 중복 없이 팩 순서대로 누적한다', () => {
    const evidence: MockRewardEvidence = {
      verified: true,
      rawScore: 25_000,
      defeatedBossIds: [
        'midboss-abyss-captain',
        'midboss-siege-mage',
        'final-boss-demon-vanguard',
      ],
      finalBossCleared: true,
      clearTick: 25_800,
      bossSplitTicks: 4_200,
      leaderboardRank: 3,
      debug: false,
    };

    const first = evaluate(evidence);
    const second = evaluate(evidence);
    const rules = first.awards.map((award) => award.rule);

    expect(second).toEqual(first);
    expect(rules).toEqual([
      'SCORE_BRONZE',
      'SCORE_SILVER',
      'MIDBOSS_ONE',
      'MIDBOSS_TWO',
      'FINAL_BOSS',
      'SPEEDRUN_TOP_N',
    ]);
    expect(new Set(rules).size).toBe(6);
  });
});
