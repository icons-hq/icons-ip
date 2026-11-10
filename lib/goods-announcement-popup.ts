import { isUuid } from '@/lib/uuid';

export interface HomeAnnouncementPopupItem {
  id: string; title: string; body: string; format: 'plain' | 'html'; device: 'all' | 'pc' | 'mobile'; important: boolean;
  dismissKey: string; startsAt: string; endsAt: string;
}
export interface HomeAnnouncementPopupData { item: HomeAnnouncementPopupItem | null; nextChangeAt: string | null; unavailable?: boolean }
export const HOME_POPUP_DISMISS_STORAGE = 'icons:home-announcement-dismiss:v1';
const instant = (value: unknown): value is string => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(value) && Number.isFinite(Date.parse(value));
export function parseHomeAnnouncementPopup(value: unknown): HomeAnnouncementPopupData | null {
  if (!value || typeof value !== 'object' || !('item' in value) || !('nextChangeAt' in value)
    || (value.nextChangeAt !== null && !instant(value.nextChangeAt))) return null;
  if (value.item === null) return { item: null, nextChangeAt: value.nextChangeAt as string | null };
  const item = value.item as Partial<HomeAnnouncementPopupItem>;
  if (typeof item !== 'object' || Array.isArray(item) || !isUuid(item.id) || !isUuid(item.dismissKey)
    || typeof item.title !== 'string' || typeof item.body !== 'string' || !['plain', 'html'].includes(String(item.format))
    || !['all', 'pc', 'mobile'].includes(String(item.device)) || typeof item.important !== 'boolean'
    || !instant(item.startsAt) || !instant(item.endsAt) || Date.parse(item.startsAt) >= Date.parse(item.endsAt)) return null;
  return { item: { id: item.id, title: item.title, body: item.body, format: item.format!, device: item.device!, important: item.important,
    dismissKey: item.dismissKey, startsAt: item.startsAt, endsAt: item.endsAt }, nextChangeAt: value.nextChangeAt as string | null };
}
export function nextKstMidnight(now: number) { return Math.floor((now + 9 * 3_600_000) / 86_400_000) * 86_400_000 + 86_400_000 - 9 * 3_600_000; }
export function popupDismissedUntil(raw: string | null, key: string, now: number): number | null {
  try {
    const parsed = JSON.parse(raw || 'null');
    return parsed && parsed.key === key && Number.isSafeInteger(parsed.until) && parsed.until > now && parsed.until <= nextKstMidnight(now) ? parsed.until : null;
  } catch { return null; }
}
