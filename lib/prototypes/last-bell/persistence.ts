import type { LastBellState } from '@/lib/prototypes/last-bell/state';

export const LAST_BELL_CHECKPOINT_KEY = 'icons:last-bell:checkpoint:v1';
export const LAST_BELL_CHECKPOINT_SCHEMA_VERSION = 1;
export const LAST_BELL_CHECKPOINT_TTL_MS = 24 * 60 * 60 * 1000;

export type LastBellCheckpointId = 'ch1_handoff' | 'ch1_power_restored' | 'ch1_post_bell_safe';

export type LastBellCheckpointPayload = {
  schemaVersion: 1;
  authority: 'local-prototype';
  leaderboardEligible: false;
  runId: string;
  chapterId: 'chapter-01';
  checkpointId: LastBellCheckpointId;
  seed: number;
  generatorVersion: string;
  resolvedLayout: { variant: 'procedural-ch1-v1' };
  semanticWorldState: Record<string, string | number | boolean>;
  createdAt: string;
  savedAt: string;
  expiresAt: string;
};

export type CheckpointStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

function isCheckpointId(value: unknown): value is LastBellCheckpointId {
  return value === 'ch1_handoff' || value === 'ch1_power_restored' || value === 'ch1_post_bell_safe';
}

function isPayload(value: unknown): value is LastBellCheckpointPayload {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<LastBellCheckpointPayload>;
  return candidate.schemaVersion === 1
    && candidate.authority === 'local-prototype'
    && candidate.leaderboardEligible === false
    && candidate.chapterId === 'chapter-01'
    && isCheckpointId(candidate.checkpointId)
    && typeof candidate.runId === 'string'
    && typeof candidate.seed === 'number'
    && Number.isFinite(candidate.seed)
    && candidate.generatorVersion === 'procedural-ch1-v1'
    && !!candidate.resolvedLayout
    && typeof candidate.semanticWorldState === 'object'
    && typeof candidate.createdAt === 'string'
    && typeof candidate.savedAt === 'string'
    && typeof candidate.expiresAt === 'string';
}

export function saveLastBellCheckpoint(
  storage: CheckpointStorage,
  checkpointId: LastBellCheckpointId,
  semanticWorldState: Pick<LastBellState, 'phase' | 'doorLocked' | 'powerRestored' | 'fireDoorLocked' | 'bellTriggered'>,
  now = Date.now(),
): LastBellCheckpointPayload | null {
  const savedAt = new Date(now).toISOString();
  const payload: LastBellCheckpointPayload = {
    schemaVersion: LAST_BELL_CHECKPOINT_SCHEMA_VERSION,
    authority: 'local-prototype',
    leaderboardEligible: false,
    runId: 'last-bell-local-run',
    chapterId: 'chapter-01',
    checkpointId,
    seed: 4101,
    generatorVersion: 'procedural-ch1-v1',
    resolvedLayout: { variant: 'procedural-ch1-v1' },
    semanticWorldState: { ...semanticWorldState },
    createdAt: savedAt,
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
    if (!isPayload(parsed)) throw new Error('invalid checkpoint');
    const expiresAt = Date.parse(parsed.expiresAt);
    const savedAt = Date.parse(parsed.savedAt);
    if (!Number.isFinite(expiresAt) || !Number.isFinite(savedAt) || now >= expiresAt || expiresAt - savedAt > LAST_BELL_CHECKPOINT_TTL_MS) {
      throw new Error('expired checkpoint');
    }
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
  if (checkpointId === 'ch1_power_restored') return '전력 복구 직전';
  if (checkpointId === 'ch1_post_bell_safe') return '종 세트피스 직전';
  return '복도 진입 직전';
}
