export type AouadCampaignEvent =
  | { type: 'campaign_view'; surface: 'hub' | 'zone' }
  | { type: 'opening_completed'; mode: 'full' | 'skip' | 'reduced' }
  | { type: 'game_start_clicked' }
  | { type: 'game_continue_clicked' }
  | { type: 'result_viewed'; source: 'last_bell' }
  | { type: 'share_clicked'; method: 'web-share' | 'clipboard' | 'download' | 'unavailable' }
  | { type: 'popup_viewed'; zone: 'classroom' | 'cafeteria' | 'broadcast' | 'theater' | 'store' | 'rooftop' }
  | { type: 'store_preview_viewed' }
  | { type: 'wishlist_toggled'; itemId: 'id-set' | 'survival-pouch' | 'radio-keyring' | 'ember-candle'; active: boolean }
  | { type: 'zone_completed'; zone: 'classroom' | 'cafeteria' | 'broadcast' | 'theater' | 'rooftop' };

const SURFACES = ['hub', 'zone'] as const;
const OPENING_MODES = ['full', 'skip', 'reduced'] as const;
const SHARE_METHODS = ['web-share', 'clipboard', 'download', 'unavailable'] as const;
const POPUP_ZONES = ['classroom', 'cafeteria', 'broadcast', 'theater', 'store', 'rooftop'] as const;
const RALLY_ZONES = ['classroom', 'cafeteria', 'broadcast', 'theater', 'rooftop'] as const;
const STORE_ITEM_IDS = ['id-set', 'survival-pouch', 'radio-keyring', 'ember-candle'] as const;

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const ownKeys = Reflect.ownKeys(value);
  return ownKeys.length === keys.length && ownKeys.every((key) => typeof key === 'string' && keys.includes(key));
}

function stringField(value: Record<string, unknown>, key: string): string | null {
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  return typeof descriptor?.value === 'string' ? descriptor.value : null;
}

function booleanField(value: Record<string, unknown>, key: string): boolean | null {
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  return typeof descriptor?.value === 'boolean' ? descriptor.value : null;
}

function isOneOf<T extends string>(value: string | null, allowed: readonly T[]): value is T {
  return value !== null && allowed.includes(value as T);
}

/** Runtime validation keeps the local seam closed even when JavaScript callers forge a payload. */
export function isAouadCampaignEvent(event: unknown): event is AouadCampaignEvent {
  if (!isPlainRecord(event)) return false;
  const type = stringField(event, 'type');

  switch (type) {
    case 'campaign_view':
      return hasExactKeys(event, ['type', 'surface']) && isOneOf(stringField(event, 'surface'), SURFACES);
    case 'opening_completed':
      return hasExactKeys(event, ['type', 'mode']) && isOneOf(stringField(event, 'mode'), OPENING_MODES);
    case 'game_start_clicked':
    case 'game_continue_clicked':
    case 'store_preview_viewed':
      return hasExactKeys(event, ['type']);
    case 'result_viewed':
      return hasExactKeys(event, ['type', 'source']) && stringField(event, 'source') === 'last_bell';
    case 'share_clicked':
      return hasExactKeys(event, ['type', 'method']) && isOneOf(stringField(event, 'method'), SHARE_METHODS);
    case 'popup_viewed':
      return hasExactKeys(event, ['type', 'zone']) && isOneOf(stringField(event, 'zone'), POPUP_ZONES);
    case 'wishlist_toggled':
      return hasExactKeys(event, ['type', 'itemId', 'active'])
        && isOneOf(stringField(event, 'itemId'), STORE_ITEM_IDS)
        && booleanField(event, 'active') !== null;
    case 'zone_completed':
      return hasExactKeys(event, ['type', 'zone']) && isOneOf(stringField(event, 'zone'), RALLY_ZONES);
    default:
      return false;
  }
}

/**
 * The local prototype deliberately has no remote analytics sink. Events are
 * closed, contain no user-provided fields, and are returned only for UI tests
 * or a future server-owned adapter.
 */
export function trackAouadCampaignEvent(event: unknown): AouadCampaignEvent | null {
  return isAouadCampaignEvent(event) ? event : null;
}
