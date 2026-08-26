import {
  isLastBellRunMetrics,
  LAST_BELL_GENERATOR_VERSION,
  type LastBellRunMetrics,
} from './completion';
import { LAST_BELL_STATE_VERSION, type LastBellRouteId, type LastBellRouteObjective, type LastBellState } from './state';

export const LAST_BELL_CHECKPOINT_KEY = 'icons:last-bell:checkpoint:v1';
export const LAST_BELL_CHECKPOINT_SCHEMA_VERSION = 2;
export const LAST_BELL_CHECKPOINT_TTL_MS = 24 * 60 * 60 * 1000;

export type LastBellCheckpointId = 'ch1_handoff' | 'ch1_power_restored';

export type LastBellCheckpointPayload = {
  schemaVersion: 2;
  authority: 'local-prototype';
  leaderboardEligible: false;
  runId: string;
  chapterId: 'chapter-01';
  checkpointId: LastBellCheckpointId;
  seed: number;
  generatorVersion: string;
  resolvedLayout: { variant: 'procedural-ch1-v1' };
  stateVersion: 2;
  semanticWorldState: Record<string, string | number | boolean>;
  routeId: LastBellRouteId | null;
  routeObjective: LastBellRouteObjective | null;
  runMetrics: LastBellRunMetrics;
  createdAt: string;
  savedAt: string;
  expiresAt: string;
};

type LegacyLastBellCheckpointPayload = Omit<LastBellCheckpointPayload, 'schemaVersion' | 'stateVersion' | 'routeId' | 'routeObjective' | 'runMetrics'> & {
  schemaVersion: 1;
};

export type CheckpointStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

const ROUTE_IDS = new Set<LastBellRouteId>(['central', 'rear', 'systems']);

function isCheckpointId(value: unknown): value is LastBellCheckpointId {
  return value === 'ch1_handoff' || value === 'ch1_power_restored';
}

function isTimestamp(value: unknown): value is string {
  return typeof value === 'string' && Number.isFinite(Date.parse(value));
}

function hasBasePayload(value: unknown): value is Omit<LastBellCheckpointPayload, 'schemaVersion' | 'stateVersion' | 'routeId' | 'routeObjective' | 'runMetrics'> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const candidate = value as Partial<LastBellCheckpointPayload>;
  return candidate.authority === 'local-prototype'
    && candidate.leaderboardEligible === false
    && candidate.chapterId === 'chapter-01'
    && isCheckpointId(candidate.checkpointId)
    && typeof candidate.runId === 'string'
    && candidate.runId.length > 0
    && typeof candidate.seed === 'number'
    && Number.isFinite(candidate.seed)
    && candidate.generatorVersion === LAST_BELL_GENERATOR_VERSION
    && !!candidate.resolvedLayout
    && candidate.resolvedLayout.variant === 'procedural-ch1-v1'
    && !!candidate.semanticWorldState
    && typeof candidate.semanticWorldState === 'object'
    && !Array.isArray(candidate.semanticWorldState)
    && isTimestamp(candidate.createdAt)
    && isTimestamp(candidate.savedAt)
    && isTimestamp(candidate.expiresAt);
}

function isPayload(value: unknown): value is LastBellCheckpointPayload {
  if (!hasBasePayload(value)) return false;
  const candidate = value as Partial<LastBellCheckpointPayload>;
  return candidate.schemaVersion === LAST_BELL_CHECKPOINT_SCHEMA_VERSION
    && candidate.stateVersion === LAST_BELL_STATE_VERSION
    && (candidate.routeId === null || (typeof candidate.routeId === 'string' && ROUTE_IDS.has(candidate.routeId as LastBellRouteId)))
    && (candidate.routeObjective === null
      || (candidate.routeId === 'central' && candidate.routeObjective === 'central_listen')
      || (candidate.routeId === 'rear' && candidate.routeObjective === 'rear_key')
      || (candidate.routeId === 'systems' && candidate.routeObjective === 'systems_map'))
    && isLastBellRunMetrics(candidate.runMetrics)
    && candidate.runMetrics.runId === candidate.runId
    && candidate.runMetrics.seed === candidate.seed
    && candidate.runMetrics.generatorVersion === candidate.generatorVersion
    && candidate.runMetrics.startedAt === candidate.createdAt
    && (candidate.checkpointId !== 'ch1_power_restored' || candidate.routeId !== null);
}

function isLegacyPayload(value: unknown): value is LegacyLastBellCheckpointPayload {
  return hasBasePayload(value) && (value as Partial<LegacyLastBellCheckpointPayload>).schemaVersion === 1;
}

/**
 * A v1 checkpoint has no route or deterministic metric snapshot. It must not
 * resume into an impossible post-route state, so it is discarded as a safe new
 * local run instead of fabricating those facts.
 */
function isExpired(payload: Pick<LastBellCheckpointPayload, 'savedAt' | 'expiresAt'>, now: number): boolean {
  const expiresAt = Date.parse(payload.expiresAt);
  const savedAt = Date.parse(payload.savedAt);
  return !Number.isFinite(expiresAt)
    || !Number.isFinite(savedAt)
    || now >= expiresAt
    || expiresAt - savedAt > LAST_BELL_CHECKPOINT_TTL_MS;
}

export function saveLastBellCheckpoint(
  storage: CheckpointStorage,
  checkpointId: LastBellCheckpointId,
  semanticWorldState: Pick<LastBellState, 'phase' | 'doorLocked' | 'powerRestored' | 'fireDoorLocked' | 'bellTriggered'>,
  runMetrics: LastBellRunMetrics,
  routeId: LastBellRouteId | null,
  routeObjective: LastBellRouteObjective | null,
  now = Date.now(),
): LastBellCheckpointPayload | null {
  if (!isLastBellRunMetrics(runMetrics)) return null;
  if (checkpointId === 'ch1_power_restored' && (!routeId || routeObjective !== null)) return null;
  if (!routeId && routeObjective !== null) return null;
  const savedAt = new Date(now).toISOString();
  const payload: LastBellCheckpointPayload = {
    schemaVersion: LAST_BELL_CHECKPOINT_SCHEMA_VERSION,
    authority: 'local-prototype',
    leaderboardEligible: false,
    runId: runMetrics.runId,
    chapterId: 'chapter-01',
    checkpointId,
    seed: runMetrics.seed,
    generatorVersion: runMetrics.generatorVersion,
    resolvedLayout: { variant: 'procedural-ch1-v1' },
    stateVersion: LAST_BELL_STATE_VERSION,
    semanticWorldState: { ...semanticWorldState },
    routeId,
    routeObjective,
    runMetrics,
    createdAt: runMetrics.startedAt,
    savedAt,
    expiresAt: new Date(now + LAST_BELL_CHECKPOINT_TTL_MS).toISOString(),
  };
  try {
    storage.setItem(LAST_BELL_CHECKPOINT_KEY, JSON.stringify(payload));
    return payload;
  } catch {
    return null;
  }
}

export function loadLastBellCheckpoint(storage: CheckpointStorage, now = Date.now()): LastBellCheckpointPayload | null {
  let raw: string | null = null;
  try {
    raw = storage.getItem(LAST_BELL_CHECKPOINT_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (isLegacyPayload(parsed)) throw new Error('v1 checkpoint requires a new local run');
    if (!isPayload(parsed) || isExpired(parsed, now)) throw new Error('invalid checkpoint');
    return parsed;
  } catch {
    try { storage.removeItem(LAST_BELL_CHECKPOINT_KEY); } catch { /* storage is best-effort */ }
    return null;
  }
}

export function clearLastBellCheckpoint(storage: CheckpointStorage): void {
  try { storage.removeItem(LAST_BELL_CHECKPOINT_KEY); } catch { /* storage is best-effort */ }
}

export function checkpointIdLabel(checkpointId: LastBellCheckpointId): string {
  if (checkpointId === 'ch1_power_restored') return '전력 복구 후';
  return '복도 진입 직전';
}
