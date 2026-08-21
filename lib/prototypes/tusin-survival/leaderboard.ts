export interface LeaderboardRecord {
  readonly id: string;
  readonly seed: string;
  readonly rawScore: number;
  readonly clear: boolean;
  readonly bossSplitTicks: number | null;
  readonly completionTicks: number;
  /** Unix epoch milliseconds. */
  readonly recordedAt: number;
  readonly debug: boolean;
}

export const DEFAULT_LOCAL_LEADERBOARD_CAP = 100;

const RECORD_KEYS = new Set<keyof LeaderboardRecord>([
  'id',
  'seed',
  'rawScore',
  'clear',
  'bossSplitTicks',
  'completionTicks',
  'recordedAt',
  'debug',
]);

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isNonNegativeSafeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && typeof value === 'number' && value >= 0;
}

function hasOnlyRecordKeys(value: object): boolean {
  const keys = Object.keys(value);

  return keys.length === RECORD_KEYS.size && keys.every((key) => RECORD_KEYS.has(key as keyof LeaderboardRecord));
}

function isLeaderboardRecord(value: unknown): value is LeaderboardRecord {
  if (typeof value !== 'object' || value === null || !hasOnlyRecordKeys(value)) {
    return false;
  }

  const candidate = value as Record<keyof LeaderboardRecord, unknown>;
  const bossSplitTicks = candidate.bossSplitTicks;
  const completionTicks = candidate.completionTicks;

  if (
    !isNonEmptyString(candidate.id) ||
    !isNonEmptyString(candidate.seed) ||
    !isNonNegativeSafeInteger(candidate.rawScore) ||
    typeof candidate.clear !== 'boolean' ||
    (bossSplitTicks !== null && !isNonNegativeSafeInteger(bossSplitTicks)) ||
    !isNonNegativeSafeInteger(completionTicks) ||
    !isNonNegativeSafeInteger(candidate.recordedAt) ||
    typeof candidate.debug !== 'boolean'
  ) {
    return false;
  }

  if (!candidate.clear && bossSplitTicks !== null) {
    return false;
  }

  return bossSplitTicks === null || bossSplitTicks <= completionTicks;
}

function hasUniqueIds(records: readonly LeaderboardRecord[]): boolean {
  return new Set(records.map(({ id }) => id)).size === records.length;
}

function isRecordCollection(value: unknown): value is LeaderboardRecord[] {
  return (
    Array.isArray(value) &&
    value.every(isLeaderboardRecord) &&
    hasUniqueIds(value)
  );
}

function compareAscending(left: number, right: number): number {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

function compareDescending(left: number, right: number): number {
  return compareAscending(right, left);
}

function compareIds(left: string, right: string): number {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

function compareNullableTicks(
  left: number | null,
  right: number | null,
): number {
  if (left === null) return right === null ? 0 : 1;
  if (right === null) return -1;
  return compareAscending(left, right);
}

export function rankScoreRecords(
  records: readonly LeaderboardRecord[],
): LeaderboardRecord[] {
  return records
    .filter(({ debug }) => !debug)
    .slice()
    .sort((left, right) => {
      return (
        compareDescending(left.rawScore, right.rawScore) ||
        compareDescending(Number(left.clear), Number(right.clear)) ||
        compareNullableTicks(left.bossSplitTicks, right.bossSplitTicks) ||
        compareAscending(left.completionTicks, right.completionTicks) ||
        compareAscending(left.recordedAt, right.recordedAt) ||
        compareIds(left.id, right.id)
      );
    });
}

export function rankSpeedrunRecords(
  records: readonly LeaderboardRecord[],
): LeaderboardRecord[] {
  return records
    .filter(
      (record): record is LeaderboardRecord & { bossSplitTicks: number } =>
        !record.debug && record.clear && record.bossSplitTicks !== null,
    )
    .slice()
    .sort((left, right) => {
      return (
        compareAscending(left.bossSplitTicks, right.bossSplitTicks) ||
        compareDescending(left.rawScore, right.rawScore) ||
        compareAscending(left.completionTicks, right.completionTicks) ||
        compareAscending(left.recordedAt, right.recordedAt) ||
        compareIds(left.id, right.id)
      );
    });
}

/** Parses untrusted local persistence data; any malformed member rejects the lot. */
export function parseLeaderboardRecords(
  serialized: string | null | undefined,
): LeaderboardRecord[] {
  if (typeof serialized !== 'string') return [];

  try {
    const parsed: unknown = JSON.parse(serialized);
    return isRecordCollection(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/** Keeps input order and discards the oldest entries at the front. */
export function capLeaderboardRecords(
  records: readonly LeaderboardRecord[],
  cap = DEFAULT_LOCAL_LEADERBOARD_CAP,
): LeaderboardRecord[] {
  if (!isRecordCollection(records) || !isNonNegativeSafeInteger(cap)) {
    return [];
  }

  if (cap === 0) return [];
  return records.slice(-cap);
}

/** Appends one unique record and applies the bounded local history cap. */
export function appendLeaderboardRecord(
  records: readonly LeaderboardRecord[],
  record: LeaderboardRecord,
  cap = DEFAULT_LOCAL_LEADERBOARD_CAP,
): LeaderboardRecord[] {
  if (
    !isRecordCollection(records) ||
    !isLeaderboardRecord(record) ||
    records.some(({ id }) => id === record.id)
  ) {
    return [];
  }

  return capLeaderboardRecords([...records, record], cap);
}
