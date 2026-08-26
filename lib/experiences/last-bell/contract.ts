import 'server-only';

import { createHash, randomBytes } from 'node:crypto';

export const LAST_BELL_RUN_COOKIE = '__Host-icons-last-bell-run';
export const LAST_BELL_GUEST_COOKIE_MAX_AGE_SECONDS = 7 * 24 * 60 * 60;

export const LAST_BELL_CHAPTER_IDS = ['chapter-01', 'chapter-02'] as const;
export type LastBellChapterId = (typeof LAST_BELL_CHAPTER_IDS)[number];

export const LAST_BELL_RUN_MODES = ['first-play', 'chapter-replay'] as const;
export type LastBellRunMode = (typeof LAST_BELL_RUN_MODES)[number];

export const LAST_BELL_ZONE_IDS = [
  'classroom',
  'corridor',
  'infirmary',
  'broadcast',
  'utility',
  'stairwell',
  'rooftop',
] as const;
export type LastBellZoneId = (typeof LAST_BELL_ZONE_IDS)[number];

export const LAST_BELL_COLLECTIBLE_KEYS = [
  'idcard',
  'badge',
  'photo',
  'radio',
  'kit',
  'zipup',
  'archery',
  'postcard',
  'candle',
  'blanket',
] as const;
export type LastBellCollectibleKey = (typeof LAST_BELL_COLLECTIBLE_KEYS)[number];

export const LAST_BELL_RUNTIME_EVENT_TYPES = [
  'objective',
  'pickup',
  'checkpoint',
  'capture',
  'chapter_complete',
  'game_complete',
] as const;
export type LastBellRuntimeEventType = (typeof LAST_BELL_RUNTIME_EVENT_TYPES)[number];

export interface LastBellRunStartInput {
  readonly startChapterId: LastBellChapterId;
  readonly runMode: LastBellRunMode;
}

export interface LastBellRuntimeEventInput {
  readonly sequence: number;
  readonly operationId: string;
  readonly type: LastBellRuntimeEventType;
  readonly chapterId: LastBellChapterId;
  readonly zoneId: LastBellZoneId;
  readonly objectiveId: string | null;
  readonly collectibleKey: LastBellCollectibleKey | null;
  readonly checkpointId: string | null;
}

export interface LastBellRunStartResult {
  readonly runId: string;
  readonly catalogVersion: string;
  readonly startChapterId: LastBellChapterId;
  readonly runMode: LastBellRunMode;
  readonly resumed: boolean;
  readonly activeUntil: string;
  readonly lastSequence: number;
  readonly progressStage: number;
  readonly pickedCollectibleKeys: readonly LastBellCollectibleKey[];
}

export interface LastBellEventResult {
  readonly status: 'recorded' | 'idempotent';
  readonly sequence: number;
  readonly progressStage: number;
}

export interface LastBellCompletionResult {
  readonly status: 'completed' | 'idempotent';
  readonly claimUntil: string;
}

export interface LastBellClaimResult {
  readonly status: 'claimed' | 'idempotent';
  readonly granted: number;
}

export interface LastBellInventoryItem {
  readonly collectibleKey: LastBellCollectibleKey;
  readonly goodId: string;
  readonly validUntil: string;
  readonly isPurchasable: boolean;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const GUEST_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const SAFE_IDENTIFIER_PATTERN = /^[a-z0-9][a-z0-9._-]{0,79}$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isOneOf<T extends readonly string[]>(value: unknown, values: T): value is T[number] {
  return typeof value === 'string' && (values as readonly string[]).includes(value);
}

function nullableIdentifier(value: unknown): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value !== 'string' || !SAFE_IDENTIFIER_PATTERN.test(value)) return undefined;
  return value;
}

export function normalizeLastBellRunId(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().toLowerCase();
  return UUID_PATTERN.test(normalized) ? normalized : null;
}

export function parseLastBellRunStartInput(value: unknown): LastBellRunStartInput | null {
  if (!isRecord(value)) return null;
  if (Object.keys(value).some((key) => key !== 'startChapterId' && key !== 'runMode')) return null;
  const startChapterId = value.startChapterId ?? 'chapter-01';
  const runMode = value.runMode ?? 'first-play';
  if (!isOneOf(startChapterId, LAST_BELL_CHAPTER_IDS)) return null;
  if (!isOneOf(runMode, LAST_BELL_RUN_MODES)) return null;
  if (startChapterId === 'chapter-02' && runMode !== 'chapter-replay') return null;
  return { startChapterId, runMode };
}

export function parseLastBellRuntimeEventInput(value: unknown): LastBellRuntimeEventInput | null {
  if (!isRecord(value)) return null;
  const allowedKeys = new Set([
    'sequence',
    'operationId',
    'type',
    'chapterId',
    'zoneId',
    'objectiveId',
    'collectibleKey',
    'checkpointId',
  ]);
  if (Object.keys(value).some((key) => !allowedKeys.has(key))) return null;

  const sequence = value.sequence;
  const operationId = normalizeLastBellRunId(value.operationId);
  const objectiveId = nullableIdentifier(value.objectiveId);
  const checkpointId = nullableIdentifier(value.checkpointId);
  const collectibleKey = value.collectibleKey === undefined || value.collectibleKey === null
    ? null
    : isOneOf(value.collectibleKey, LAST_BELL_COLLECTIBLE_KEYS) ? value.collectibleKey : undefined;

  if (
    !Number.isSafeInteger(sequence)
    || (sequence as number) < 1
    || !operationId
    || !isOneOf(value.type, LAST_BELL_RUNTIME_EVENT_TYPES)
    || !isOneOf(value.chapterId, LAST_BELL_CHAPTER_IDS)
    || !isOneOf(value.zoneId, LAST_BELL_ZONE_IDS)
    || objectiveId === undefined
    || checkpointId === undefined
    || collectibleKey === undefined
  ) return null;

  return {
    sequence: sequence as number,
    operationId,
    type: value.type,
    chapterId: value.chapterId,
    zoneId: value.zoneId,
    objectiveId: objectiveId ?? null,
    collectibleKey,
    checkpointId: checkpointId ?? null,
  };
}

export function createLastBellGuestRunToken(): string {
  return randomBytes(32).toString('base64url');
}

/** Returns only a digest suitable for the private DB ledger, never the raw cookie value. */
export function digestLastBellGuestRunToken(value: string | undefined): string | null {
  if (!value || !GUEST_TOKEN_PATTERN.test(value)) return null;
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

export function getLastBellGuestRunToken(cookieHeader: string | null): string | null {
  if (!cookieHeader) return null;
  for (const entry of cookieHeader.split(';')) {
    const [rawName, ...rawValue] = entry.trim().split('=');
    if (rawName !== LAST_BELL_RUN_COOKIE) continue;
    return rawValue.length === 1 ? rawValue[0] : null;
  }
  return null;
}

export const lastBellGuestCookieOptions = {
  httpOnly: true,
  secure: true,
  sameSite: 'lax' as const,
  path: '/',
  maxAge: LAST_BELL_GUEST_COOKIE_MAX_AGE_SECONDS,
};

/** Keep the __Host- cookie attributes intact when expiring the guest run token. */
export const lastBellGuestCookieDeleteOptions = {
  ...lastBellGuestCookieOptions,
  maxAge: 0,
};

export function parseLastBellRpcError(message: unknown): {
  readonly status: number;
  readonly code: string;
} {
  const normalized = typeof message === 'string' ? message.toLowerCase() : '';
  if (normalized.includes('account_suspended')) return { status: 403, code: 'account_suspended' };
  if (normalized.includes('account_deletion_write_fenced')) {
    return { status: 409, code: 'account_deletion_write_fenced' };
  }
  if (normalized.includes('onboarding_required')) return { status: 409, code: 'onboarding_required' };
  if (normalized.includes('run_not_found')) return { status: 404, code: 'run_not_found' };
  if (normalized.includes('run_access_denied') || normalized.includes('run_claimed_by_another_user')) {
    return { status: 403, code: 'forbidden' };
  }
  if (normalized.includes('last_bell_catalog_unavailable')) return { status: 503, code: 'unavailable' };
  if (
    normalized.includes('run_not_active')
    || normalized.includes('claim_not_available')
    || normalized.includes('run_not_finished')
    || normalized.includes('run_progression_too_fast')
    || normalized.includes('run_progression_invalid')
    || normalized.includes('pickup_not_reachable')
    || normalized.includes('duplicate_pickup')
    || normalized.includes('run_sequence_invalid')
    || normalized.includes('run_operation_conflict')
    || normalized.includes('chapter_replay_locked')
  ) return { status: 409, code: 'run_conflict' };
  if (
    normalized.includes('invalid_')
    || normalized.includes('chapter_replay_required')
    || normalized.includes('authenticated_run_cannot_use_guest_cookie')
  ) return { status: 400, code: 'invalid_request' };
  return { status: 502, code: 'last_bell_unavailable' };
}
