import type { LastBellRouteId } from './state';

export const LAST_BELL_COMPLETION_KEY = 'icons:last-bell:completion:v1';
export const LAST_BELL_COMPLETION_SCHEMA_VERSION = 1;
export const LAST_BELL_LOCAL_SEED = 4101;
export const LAST_BELL_GENERATOR_VERSION = 'procedural-ch1-v1';

export type LastBellPlayStyle = 'listener' | 'shadow' | 'runner' | 'resilient';

/**
 * This record is intentionally local-only. It can decorate the AOUAD popup,
 * but cannot unlock rewards, commerce, account history, or a leaderboard.
 */
export type LastBellCompletionRecord = {
  schemaVersion: 1;
  authority: 'local-prototype';
  leaderboardEligible: false;
  runId: string;
  chapterId: 'chapter-01';
  seed: number;
  generatorVersion: string;
  routeId: LastBellRouteId;
  startedAt: string;
  completedAt: string;
  activeDurationMs: number;
  retryCount: number;
  captureCount: number;
  result: 'escaped';
  playStyle: LastBellPlayStyle;
};

export type LastBellRunMetrics = {
  runId: string;
  startedAt: string;
  seed: number;
  generatorVersion: string;
  activeDurationMs: number;
  retryCount: number;
  captureCount: number;
  listeningDurationMs: number;
  hidingDurationMs: number;
  runningDurationMs: number;
};

export type LastBellMetricFlags = {
  listening: boolean;
  hiding: boolean;
  running: boolean;
};

export type LastBellCompletionStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

const PLAY_STYLES = new Set<LastBellPlayStyle>(['listener', 'shadow', 'runner', 'resilient']);
const ROUTE_IDS = new Set<LastBellRouteId>(['central', 'rear', 'systems']);
const COMPLETION_KEYS = [
  'schemaVersion',
  'authority',
  'leaderboardEligible',
  'runId',
  'chapterId',
  'seed',
  'generatorVersion',
  'routeId',
  'startedAt',
  'completedAt',
  'activeDurationMs',
  'retryCount',
  'captureCount',
  'result',
  'playStyle',
] as const;

function isIsoDate(value: unknown): value is string {
  return typeof value === 'string' && Number.isFinite(Date.parse(value));
}

function isNonNegativeDuration(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function isCount(value: unknown): value is number {
  return isNonNegativeDuration(value) && Number.isInteger(value);
}

function isMetrics(value: unknown): value is LastBellRunMetrics {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const candidate = value as Partial<LastBellRunMetrics>;
  return typeof candidate.runId === 'string'
    && candidate.runId.length > 0
    && isIsoDate(candidate.startedAt)
    && typeof candidate.seed === 'number'
    && Number.isFinite(candidate.seed)
    && typeof candidate.generatorVersion === 'string'
    && candidate.generatorVersion.length > 0
    && isNonNegativeDuration(candidate.activeDurationMs)
    && isCount(candidate.retryCount)
    && isCount(candidate.captureCount)
    && isNonNegativeDuration(candidate.listeningDurationMs)
    && isNonNegativeDuration(candidate.hidingDurationMs)
    && isNonNegativeDuration(candidate.runningDurationMs);
}

export function isLastBellRunMetrics(value: unknown): value is LastBellRunMetrics {
  return isMetrics(value);
}

export function createLastBellRunMetrics({
  runId,
  startedAt,
  seed = LAST_BELL_LOCAL_SEED,
  generatorVersion = LAST_BELL_GENERATOR_VERSION,
}: Pick<LastBellRunMetrics, 'runId' | 'startedAt'> & Partial<Pick<LastBellRunMetrics, 'seed' | 'generatorVersion'>>): LastBellRunMetrics {
  return {
    runId,
    startedAt,
    seed,
    generatorVersion,
    activeDurationMs: 0,
    retryCount: 0,
    captureCount: 0,
    listeningDurationMs: 0,
    hidingDurationMs: 0,
    runningDurationMs: 0,
  };
}

/** Advance only from the fixed simulation step so render cadence cannot alter a result. */
export function advanceLastBellRunMetrics(
  metrics: LastBellRunMetrics,
  durationMs: number,
  flags: LastBellMetricFlags,
): LastBellRunMetrics {
  if (!Number.isFinite(durationMs) || durationMs <= 0) return metrics;
  return {
    ...metrics,
    activeDurationMs: metrics.activeDurationMs + durationMs,
    listeningDurationMs: metrics.listeningDurationMs + (flags.listening ? durationMs : 0),
    hidingDurationMs: metrics.hidingDurationMs + (flags.hiding ? durationMs : 0),
    runningDurationMs: metrics.runningDurationMs + (flags.running ? durationMs : 0),
  };
}

export function recordLastBellCapture(metrics: LastBellRunMetrics): LastBellRunMetrics {
  return { ...metrics, captureCount: metrics.captureCount + 1 };
}

export function recordLastBellRetry(metrics: LastBellRunMetrics): LastBellRunMetrics {
  return { ...metrics, retryCount: metrics.retryCount + 1 };
}

export function lastBellPlayStyleFor(metrics: LastBellRunMetrics): LastBellPlayStyle {
  if (metrics.captureCount >= 2 || metrics.retryCount >= 2) return 'resilient';
  if (metrics.listeningDurationMs >= metrics.hidingDurationMs && metrics.listeningDurationMs >= metrics.runningDurationMs) return 'listener';
  if (metrics.hidingDurationMs >= metrics.runningDurationMs) return 'shadow';
  return 'runner';
}

export function createLastBellCompletionRecord(
  metrics: LastBellRunMetrics,
  routeId: LastBellRouteId,
  completedAt: string,
): LastBellCompletionRecord {
  return {
    schemaVersion: LAST_BELL_COMPLETION_SCHEMA_VERSION,
    authority: 'local-prototype',
    leaderboardEligible: false,
    runId: metrics.runId,
    chapterId: 'chapter-01',
    seed: metrics.seed,
    generatorVersion: metrics.generatorVersion,
    routeId,
    startedAt: metrics.startedAt,
    completedAt,
    activeDurationMs: Math.round(metrics.activeDurationMs),
    retryCount: metrics.retryCount,
    captureCount: metrics.captureCount,
    result: 'escaped',
    playStyle: lastBellPlayStyleFor(metrics),
  };
}

export function isLastBellCompletionRecord(value: unknown): value is LastBellCompletionRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const candidate = value as Partial<LastBellCompletionRecord>;
  const keys = Object.keys(candidate);
  if (keys.length !== COMPLETION_KEYS.length || keys.some((key) => !COMPLETION_KEYS.includes(key as typeof COMPLETION_KEYS[number]))) return false;
  return candidate.schemaVersion === LAST_BELL_COMPLETION_SCHEMA_VERSION
    && candidate.authority === 'local-prototype'
    && candidate.leaderboardEligible === false
    && typeof candidate.runId === 'string'
    && candidate.runId.length > 0
    && candidate.chapterId === 'chapter-01'
    && typeof candidate.seed === 'number'
    && Number.isFinite(candidate.seed)
    && typeof candidate.generatorVersion === 'string'
    && candidate.generatorVersion.length > 0
    && typeof candidate.routeId === 'string'
    && ROUTE_IDS.has(candidate.routeId as LastBellRouteId)
    && isIsoDate(candidate.startedAt)
    && isIsoDate(candidate.completedAt)
    && Date.parse(candidate.completedAt) >= Date.parse(candidate.startedAt)
    && isNonNegativeDuration(candidate.activeDurationMs)
    && isCount(candidate.retryCount)
    && isCount(candidate.captureCount)
    && candidate.result === 'escaped'
    && typeof candidate.playStyle === 'string'
    && PLAY_STYLES.has(candidate.playStyle as LastBellPlayStyle);
}

export function saveLastBellCompletion(
  storage: LastBellCompletionStorage,
  record: LastBellCompletionRecord,
): LastBellCompletionRecord | null {
  if (!isLastBellCompletionRecord(record)) return null;
  try {
    storage.setItem(LAST_BELL_COMPLETION_KEY, JSON.stringify(record));
    return record;
  } catch {
    return null;
  }
}

export function loadLastBellCompletion(storage: LastBellCompletionStorage): LastBellCompletionRecord | null {
  try {
    const raw = storage.getItem(LAST_BELL_COMPLETION_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!isLastBellCompletionRecord(parsed)) throw new Error('invalid completion');
    return parsed;
  } catch {
    clearLastBellCompletion(storage);
    return null;
  }
}

export function clearLastBellCompletion(storage: LastBellCompletionStorage): void {
  try { storage.removeItem(LAST_BELL_COMPLETION_KEY); } catch { /* local presentation is optional */ }
}
