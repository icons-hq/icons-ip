import { isUuid } from './uuid';
import type { Good } from './data';

export const PRODUCT_DETAIL_PRESENTATION_PATH = '/admin/display/detail';
export const DETAIL_MODULE_KEYS = ['reviewSummary', 'similar', 'together', 'categoryPopular', 'storePopular'] as const;
export type DetailModuleKey = typeof DETAIL_MODULE_KEYS[number];
export type DetailRecommendationKey = Exclude<DetailModuleKey, 'reviewSummary'>;
export type DetailModules = Record<DetailModuleKey, boolean>;
export interface DetailBanner {
  enabled: boolean; style: 'light' | 'dark'; title: string; text: string;
  periodEnabled: boolean; startsOn: string | null; endsOn: string | null;
  targetType: 'all' | 'goods' | 'categories'; goodIds: string[]; categoryIds: string[];
}
export interface DetailOtherComposition { enabled: boolean }
export interface DetailPresentation { banner: DetailBanner; modules: DetailModules; otherComposition: DetailOtherComposition }
export type DetailSection = keyof DetailPresentation;
export interface DetailPresentationSnapshot { values: DetailPresentation; revisions: Record<DetailSection, number> }
export const DEFAULT_DETAIL_PRESENTATION: DetailPresentation = {
  banner: { enabled: false, style: 'light', title: '', text: '', periodEnabled: false, startsOn: null, endsOn: null, targetType: 'all', goodIds: [], categoryIds: [] },
  modules: { reviewSummary: false, similar: false, together: false, categoryPopular: false, storePopular: false },
  otherComposition: { enabled: false },
};
const object = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const keys = (value: Record<string, unknown>, expected: readonly string[]) => Object.keys(value).length === expected.length && expected.every(key => key in value);
export const isDetailGoodId = (value: unknown): value is string => typeof value === 'string' && /^[a-z0-9][a-z0-9-]{0,199}$/.test(value);
function ids(value: unknown, max: number, valid: (value: unknown) => boolean): value is string[] {
  return Array.isArray(value) && value.length <= max && value.every(valid) && new Set(value).size === value.length;
}
export function isDetailDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^20\d{2}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}
export function parseDetailSection(section: DetailSection, value: unknown, allowRemovedTargets = false): DetailPresentation[DetailSection] | null {
  if (!object(value)) return null;
  if (section === 'otherComposition') return keys(value, ['enabled']) && typeof value.enabled === 'boolean' ? value as unknown as DetailOtherComposition : null;
  if (section === 'modules') return keys(value, DETAIL_MODULE_KEYS) && DETAIL_MODULE_KEYS.every(key => typeof value[key] === 'boolean') ? value as DetailModules : null;
  if (section !== 'banner' || !keys(value, ['enabled', 'style', 'title', 'text', 'periodEnabled', 'startsOn', 'endsOn', 'targetType', 'goodIds', 'categoryIds'])
    || typeof value.enabled !== 'boolean' || typeof value.periodEnabled !== 'boolean' || !['light', 'dark'].includes(String(value.style))
    || !['all', 'goods', 'categories'].includes(String(value.targetType))
    || typeof value.title !== 'string' || typeof value.text !== 'string'
    || [...value.title].length > 10 || [...value.text].length > 20 || value.title !== value.title.trim() || value.text !== value.text.trim()
    || /[\u0000-\u001f\u007f]/.test(value.title + value.text)
    || !ids(value.goodIds, 200, isDetailGoodId) || !ids(value.categoryIds, 10, isUuid)
    || value.targetType !== 'goods' && value.goodIds.length > 0 || value.targetType !== 'categories' && value.categoryIds.length > 0
    || (value.periodEnabled ? !isDetailDate(value.startsOn) || !isDetailDate(value.endsOn) || value.startsOn > value.endsOn : value.startsOn !== null || value.endsOn !== null)
    || value.enabled && (!value.title || !value.text || !allowRemovedTargets && (value.targetType === 'goods' && !value.goodIds.length || value.targetType === 'categories' && !value.categoryIds.length))) return null;
  return value as unknown as DetailBanner;
}
export function parseDetailSnapshot(value: unknown): DetailPresentationSnapshot | null {
  if (!object(value) || !object(value.values) || !object(value.revisions)) return null;
  const banner = parseDetailSection('banner', value.values.banner, true), modules = parseDetailSection('modules', value.values.modules), otherComposition = parseDetailSection('otherComposition', value.values.otherComposition);
  return banner && modules && otherComposition && ['banner', 'modules', 'otherComposition'].every(key => Number.isSafeInteger(value.revisions && (value.revisions as Record<string, unknown>)[key]) && Number((value.revisions as Record<string, unknown>)[key]) >= 0)
    ? { values: { banner: banner as DetailBanner, modules: modules as DetailModules, otherComposition: otherComposition as DetailOtherComposition }, revisions: value.revisions as DetailPresentationSnapshot['revisions'] } : null;
}

export interface DetailReviewCard { id: string; rating: number; body: string; authorName: string; createdAt: string; imagePaths: string[] }
export interface PublicDetailPresentationReference {
  banner: Pick<DetailBanner, 'style' | 'title' | 'text'> | null;
  reviews: { count: number; positiveCount: number; cards: DetailReviewCard[] } | null;
  recommendations: Record<DetailRecommendationKey, string[]>;
  nextChangeAt: string | null;
}
export interface PublicDetailPresentation extends Omit<PublicDetailPresentationReference, 'reviews' | 'recommendations'> {
  reviews: { count: number; positiveCount: number; cards: (Omit<DetailReviewCard, 'imagePaths'> & { imageUrls: string[]; eventDisclosure?: import('@/lib/review-events').ReviewEventDisclosure })[] } | null;
  recommendations: Record<DetailRecommendationKey, Good[]>;
  unavailable?: boolean;
  recommendationsUnavailable?: boolean;
}
export function parsePublicDetailPresentation(value: unknown): PublicDetailPresentationReference | null {
  if (!object(value) || !object(value.recommendations) || !['similar', 'together', 'categoryPopular', 'storePopular'].every(key => ids((value.recommendations as Record<string, unknown>)[key], key === 'similar' || key === 'together' ? 30 : 12, isDetailGoodId))
    || value.nextChangeAt !== null && (typeof value.nextChangeAt !== 'string' || !Number.isFinite(Date.parse(value.nextChangeAt)))) return null;
  if (value.banner !== null && (!object(value.banner) || !['light', 'dark'].includes(String(value.banner.style))
    || typeof value.banner.title !== 'string' || !value.banner.title || [...value.banner.title].length > 10 || typeof value.banner.text !== 'string' || !value.banner.text || [...value.banner.text].length > 20)) return null;
  if (value.reviews !== null) {
    const review = value.reviews;
    if (!object(review) || !Number.isSafeInteger(review.count) || Number(review.count) < 0 || !Number.isSafeInteger(review.positiveCount)
      || Number(review.positiveCount) < 0 || Number(review.positiveCount) > Number(review.count) || !Array.isArray(review.cards) || review.cards.length > 10
      || review.cards.length > Number(review.positiveCount) || review.cards.some(card => !object(card) || !isUuid(card.id) || ![4, 5].includes(Number(card.rating))
        || typeof card.rating !== 'number' || typeof card.body !== 'string' || typeof card.authorName !== 'string' || typeof card.createdAt !== 'string' || !Number.isFinite(Date.parse(card.createdAt))
        || !Array.isArray(card.imagePaths) || card.imagePaths.length > 5 || card.imagePaths.some(path => typeof path !== 'string' || !path))) return null;
  }
  return value as unknown as PublicDetailPresentationReference;
}
