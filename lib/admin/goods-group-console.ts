import { customerServiceDate } from './customer-service-list';
import { GOODS_GROUPS_PATH, parseGoodsGroupPage, type GoodsGroupPage } from './goods-groups';
import { isUuid } from '@/lib/uuid';
import { transactionInteger, transactionRecord, transactionInstant } from '@/lib/goods-transaction-values';

export const GROUP_SEARCH_FIELDS = [{ value: 'all', label: '전체' }, { value: 'goodId', label: '상품번호' }, { value: 'groupId', label: '그룹상품번호' }, { value: 'code', label: '판매자상품코드' }, { value: 'name', label: '그룹상품명' }, { value: 'maker', label: '제조사명' }] as const;
export const GROUP_STATUSES = [{ value: 'all', label: '전체' }, { value: 'published', label: '공개 상품 포함' }, { value: 'draft', label: '전체 미공개' }, { value: 'archived', label: '연결 해제' }] as const;
export const GROUP_SORTS = [{ value: 'created_desc', label: '그룹상품등록일순' }, { value: 'updated_desc', label: '그룹상품수정일순' }, { value: 'name_asc', label: '그룹상품명순' }] as const;
export interface GoodsGroupFilters {
  query: string; field: typeof GROUP_SEARCH_FIELDS[number]['value']; status: typeof GROUP_STATUSES[number]['value'];
  categoryId: string; dateField: 'created' | 'updated'; from: string | null; to: string | null;
  stock: 'all' | 'available' | 'soldout'; originId: string; shippingFee: 'all' | 'free' | 'paid';
  sort: typeof GROUP_SORTS[number]['value']; page: number; pageSize: number;
}
export const DEFAULT_GROUP_FILTERS: GoodsGroupFilters = { query: '', field: 'all', status: 'all', categoryId: '', dateField: 'created', from: null, to: null, stock: 'all', originId: '', shippingFee: 'all', sort: 'created_desc', page: 1, pageSize: 50 };
export interface GoodsGroupConsole extends GoodsGroupPage {
  counts: Record<GoodsGroupFilters['status'], number>;
  metadata: Record<string, { createdAt: string; updatedAt: string; category: string | null }>;
}
export function normalizeGoodsGroupFilters(params: Record<string, string | string[] | undefined>): GoodsGroupFilters {
  const value = (key: string) => typeof params[key] === 'string' ? params[key] as string : '';
  const option = <T extends string>(key: string, choices: readonly T[], fallback: T) => choices.includes(value(key) as T) ? value(key) as T : fallback;
  let from = customerServiceDate(params.from), to = customerServiceDate(params.to);
  if (from && to && from > to) { from = null; to = null; }
  const page = Number(value('page')), pageSize = Number(value('pageSize'));
  return { query: value('q').trim().slice(0, 100), field: option('field', GROUP_SEARCH_FIELDS.map(row => row.value), 'all'),
    status: option('status', GROUP_STATUSES.map(row => row.value), 'all'), categoryId: isUuid(value('categoryId')) ? value('categoryId').toLowerCase() : '',
    dateField: option('dateField', ['created', 'updated'], 'created'), from, to, stock: option('stock', ['all', 'available', 'soldout'], 'all'),
    originId: isUuid(value('originId')) ? value('originId').toLowerCase() : '', shippingFee: option('shippingFee', ['all', 'free', 'paid'], 'all'),
    sort: option('sort', GROUP_SORTS.map(row => row.value), 'created_desc'), page: transactionInteger(page, 1, 100000) ? page : 1,
    pageSize: [20, 50, 100].includes(pageSize) ? pageSize : 50 };
}
export function parseGoodsGroupFilters(value: unknown): GoodsGroupFilters | null {
  if (!transactionRecord(value) || Object.keys(value).sort().join() !== Object.keys(DEFAULT_GROUP_FILTERS).sort().join()) return null;
  const params = Object.fromEntries(Object.entries(value).map(([key, item]) => [key === 'query' ? 'q' : key, item === null ? '' : String(item)]));
  const parsed = normalizeGoodsGroupFilters(params);
  return Object.entries(parsed).every(([key, item]) => value[key] === item) ? parsed : null;
}
export function goodsGroupConsoleHref(filters: GoodsGroupFilters): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) if (value !== null && value !== '' && value !== DEFAULT_GROUP_FILTERS[key as keyof GoodsGroupFilters]) params.set(key === 'query' ? 'q' : key, String(value));
  return `${GOODS_GROUPS_PATH}${params.size ? `?${params}` : ''}`;
}
export function parseGoodsGroupConsole(value: unknown): GoodsGroupConsole | null {
  if (!transactionRecord(value) || Object.keys(value).sort().join() !== ['rows', 'total', 'page', 'pageSize', 'counts', 'metadata'].sort().join()) return null;
  const page = parseGoodsGroupPage({ rows: value.rows, total: value.total, page: value.page, pageSize: value.pageSize });
  if (!page || !transactionRecord(value.counts) || !transactionRecord(value.metadata) || Object.keys(value.counts).sort().join() !== GROUP_STATUSES.map(row => row.value).sort().join()
    || GROUP_STATUSES.some(({ value: key }) => !transactionInteger((value.counts as Record<string, unknown>)[key]))) return null;
  if (Object.keys(value.metadata).sort().join() !== page.rows.map(row => row.id).sort().join()) return null;
  for (const metadata of Object.values(value.metadata)) if (!transactionRecord(metadata) || Object.keys(metadata).sort().join() !== 'category,createdAt,updatedAt'
    || !transactionInstant(metadata.createdAt) || !transactionInstant(metadata.updatedAt) || metadata.category !== null && typeof metadata.category !== 'string') return null;
  const counts = value.counts as GoodsGroupConsole['counts'];
  if (counts.all !== counts.published + counts.draft + counts.archived || page.total > counts.all) return null;
  return { ...page, counts, metadata: value.metadata as GoodsGroupConsole['metadata'] };
}
