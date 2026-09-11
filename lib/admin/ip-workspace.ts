import type { AdminIpRecord } from './catalog.server';
import type { AdminIpIdentity } from '@/lib/ip-identity';

export const IP_INDEX_PATH = '/admin/catalog/ips';
export const IP_INDEX_PAGE_SIZE = 20;
export const IP_FEATURED_LIMIT = 5;
export const IP_WORKSPACE_TABS = [
  { id: 'basic', label: '기본정보' }, { id: 'goods', label: '상품' },
  { id: 'pools', label: '카드풀' }, { id: 'events', label: '이벤트' }, { id: 'exposure', label: '노출' },
] as const;
export type IpWorkspaceTab = typeof IP_WORKSPACE_TABS[number]['id'];
export type IpIndexStatus = 'active' | 'all' | 'draft' | 'published' | 'archived';
export interface IpIndexFilters { query: string; vertical: string; page: number; status: IpIndexStatus }
export type AdminIpSummary = Pick<AdminIpRecord, 'id' | 'title' | 'verticalKey' | 'archivedAt' | 'publishedAt' | 'featured'> & { sortOrder: number };
export interface AdminIpIndexData { ips: AdminIpSummary[]; total: number; filters: IpIndexFilters; verticals: { key: string; label: string }[] }
export interface AdminIpWorkspaceData {
  ip: AdminIpRecord;
  /** Public slug/alias metadata is an isolated identity seam; legacy callers may omit it. */
  identity?: AdminIpIdentity | null;
  tab: IpWorkspaceTab;
  verticals: { key: string; label: string; color: string }[];
  directory: AdminIpSummary[];
  related: { id: string; title: string; detail: string }[];
  relatedTotal: number;
}
const first = (value: string | string[] | undefined) => Array.isArray(value) ? value[0] : value;
export function normalizeIpWorkspaceTab(value: string | string[] | undefined): IpWorkspaceTab {
  return IP_WORKSPACE_TABS.find((tab) => tab.id === first(value))?.id ?? 'basic';
}
export function normalizeIpIndexFilters(values: Record<string, string | string[] | undefined>): IpIndexFilters {
  const status = first(values.status);
  const page = Number(first(values.page));
  return {
    query: (first(values.q) ?? '').trim().slice(0, 100),
    vertical: (first(values.vertical) ?? '').trim().slice(0, 100),
    page: Number.isSafeInteger(page) && page > 0 ? Math.min(page, 100000) : 1,
    status: ['active', 'all', 'draft', 'published', 'archived'].includes(status ?? '') ? status as IpIndexStatus : 'active',
  };
}
export function ipIndexHref(filters: IpIndexFilters, page = filters.page): string {
  const params = new URLSearchParams({ status: filters.status, page: String(page) });
  if (filters.query) params.set('q', filters.query);
  if (filters.vertical) params.set('vertical', filters.vertical);
  return `${IP_INDEX_PATH}?${params}`;
}
export function ipWorkspaceHref(id: string, tab: IpWorkspaceTab = 'basic'): string {
  const path = `${IP_INDEX_PATH}/${encodeURIComponent(id)}`;
  return tab === 'basic' ? path : `${path}?tab=${tab}`;
}
export function newGoodForIpHref(id: string): string {
  return `/admin/catalog/goods?${new URLSearchParams({ ipId: id, create: '1' })}`;
}
