import { isUuid } from '@/lib/uuid';
export const MARKETING_LINKS_PATH = '/admin/marketing/links';
export const MARKETING_LINK_SOURCES = ['home', 'good', 'story', 'category'] as const;
export type MarketingLinkSource = typeof MARKETING_LINK_SOURCES[number];
export const MARKETING_LINK_LABELS: Record<MarketingLinkSource, string> = { home: '스토어 홈', good: '상품', story: '쇼핑스토리', category: '카테고리' };
export const MARKETING_LINK_ORIGINS: Record<MarketingLinkSource, string> = { home: MARKETING_LINKS_PATH, good: '/admin/catalog/goods', story: '/admin/display/stories', category: '/admin/catalog/categories' };
export const MARKETING_LINK_TOKEN = /^[0-9a-f]{32}$/;
export interface MarketingLinkRow { id: string; token: string; source: MarketingLinkSource; targetId: string | null; originalTargetId: string; title: string; available: boolean; createdAt: string }
export interface MarketingLinkFilters { source: MarketingLinkSource; query: string; status: 'all' | 'available' | 'unavailable'; page: number; pageSize: 20 | 50 | 100 }
export interface MarketingLinksData { filters: MarketingLinkFilters; rows: MarketingLinkRow[]; total: number }
export type IssueMarketingLinksResult = { rows: MarketingLinkRow[]; error?: never; uncertain?: never } | { error: string; uncertain?: boolean; rows?: never };
export function isMarketingLinkSource(value: unknown): value is MarketingLinkSource { return typeof value === 'string' && MARKETING_LINK_SOURCES.includes(value as MarketingLinkSource); }
export function marketingSourceCapability(source: MarketingLinkSource) { return source === 'home' || source === 'story' ? 'store.manage' as const : 'catalog.manage' as const; }
export function validMarketingTarget(source: MarketingLinkSource, value: unknown): value is string {
  return typeof value === 'string' && (source === 'home' ? value === 'home' : source === 'good' ? /^[a-z0-9][a-z0-9-]{0,199}$/.test(value) : isUuid(value) && value === value.toLowerCase());
}
export function marketingLinkPath(token: string) { return `/m/${token}`; }
export function parseMarketingLinkRows(value: unknown): MarketingLinkRow[] | null {
  if (!Array.isArray(value) || value.length > 100) return null;
  const rows: MarketingLinkRow[] = [];
  for (const row of value) {
    if (!row || !isUuid(row.id) || !isMarketingLinkSource(row.source) || typeof row.token !== 'string' || !MARKETING_LINK_TOKEN.test(row.token)
      || (row.targetId !== null && !validMarketingTarget(row.source, row.targetId)) || !validMarketingTarget(row.source, row.originalTargetId)
      || typeof row.title !== 'string' || !row.title.trim() || typeof row.available !== 'boolean' || typeof row.createdAt !== 'string' || !Number.isFinite(Date.parse(row.createdAt))) return null;
    rows.push(row);
  }
  return new Set(rows.map(row => row.id)).size === rows.length && new Set(rows.map(row => row.token)).size === rows.length ? rows : null;
}
export function normalizeMarketingLinkFilters(params: Record<string, string | string[] | undefined>): MarketingLinkFilters {
  const first = (value: string | string[] | undefined) => Array.isArray(value) ? value[0] : value;
  const source = first(params.source), status = first(params.status), page = Number(first(params.page)), size = Number(first(params.pageSize));
  return { source: isMarketingLinkSource(source) ? source : 'home', query: (first(params.q) ?? '').trim().slice(0, 100), status: status === 'available' || status === 'unavailable' ? status : 'all',
    page: Number.isSafeInteger(page) && page > 0 && page <= 1_000_000 ? page : 1, pageSize: size === 50 || size === 100 ? size : 20 };
}
export function marketingLinksHref(filters: MarketingLinkFilters, page = filters.page) {
  const query = new URLSearchParams({ source: filters.source, status: filters.status, page: String(page), pageSize: String(filters.pageSize) });
  if (filters.query) query.set('q', filters.query);
  return `${MARKETING_LINKS_PATH}?${query}`;
}
