import {
  MOCK_REWARD_KINDS,
  type MockRewardKind,
  type MockRewardProgram,
  type MockRewardReviewStatus,
  type MockRewardRule,
} from './packs/types';

export const PHYSICAL_REWARDS_ENABLED = false as const;

export interface MockRewardEvidence {
  readonly verified: boolean;
  readonly rawScore: number;
  readonly defeatedBossIds: readonly string[];
  readonly finalBossCleared: boolean;
  readonly clearTick: number | null;
  readonly bossSplitTicks: number | null;
  readonly leaderboardRank: number | null;
  readonly debug: boolean;
}

export interface MockAward {
  readonly rule: string;
  readonly rewardKind: MockRewardKind;
  readonly label: string;
  readonly notice: string;
  readonly provisional: boolean;
  readonly reviewStatus: MockRewardReviewStatus;
  readonly fulfillmentStatus: 'disabled';
  readonly evidence: Readonly<Record<string, number | string>>;
}

export interface MockRewardResult {
  readonly physicalRewardsEnabled: false;
  readonly awards: readonly MockAward[];
  readonly excluded: boolean;
  readonly exclusionReason: 'debug_run' | 'unverified_run' | null;
}

const REQUIRED_MOCK_NOTICE = '테스트 보상 · 실제 지급되지 않음';
const mockRewardKinds = new Set<string>(MOCK_REWARD_KINDS);
const reviewStatuses = new Set<string>(['not_required', 'manual_review']);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isPositiveInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && typeof value === 'number' && value > 0;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function hasRunnableCondition(condition: unknown): boolean {
  if (!isRecord(condition) || !isNonEmptyString(condition.kind)) return false;

  switch (condition.kind) {
    case 'score':
      return isPositiveInteger(condition.minimum);
    case 'midboss':
      return isNonEmptyString(condition.bossId);
    case 'final-boss':
      return (
        isNonEmptyString(condition.bossId) &&
        isPositiveInteger(condition.purchaseWindowHours)
      );
    case 'speedrun':
      return (
        isNonEmptyString(condition.bossId) &&
        isPositiveInteger(condition.provisionalTopN) &&
        isPositiveInteger(condition.reviewWindowHours) &&
        isPositiveInteger(condition.claimWindowDays) &&
        condition.unclaimedPolicy === 'next-ranked' &&
        condition.shippingPayer === 'operator'
      );
    default:
      return false;
  }
}

function isRunnableRule(value: unknown): value is MockRewardRule {
  if (!isRecord(value)) return false;
  if (
    !isNonEmptyString(value.id) ||
    !isNonEmptyString(value.rewardKind) ||
    !mockRewardKinds.has(value.rewardKind) ||
    typeof value.provisional !== 'boolean' ||
    !isNonEmptyString(value.reviewStatus) ||
    !reviewStatuses.has(value.reviewStatus) ||
    value.provisional !== (value.reviewStatus === 'manual_review') ||
    !isRecord(value.label) ||
    !isNonEmptyString(value.label.text) ||
    !isRecord(value.notice) ||
    value.notice.text !== REQUIRED_MOCK_NOTICE
  ) {
    return false;
  }
  return hasRunnableCondition(value.condition);
}

function getClearTiming(
  evidence: MockRewardEvidence,
): { clearTick: number; bossSplitTicks: number } | null {
  if (
    !isPositiveInteger(evidence.clearTick) ||
    !isPositiveInteger(evidence.bossSplitTicks) ||
    evidence.bossSplitTicks > evidence.clearTick
  ) {
    return null;
  }
  return {
    clearTick: evidence.clearTick,
    bossSplitTicks: evidence.bossSplitTicks,
  };
}

function baseAward(rule: MockRewardRule) {
  return {
    rule: rule.id,
    rewardKind: rule.rewardKind,
    label: rule.label.text,
    notice: rule.notice.text,
    provisional: rule.provisional,
    reviewStatus: rule.reviewStatus,
    fulfillmentStatus: 'disabled',
  } as const;
}

export function evaluateMockRewards(
  rewardProgram: MockRewardProgram,
  evidence: MockRewardEvidence,
): MockRewardResult {
  if (evidence.debug) {
    return {
      physicalRewardsEnabled: PHYSICAL_REWARDS_ENABLED,
      awards: [],
      excluded: true,
      exclusionReason: 'debug_run',
    };
  }
  if (!evidence.verified) {
    return {
      physicalRewardsEnabled: PHYSICAL_REWARDS_ENABLED,
      awards: [],
      excluded: true,
      exclusionReason: 'unverified_run',
    };
  }

  const awards: MockAward[] = [];
  const awardedRuleIds = new Set<string>();
  const defeatedBossIds = new Set(
    Array.isArray(evidence.defeatedBossIds)
      ? evidence.defeatedBossIds.filter(isNonEmptyString)
      : [],
  );
  const clearTiming = getClearTiming(evidence);

  for (const candidate of Array.isArray(rewardProgram) ? rewardProgram : []) {
    if (!isRunnableRule(candidate) || awardedRuleIds.has(candidate.id)) continue;

    const condition = candidate.condition;
    let award: MockAward | null = null;

    switch (condition.kind) {
      case 'score':
        if (
          Number.isSafeInteger(evidence.rawScore) &&
          evidence.rawScore >= condition.minimum
        ) {
          award = {
            ...baseAward(candidate),
            evidence: {
              rawScore: evidence.rawScore,
              threshold: condition.minimum,
            },
          };
        }
        break;
      case 'midboss':
        if (defeatedBossIds.has(condition.bossId)) {
          award = {
            ...baseAward(candidate),
            evidence: { bossId: condition.bossId },
          };
        }
        break;
      case 'final-boss':
        if (
          evidence.finalBossCleared &&
          clearTiming &&
          defeatedBossIds.has(condition.bossId)
        ) {
          award = {
            ...baseAward(candidate),
            evidence: {
              bossId: condition.bossId,
              clearTick: clearTiming.clearTick,
              bossSplitTicks: clearTiming.bossSplitTicks,
              durationHours: condition.purchaseWindowHours,
            },
          };
        }
        break;
      case 'speedrun':
        if (
          evidence.finalBossCleared &&
          clearTiming &&
          defeatedBossIds.has(condition.bossId) &&
          isPositiveInteger(evidence.leaderboardRank) &&
          evidence.leaderboardRank <= condition.provisionalTopN
        ) {
          award = {
            ...baseAward(candidate),
            evidence: {
              bossId: condition.bossId,
              clearTick: clearTiming.clearTick,
              bossSplitTicks: clearTiming.bossSplitTicks,
              rank: evidence.leaderboardRank,
              topN: condition.provisionalTopN,
              reviewWindowHours: condition.reviewWindowHours,
              claimWindowDays: condition.claimWindowDays,
              unclaimedPolicy: condition.unclaimedPolicy,
              shippingPayer: condition.shippingPayer,
            },
          };
        }
        break;
    }

    if (award) {
      awardedRuleIds.add(candidate.id);
      awards.push(award);
    }
  }

  return {
    physicalRewardsEnabled: PHYSICAL_REWARDS_ENABLED,
    awards,
    excluded: false,
    exclusionReason: null,
  };
}
