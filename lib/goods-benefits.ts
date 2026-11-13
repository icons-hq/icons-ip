import { parseAdminArtworkPath } from '@/lib/admin/artwork';
import { isUuid } from '@/lib/uuid';

export const GOODS_EVENT_TEMPLATES_PATH = '/admin/catalog/event-templates';
export interface GoodsBenefitValues { eventText: string; giftText: string; giftImagePaths: string[] }
export interface GoodsBenefitSnapshot extends GoodsBenefitValues { goodId: string; goodName: string; revision: number; updatedAt: string | null }
export interface GoodsEventTemplate { id: string; eventText: string; revision: number; archived: boolean; createdAt: string }
export interface GoodsEventTemplatePage { rows: GoodsEventTemplate[]; total: number; page: number; pageSize: 20 }
const object = (value: unknown): Record<string, unknown> | null => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
const copy = (value: unknown, maximum: number): value is string => typeof value === 'string' && Array.from(value).length <= maximum && !/[\x00-\x1f\x7f-\x9f]/.test(value);
export function parseGoodsBenefitValues(value: unknown): GoodsBenefitValues | null {
  const data = object(value);
  if (!data || !copy(data.eventText, 40) || !copy(data.giftText, 100) || !Array.isArray(data.giftImagePaths) || data.giftImagePaths.length > 3
    || data.giftImagePaths.some(path => typeof path !== 'string' || !path.startsWith('public-media/') || parseAdminArtworkPath(path.slice('public-media/'.length))?.kind !== 'good')
    || new Set(data.giftImagePaths).size !== data.giftImagePaths.length || (data.giftImagePaths.length > 0 && !data.giftText.trim())) return null;
  return { eventText: data.eventText.trim(), giftText: data.giftText.trim(), giftImagePaths: [...data.giftImagePaths] as string[] };
}
export function parseGoodsBenefitSnapshot(value: unknown): GoodsBenefitSnapshot | null {
  const data = object(value), values = parseGoodsBenefitValues(value);
  if (!data || !values || typeof data.goodId !== 'string' || !/^[a-z0-9][a-z0-9-]*$/.test(data.goodId)
    || typeof data.goodName !== 'string' || !Number.isSafeInteger(data.revision) || Number(data.revision) < 0
    || !(data.updatedAt === null || typeof data.updatedAt === 'string' && Number.isFinite(Date.parse(data.updatedAt)))) return null;
  return { ...values, goodId: data.goodId, goodName: data.goodName, revision: Number(data.revision), updatedAt: data.updatedAt as string | null };
}
export function parseGoodsEventTemplate(value: unknown): GoodsEventTemplate | null {
  const data = object(value);
  if (!data || typeof data.id !== 'string' || !isUuid(data.id) || !copy(data.eventText, 40) || !data.eventText.trim()
    || !Number.isSafeInteger(data.revision) || Number(data.revision) < 1 || typeof data.archived !== 'boolean'
    || typeof data.createdAt !== 'string' || !Number.isFinite(Date.parse(data.createdAt))) return null;
  return { id: data.id, eventText: data.eventText.trim(), revision: Number(data.revision), archived: data.archived, createdAt: data.createdAt };
}
export function parseGoodsEventTemplatePage(value: unknown): GoodsEventTemplatePage | null {
  const data = object(value);
  if (!data || !Array.isArray(data.rows) || data.rows.length > 20 || data.pageSize !== 20
    || !Number.isSafeInteger(data.total) || Number(data.total) < 0 || !Number.isSafeInteger(data.page) || Number(data.page) < 1) return null;
  const rows = data.rows.map(parseGoodsEventTemplate);
  if (rows.some(row => row === null) || new Set(rows.map(row => row?.id)).size !== rows.length) return null;
  return { rows: rows as GoodsEventTemplate[], total: Number(data.total), page: Number(data.page), pageSize: 20 };
}
