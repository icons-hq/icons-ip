import type { Good } from './data';
import { isUuid } from './uuid';

export const PRODUCT_DETAIL_EXPERIENCE_PATH = '/admin/display/detail/experience';
export type ExperienceSection = 'messages' | 'discovery';
export interface PurchaseMessages { buyers: boolean; minBuyers: number; twoYears: boolean; repeatBuyers: boolean; minRepeatBuyers: number; bestSeller: boolean; newProduct: boolean }
export interface DetailDiscovery { interests: boolean; shippingSavings: boolean }
export interface DetailExperiences { messages: PurchaseMessages; discovery: DetailDiscovery }
export interface DetailExperienceSnapshot { values: DetailExperiences; revisions: Record<ExperienceSection, number>; unavailable?: boolean }
export const DEFAULT_DETAIL_EXPERIENCES: DetailExperiences = { messages: { buyers: false, minBuyers: 10, twoYears: true, repeatBuyers: false, minRepeatBuyers: 10, bestSeller: false, newProduct: false }, discovery: { interests: false, shippingSavings: false } };
const object = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const integer = (value: unknown, minimum = 0, maximum = Number.MAX_SAFE_INTEGER): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= minimum && value <= maximum;
const keys = (value: Record<string, unknown>, expected: string[]) => Object.keys(value).length === expected.length && expected.every(key => key in value);
const instant = (value: unknown): value is string | null => value === null || typeof value === 'string' && Number.isFinite(Date.parse(value));
export function parseExperienceSection<T extends ExperienceSection>(section: T, value: unknown): DetailExperiences[T] | null {
  if (!object(value)) return null;
  if (section === 'discovery' && keys(value, ['interests', 'shippingSavings']) && typeof value.interests === 'boolean' && typeof value.shippingSavings === 'boolean') return value as unknown as DetailExperiences[T];
  if (section !== 'messages' || !keys(value, ['buyers', 'minBuyers', 'twoYears', 'repeatBuyers', 'minRepeatBuyers', 'bestSeller', 'newProduct'])
    || !['buyers', 'twoYears', 'repeatBuyers', 'bestSeller', 'newProduct'].every(key => typeof value[key] === 'boolean')
    || !integer(value.minBuyers, 10, 1000) || !integer(value.minRepeatBuyers, 10, 1000)) return null;
  return value as unknown as DetailExperiences[T];
}
export function parseDetailExperienceSnapshot(value: unknown): DetailExperienceSnapshot | null {
  if (!object(value) || !object(value.values) || !object(value.revisions)) return null;
  const messages = parseExperienceSection('messages', value.values.messages), discovery = parseExperienceSection('discovery', value.values.discovery);
  if (!messages || !discovery || !integer(value.revisions.messages) || !integer(value.revisions.discovery)) return null;
  return { values: { messages, discovery }, revisions: { messages: value.revisions.messages, discovery: value.revisions.discovery } };
}
export type PurchaseMessage = { kind: 'buyers' | 'repeatBuyers'; window: 'today' | 'week' | 'threeMonths' | 'sixMonths' | 'year' | 'twoYears'; count: number } | { kind: 'bestSeller'; rank: number } | { kind: 'newProduct' };
export interface PublicDetailExperience { messages: PurchaseMessage[]; discovery: DetailDiscovery; nextChangeAt: string | null }
export function parsePublicDetailExperience(value: unknown): PublicDetailExperience | null {
  if (!object(value) || !Array.isArray(value.messages) || value.messages.length > 4 || !instant(value.nextChangeAt)) return null;
  const discovery = parseExperienceSection('discovery', value.discovery); if (!discovery) return null;
  const messages: PurchaseMessage[] = [];
  for (const message of value.messages) {
    if (!object(message) || messages.some(row => row.kind === message.kind)) return null;
    if (message.kind === 'newProduct') messages.push({ kind: 'newProduct' });
    else if (message.kind === 'bestSeller' && integer(message.rank, 1, 10)) messages.push({ kind: 'bestSeller', rank: message.rank });
    else if ((message.kind === 'buyers' || message.kind === 'repeatBuyers') && integer(message.count, 10)
      && (message.kind === 'buyers' ? ['today', 'week', 'sixMonths', 'year', 'twoYears'] : ['threeMonths', 'sixMonths', 'year']).includes(String(message.window))) {
      messages.push({ kind: message.kind, window: message.window as Extract<PurchaseMessage, { count: number }>['window'], count: message.count });
    } else return null;
  }
  return { messages, discovery, nextChangeAt: value.nextChangeAt };
}
export function purchaseMessageLabel(message: PurchaseMessage) {
  if (message.kind === 'newProduct') return '등록 7일 이내 새 굿즈';
  if (message.kind === 'bestSeller') return `최근 3일 판매 ${message.rank}위`;
  const windows = { today: '오늘', week: '최근 7일', threeMonths: '최근 3개월', sixMonths: '최근 6개월', year: '최근 1년', twoYears: '최근 2년' };
  return `${windows[message.window]} ${message.count.toLocaleString('ko-KR')}명 ${message.kind === 'buyers' ? '구매' : '재구매'}`;
}

export const RECENT_GOODS_STORAGE_PREFIX = 'icons_recent_goods_v1';
export function normalizeExperienceGoodsIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((id): id is string => typeof id === 'string' && /^[a-z0-9][a-z0-9-]{0,199}$/.test(id)))].slice(0, 30);
}
export function readRecentGoods(value: string | null): string[] {
  try { const data: unknown = JSON.parse(value ?? 'null'); return object(data) && data.version === 1 ? normalizeExperienceGoodsIds(data.ids) : []; } catch { return []; }
}
export function recentGoodsKey(ownerId: string | null) { return `${RECENT_GOODS_STORAGE_PREFIX}:${ownerId && isUuid(ownerId) ? ownerId : 'guest'}`; }
export type InterestKind = 'repurchase' | 'cart' | 'wishlist' | 'recent';
export interface InterestCollection { ownerId: string | null; enabled: boolean; groups: Record<InterestKind, Good[]>; unavailable?: boolean }
export function emptyInterestCollection(ownerId: string | null = null): InterestCollection { return { ownerId, enabled: false, groups: { repurchase: [], cart: [], wishlist: [], recent: [] } }; }
export function parseOwnedInterestIds(value: unknown): { ownerId: string | null; cart: string[]; wishlist: string[]; repurchase: string[] } | null {
  if (!object(value) || value.ownerId !== null && (typeof value.ownerId !== 'string' || !isUuid(value.ownerId))) return null;
  for (const key of ['cart', 'wishlist', 'repurchase']) if (!Array.isArray(value[key]) || normalizeExperienceGoodsIds(value[key]).length !== value[key].length) return null;
  return value as unknown as { ownerId: string | null; cart: string[]; wishlist: string[]; repurchase: string[] };
}
export interface ShippingSavingsItem { goodId: string; variantId: string; variantName: string; qty: number; separateFee: number; combinedFee: number; savings: number; good?: Good }
export interface ShippingSavings { items: ShippingSavingsItem[]; nextChangeAt: string | null; selectionUnavailable?: boolean; unavailable?: boolean }
export function parseShippingSavings(value: unknown): ShippingSavings | null {
  if (!object(value) || !Array.isArray(value.items) || value.items.length > 12 || !instant(value.nextChangeAt)
    || value.selectionUnavailable !== undefined && typeof value.selectionUnavailable !== 'boolean') return null;
  const items: ShippingSavingsItem[] = [];
  for (const row of value.items) {
    if (!object(row) || normalizeExperienceGoodsIds([row.goodId]).length !== 1 || typeof row.variantId !== 'string' || !isUuid(row.variantId)
      || typeof row.variantName !== 'string' || !integer(row.qty, 1, 1000) || !integer(row.separateFee) || !integer(row.combinedFee)
      || !integer(row.savings, 1) || row.savings !== row.separateFee - row.combinedFee || items.some(item => item.goodId === row.goodId)) return null;
    items.push(row as unknown as ShippingSavingsItem);
  }
  return { items, nextChangeAt: value.nextChangeAt, ...(value.selectionUnavailable ? { selectionUnavailable: true } : {}) };
}
