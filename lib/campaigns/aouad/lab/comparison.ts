import {
  isLastBellCompletionRecord,
  type LastBellCompletionRecord,
} from '@/lib/prototypes/last-bell/completion';

export const AOUAD_COMPARISON_SCHEMA_VERSION = 1 as const;
export const AOUAD_COMPARISON_STORAGE_KEY_PREFIX = 'icons:aouad-comparison:v1:';

export const AOUAD_COMPARISON_CANDIDATE_IDS = [
  'last-bell',
  'infection-record',
  'survival-arcade',
] as const;

export type AouadComparisonCandidateId = (typeof AOUAD_COMPARISON_CANDIDATE_IDS)[number];

export type AouadComparisonResult = {
  schemaVersion: 1;
  authority: 'local-prototype';
  rewardEligible: false;
  candidateId: AouadComparisonCandidateId;
  runId: string;
  startedAt: string;
  completedAt: string;
  activeDurationMs: number;
  retryCount: number;
  resultType: string;
};

export type AouadComparisonStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

const candidateIds = new Set<string>(AOUAD_COMPARISON_CANDIDATE_IDS);
const comparisonResultKeys = [
  'schemaVersion',
  'authority',
  'rewardEligible',
  'candidateId',
  'runId',
  'startedAt',
  'completedAt',
  'activeDurationMs',
  'retryCount',
  'resultType',
] as const;

function isTimestamp(value: unknown): value is string {
  return typeof value === 'string' && Number.isFinite(Date.parse(value));
}

function isNonNegativeFinite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

export function isAouadComparisonCandidateId(value: unknown): value is AouadComparisonCandidateId {
  return typeof value === 'string' && candidateIds.has(value);
}

export function comparisonStorageKey(candidateId: AouadComparisonCandidateId): string {
  return `${AOUAD_COMPARISON_STORAGE_KEY_PREFIX}${candidateId}`;
}

export function isAouadComparisonResult(value: unknown): value is AouadComparisonResult {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const candidate = value as Partial<AouadComparisonResult>;
  const keys = Object.keys(candidate);
  if (keys.length !== comparisonResultKeys.length || keys.some((key) => !comparisonResultKeys.includes(key as typeof comparisonResultKeys[number]))) return false;
  return candidate.schemaVersion === AOUAD_COMPARISON_SCHEMA_VERSION
    && candidate.authority === 'local-prototype'
    && candidate.rewardEligible === false
    && isAouadComparisonCandidateId(candidate.candidateId)
    && typeof candidate.runId === 'string'
    && candidate.runId.length >= 8
    && candidate.runId.length <= 120
    && isTimestamp(candidate.startedAt)
    && isTimestamp(candidate.completedAt)
    && Date.parse(candidate.completedAt) >= Date.parse(candidate.startedAt)
    && isNonNegativeFinite(candidate.activeDurationMs)
    && typeof candidate.retryCount === 'number'
    && Number.isInteger(candidate.retryCount)
    && candidate.retryCount >= 0
    && typeof candidate.resultType === 'string'
    && /^[a-z0-9-]{2,48}$/.test(candidate.resultType);
}

export function createAouadComparisonResult(
  input: Omit<AouadComparisonResult, 'schemaVersion' | 'authority' | 'rewardEligible'>,
): AouadComparisonResult {
  return {
    schemaVersion: AOUAD_COMPARISON_SCHEMA_VERSION,
    authority: 'local-prototype',
    rewardEligible: false,
    ...input,
    activeDurationMs: Math.max(0, Math.round(input.activeDurationMs)),
  };
}

export function saveAouadComparisonResult(
  storage: AouadComparisonStorage,
  result: AouadComparisonResult,
): AouadComparisonResult | null {
  if (!isAouadComparisonResult(result)) return null;
  try {
    storage.setItem(comparisonStorageKey(result.candidateId), JSON.stringify(result));
    return result;
  } catch {
    return null;
  }
}

export function loadAouadComparisonResult(
  storage: AouadComparisonStorage,
  candidateId: AouadComparisonCandidateId,
): AouadComparisonResult | null {
  const key = comparisonStorageKey(candidateId);
  try {
    const raw = storage.getItem(key);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!isAouadComparisonResult(parsed) || parsed.candidateId !== candidateId) throw new Error('invalid comparison result');
    return parsed;
  } catch {
    try { storage.removeItem(key); } catch { /* local-only presentation is optional */ }
    return null;
  }
}

export function clearAouadComparisonResult(
  storage: AouadComparisonStorage,
  candidateId: AouadComparisonCandidateId,
): void {
  try { storage.removeItem(comparisonStorageKey(candidateId)); } catch { /* local-only presentation is optional */ }
}

/** Maps an existing local Last Bell record into the same G2 scoring contract. */
export function comparisonResultFromLastBell(
  record: LastBellCompletionRecord,
): AouadComparisonResult | null {
  if (!isLastBellCompletionRecord(record)) return null;
  return createAouadComparisonResult({
    candidateId: 'last-bell',
    runId: record.runId,
    startedAt: record.startedAt,
    completedAt: record.completedAt,
    activeDurationMs: record.activeDurationMs,
    retryCount: record.retryCount,
    resultType: `escaped-${record.routeId}`,
  });
}
