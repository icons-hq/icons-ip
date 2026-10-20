import 'server-only';
import { createClient } from '@/lib/supabase/server';
import { isUuid } from '@/lib/uuid';
import { blankGoodsAnnouncement, GOODS_ANNOUNCEMENT_CATEGORIES, GOODS_ANNOUNCEMENT_DEVICES, GOODS_ANNOUNCEMENT_STATES,
  type GoodsAnnouncement, type GoodsAnnouncementCandidates, type GoodsAnnouncementFilters, type GoodsAnnouncementGood,
  type GoodsAnnouncementListData, type GoodsAnnouncementListRow } from './goods-announcements';

const object = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const instant = (value: unknown) => value === null || (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(value) && Number.isFinite(Date.parse(value)));
const nonnegative = (value: unknown) => Number.isSafeInteger(value) && Number(value) >= 0;
function validBase(value: Record<string, unknown>) {
  return isUuid(value.id) && Number.isSafeInteger(value.reference) && Number(value.reference) > 0 && typeof value.title === 'string'
    && GOODS_ANNOUNCEMENT_CATEGORIES.some(item => item.value === value.category) && GOODS_ANNOUNCEMENT_DEVICES.some(item => item.value === value.device)
    && ['enabled', 'important', 'allGoods'].every(key => typeof value[key] === 'boolean')
    && ['startsAt', 'endsAt', 'createdAt', 'updatedAt'].every(key => instant(value[key]))
    && !(typeof value.startsAt === 'string' && typeof value.endsAt === 'string' && Date.parse(value.startsAt) >= Date.parse(value.endsAt))
    && Number.isSafeInteger(value.revision) && Number(value.revision) > 0;
}
export function parseAnnouncementGoods(value: unknown): GoodsAnnouncementGood[] | null {
  if (!Array.isArray(value) || value.some(item => !object(item) || typeof item.id !== 'string' || !item.id || typeof item.name !== 'string'
    || typeof item.code !== 'string' || typeof item.archived !== 'boolean')) return null;
  return value as GoodsAnnouncementGood[];
}
export function parseGoodsAnnouncement(value: unknown): GoodsAnnouncement | null {
  if (!object(value) || !validBase(value) || typeof value.body !== 'string' || !['plain', 'html'].includes(String(value.format))) return null;
  if (!validRange(value.importantStartsAt, value.importantEndsAt) || !parsePopupSelection(value.popup)) return null;
  const goods = parseAnnouncementGoods(value.goods);
  return goods ? { ...value, goods } as unknown as GoodsAnnouncement : null;
}
function validRange(start: unknown, end: unknown) {
  return (start === null && end === null) || (typeof start === 'string' && typeof end === 'string' && instant(start) && instant(end) && Date.parse(start) < Date.parse(end));
}
function parsePopupSelection(value: unknown): GoodsAnnouncement['popup'] | null {
  if (!object(value) || typeof value.selected !== 'boolean' || !nonnegative(value.revision) || !validRange(value.startsAt, value.endsAt)
    || (value.selected ? value.startsAt === null : value.startsAt !== null)) return null;
  return { selected: value.selected, revision: Number(value.revision), startsAt: value.startsAt as string | null, endsAt: value.endsAt as string | null };
}
export async function loadGoodsAnnouncements(filters: GoodsAnnouncementFilters): Promise<GoodsAnnouncementListData> {
  const client = await createClient();
  const { data, error } = await client.rpc('admin_list_goods_announcements', { p_query: filters.query, p_field: filters.field,
    p_category: filters.category, p_state: filters.state, p_from: filters.from || null, p_to: filters.to || null,
    p_limit: filters.pageSize, p_offset: (filters.page - 1) * filters.pageSize });
  if (error || !object(data) || !nonnegative(data.total) || !Array.isArray(data.rows) || data.rows.some(row => !object(row) || !validBase(row)
    || !nonnegative(row.goodCount) || !GOODS_ANNOUNCEMENT_STATES.some(item => item.value === row.state))) throw new Error('상품 공지사항을 불러오지 못했습니다. 잠시 후 다시 시도해주세요.');
  const lastPage = Math.max(1, Math.ceil(Number(data.total) / filters.pageSize));
  if (filters.page > lastPage) return loadGoodsAnnouncements({ ...filters, page: lastPage });
  return { rows: data.rows as GoodsAnnouncementListRow[], total: Number(data.total), filters };
}
export async function loadGoodsAnnouncement(id: string, allowNew = false): Promise<GoodsAnnouncement | null> {
  const client = await createClient(); const { data, error } = await client.rpc('admin_get_goods_announcement_editor_context', { p_id: id });
  if (error) throw new Error('상품 공지를 불러오지 못했습니다. 잠시 후 다시 시도해주세요.');
  const popup = object(data) ? parsePopupSelection(data.popup) : null;
  if (!object(data) || !popup) throw new Error('상품 공지 응답을 확인하지 못했습니다.');
  if (data.announcement === null) {
    if (popup.selected) throw new Error('상품 공지 응답을 확인하지 못했습니다.');
    return allowNew ? { ...blankGoodsAnnouncement(id), popup } : null;
  }
  const value = object(data.announcement) ? parseGoodsAnnouncement({ ...data.announcement, popup }) : null;
  if (!value || value.id !== id) throw new Error('상품 공지 응답을 확인하지 못했습니다.');
  return value;
}
export async function searchGoodsForAnnouncement(query: string, page: number): Promise<GoodsAnnouncementCandidates> {
  const client = await createClient(); const { data, error } = await client.rpc('admin_search_goods_for_announcement', { p_query: query, p_page: page });
  const rows = object(data) ? parseAnnouncementGoods(data.rows) : null;
  if (error || !object(data) || !rows || !nonnegative(data.total) || !Number.isSafeInteger(data.page) || Number(data.page) < 1 || data.pageSize !== 20) throw new Error('상품을 불러오지 못했습니다. 잠시 후 다시 시도해주세요.');
  return { rows, total: Number(data.total), page: Number(data.page), pageSize: 20 };
}
