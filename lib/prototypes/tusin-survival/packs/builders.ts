import type {
  ActiveLevelDefinition,
  CombatTuning,
  PassiveLevelDefinition,
  PassiveModifier,
  ProvenanceClass,
  ProvenanceRecord,
  ProvenancedText,
  TextReviewStatus,
} from './types';

export function provenance(
  provenanceClass: ProvenanceClass,
  sourceId: string,
  sourceUrl: string,
  sourceNote: string,
  originalDesignNotes: string,
): ProvenanceRecord {
  return {
    class: provenanceClass,
    sourceId,
    sourceUrl,
    sourceNote,
    reviewedAt: '2026-08-14',
    reviewer: 'prototype-content-review',
    originalDesignNotes,
  };
}

export function copy(
  value: string,
  records: ProvenanceRecord[],
  status: TextReviewStatus = 'reviewed-prototype',
): ProvenancedText {
  return { text: value, status, provenance: records };
}

function valueAt(base: number, delta: number, index: number, minimum = 0): number {
  return Math.max(minimum, Math.round((base + delta * index) * 100) / 100);
}

export function activeLevels(
  label: string,
  source: ProvenanceRecord[],
  base: CombatTuning,
  delta: Partial<CombatTuning>,
  count = 5,
): ActiveLevelDefinition[] {
  return Array.from({ length: count }, (_, index) => {
    const tuning: CombatTuning = {
      cooldownTicks: valueAt(base.cooldownTicks, delta.cooldownTicks ?? 0, index, 1),
      damage: valueAt(base.damage, delta.damage ?? 0, index),
      amount: valueAt(base.amount, delta.amount ?? 0, index, 1),
      area: valueAt(base.area, delta.area ?? 0, index, 1),
      speedPerTick: valueAt(base.speedPerTick, delta.speedPerTick ?? 0, index),
      durationTicks: valueAt(base.durationTicks, delta.durationTicks ?? 0, index, 1),
      pierce: valueAt(base.pierce, delta.pierce ?? 0, index),
      chainTargets: valueAt(base.chainTargets, delta.chainTargets ?? 0, index),
      knockback: valueAt(base.knockback, delta.knockback ?? 0, index),
    };

    return {
      level: index + 1,
      tuning,
      effect: copy(
        `${label} ${index + 1}단계 · 피해 ${tuning.damage}, 발동 주기 ${tuning.cooldownTicks}틱`,
        source,
      ),
    };
  });
}

export function passiveLevels(
  label: string,
  source: ProvenanceRecord[],
  modifiersByLevel: PassiveModifier[][],
): PassiveLevelDefinition[] {
  return modifiersByLevel.map((modifiers, index) => ({
    level: index + 1,
    modifiers,
    effect: copy(
      `${label} ${index + 1}단계 · ${modifiers
        .map((modifier) => `${modifier.stat} ${modifier.value >= 0 ? '+' : ''}${modifier.value}`)
        .join(', ')}`,
      source,
    ),
  }));
}

export function buildXpThresholds(
  maxLevel: number,
  base: number,
  linear: number,
  quadraticNumerator: number,
  quadraticDenominator: number,
): number[] {
  let cumulativeXp = 0;
  return Array.from({ length: Math.max(0, maxLevel - 1) }, (_, index) => {
    cumulativeXp += Math.ceil(
      base + linear * index + (quadraticNumerator * index * index) / quadraticDenominator,
    );
    return cumulativeXp;
  });
}
