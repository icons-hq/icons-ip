import {
  AOUAD_AVATAR_IDS,
  AOUAD_DESK_RECORDS,
  AOUAD_RALLY_ZONE_IDS,
  AOUAD_STORE_PREVIEW,
  AOUAD_ZONE_IDS,
  type AouadAvatarId,
  type AouadIfEndingId,
  type AouadRallyZoneId,
  type AouadStorePreviewId,
  type AouadZoneId,
} from './content';

export const AOUAD_CAMPAIGN_STORAGE_KEY = 'icons:aouad-campaign:v1';
export const AOUAD_CAMPAIGN_SCHEMA_VERSION = 1 as const;

export type AouadCampaignState = {
  schemaVersion: typeof AOUAD_CAMPAIGN_SCHEMA_VERSION;
  openingSeen: boolean;
  student: {
    name: string | null;
    avatar: AouadAvatarId | null;
  };
  zones: Record<AouadRallyZoneId, boolean>;
  classroomRecords: string[];
  theaterEndings: AouadIfEndingId[];
  wishlist: AouadStorePreviewId[];
  rooftopEmbers: number;
  /** Last Bell lives in its own storage boundary; this is only a local UI reference. */
  lastBellCompletionSeen: boolean;
};

export type AouadCampaignStorage = Pick<Storage, 'getItem' | 'setItem'>;

export const initialAouadCampaignState: AouadCampaignState = {
  schemaVersion: AOUAD_CAMPAIGN_SCHEMA_VERSION,
  openingSeen: false,
  student: { name: null, avatar: null },
  zones: {
    classroom: false,
    cafeteria: false,
    broadcast: false,
    theater: false,
    rooftop: false,
  },
  classroomRecords: [],
  theaterEndings: [],
  wishlist: [],
  rooftopEmbers: 0,
  lastBellCompletionSeen: false,
};

const zoneIds = new Set<string>(AOUAD_ZONE_IDS);
const avatarIds = new Set<string>(AOUAD_AVATAR_IDS);
const deskRecordIds = new Set<string>(AOUAD_DESK_RECORDS.map((record) => record.id));
const storeIds = new Set<string>(AOUAD_STORE_PREVIEW.map((item) => item.id));
const legacyStoreIdMap: Record<string, AouadStorePreviewId> = {
  'id-set': 'idcard',
  'survival-pouch': 'kit',
  'radio-keyring': 'radio',
  'ember-candle': 'candle',
};
const endingIds = new Set<AouadIfEndingId>(['signal', 'voice', 'dawn']);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stringsFrom(value: unknown, allowed?: ReadonlySet<string>, limit = 8): string[] {
  if (!Array.isArray(value)) return [];
  return Array.from(new Set(value.filter((item): item is string => typeof item === 'string' && (!allowed || allowed.has(item))))).slice(0, limit);
}

function storeIdsFrom(value: unknown): AouadStorePreviewId[] {
  if (!Array.isArray(value)) return [];
  const normalized = value.flatMap((item) => {
    if (typeof item !== 'string') return [];
    const candidate = legacyStoreIdMap[item] ?? item;
    return storeIds.has(candidate) ? [candidate as AouadStorePreviewId] : [];
  });
  return Array.from(new Set(normalized)).slice(0, AOUAD_STORE_PREVIEW.length);
}

function safeName(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const name = value.trim();
  return name.length > 0 && name.length <= 12 ? name : null;
}

function readZones(value: unknown): Record<AouadRallyZoneId, boolean> {
  const candidate = isRecord(value) ? value : {};
  return Object.fromEntries(
    AOUAD_RALLY_ZONE_IDS.map((id) => [id, candidate[id] === true]),
  ) as Record<AouadRallyZoneId, boolean>;
}

/**
 * Normalizes v1 records and accepts the short-lived pre-schema shape used by
 * the first local prototype. Invalid data never escapes into the UI.
 */
export function parseAouadCampaignState(value: unknown): AouadCampaignState | null {
  if (!isRecord(value)) return null;
  const legacyOrCurrent = value.schemaVersion === AOUAD_CAMPAIGN_SCHEMA_VERSION || value.schemaVersion === undefined;
  if (!legacyOrCurrent) return null;

  const student = isRecord(value.student) ? value.student : {};
  const candidate = value as Partial<AouadCampaignState>;
  const rawZones = candidate.zones;
  const zones = readZones(rawZones);
  const classroomRecords = stringsFrom(candidate.classroomRecords ?? value.desks, deskRecordIds);
  const theaterEndings = stringsFrom(candidate.theaterEndings ?? value.endings, endingIds) as AouadIfEndingId[];
  const wishlist = storeIdsFrom(candidate.wishlist ?? value.wishes);
  const avatar = avatarIds.has(String(student.avatar)) ? student.avatar as AouadAvatarId : null;

  // Existing pre-schema sessions represented a cleared zone by `clears.zone`.
  if (isRecord(value.clears)) {
    for (const id of AOUAD_RALLY_ZONE_IDS) zones[id] ||= value.clears[id] === true;
  }
  zones.classroom ||= classroomRecords.length >= 3;
  zones.theater ||= theaterEndings.length > 0;

  return {
    schemaVersion: AOUAD_CAMPAIGN_SCHEMA_VERSION,
    openingSeen: candidate.openingSeen === true || value.op === true,
    student: { name: safeName(student.name ?? value.callsign), avatar: avatar ?? null },
    zones,
    classroomRecords,
    theaterEndings,
    wishlist,
    rooftopEmbers: Number.isInteger(candidate.rooftopEmbers) && Number(candidate.rooftopEmbers) >= 0
      ? Math.min(Number(candidate.rooftopEmbers), 99)
      : 0,
    lastBellCompletionSeen: candidate.lastBellCompletionSeen === true,
  };
}

export function loadAouadCampaignState(storage: AouadCampaignStorage): AouadCampaignState {
  try {
    const raw = storage.getItem(AOUAD_CAMPAIGN_STORAGE_KEY);
    if (!raw) return initialAouadCampaignState;
    return parseAouadCampaignState(JSON.parse(raw)) ?? initialAouadCampaignState;
  } catch {
    return initialAouadCampaignState;
  }
}

export function saveAouadCampaignState(storage: AouadCampaignStorage, state: AouadCampaignState): boolean {
  try {
    storage.setItem(AOUAD_CAMPAIGN_STORAGE_KEY, JSON.stringify(state));
    return true;
  } catch {
    return false;
  }
}

export function withAouadZoneComplete(state: AouadCampaignState, zone: AouadRallyZoneId): AouadCampaignState {
  return { ...state, zones: { ...state.zones, [zone]: true } };
}

export function isAouadRallyComplete(state: AouadCampaignState): boolean {
  return AOUAD_RALLY_ZONE_IDS.every((zone) => state.zones[zone]);
}

export function aouadRallyCount(state: AouadCampaignState): number {
  return AOUAD_RALLY_ZONE_IDS.filter((zone) => state.zones[zone]).length;
}

export function canUseAouadZone(value: string): value is AouadZoneId {
  return zoneIds.has(value);
}
