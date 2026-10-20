import { isUuid } from '@/lib/uuid';

export const GOODS_AFTER_SALES_TEMPLATES_PATH = '/admin/catalog/after-sales-templates';
export interface GoodsAfterSalesValues { phone: string; guide: string; sellerSpecialNotes: string }
export interface GoodsAfterSalesSnapshot extends GoodsAfterSalesValues { goodId: string; goodName: string; revision: number; updatedAt: string | null }
export interface GoodsAfterSalesTemplate extends GoodsAfterSalesValues { id: string; revision: number; archived: boolean; createdAt: string }
export interface GoodsAfterSalesTemplatePage { rows: GoodsAfterSalesTemplate[]; total: number; page: number; pageSize: 20 }
export const EMPTY_GOODS_AFTER_SALES: GoodsAfterSalesValues = { phone: '', guide: '', sellerSpecialNotes: '' };
const object = (value: unknown): Record<string, unknown> | null => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
const trim = (value: string) => value.replace(/\r\n?/g, '\n').replace(/^[ \n\t]+|[ \n\t]+$/g, '');
export function parseGoodsAfterSalesValues(value: unknown, allowEmpty = false): GoodsAfterSalesValues | null {
  const data = object(value);
  if (!data || typeof data.phone !== 'string' || typeof data.guide !== 'string' || typeof data.sellerSpecialNotes !== 'string') return null;
  const phone = trim(data.phone), guide = trim(data.guide), sellerSpecialNotes = trim(data.sellerSpecialNotes);
  if (allowEmpty && !phone && !guide && !sellerSpecialNotes) return { ...EMPTY_GOODS_AFTER_SALES };
  if (!phone || Array.from(phone).length > 20 || /[\x00-\x1f\x7f-\x9f]/.test(phone)
    || !guide || Array.from(guide).length > 1300 || /[\x00-\x08\x0b-\x1f\x7f-\x9f]/.test(guide)
    || Array.from(sellerSpecialNotes).length > 1300 || /[\x00-\x08\x0b-\x1f\x7f-\x9f]/.test(sellerSpecialNotes)) return null;
  return { phone, guide, sellerSpecialNotes };
}
export function parseGoodsAfterSalesSnapshot(value: unknown): GoodsAfterSalesSnapshot | null {
  const data = object(value);
  if (!data || typeof data.goodId !== 'string' || !/^[a-z0-9][a-z0-9-]*$/.test(data.goodId)
    || typeof data.goodName !== 'string' || !Number.isSafeInteger(data.revision) || Number(data.revision) < 0
    || !(data.updatedAt === null || typeof data.updatedAt === 'string' && Number.isFinite(Date.parse(data.updatedAt)))) return null;
  const values = data.revision === 0 && data.phone === '' && data.guide === '' && data.sellerSpecialNotes === '' && data.updatedAt === null ? EMPTY_GOODS_AFTER_SALES : parseGoodsAfterSalesValues(data, true);
  if (!values || (data.revision === 0 && values.phone)) return null;
  return { ...values, goodId: data.goodId, goodName: data.goodName, revision: Number(data.revision), updatedAt: data.updatedAt as string | null };
}
export function parseGoodsAfterSalesTemplate(value: unknown): GoodsAfterSalesTemplate | null {
  const data = object(value), values = parseGoodsAfterSalesValues(value);
  if (!data || !values || typeof data.id !== 'string' || !isUuid(data.id)
    || !Number.isSafeInteger(data.revision) || Number(data.revision) < 1 || typeof data.archived !== 'boolean'
    || typeof data.createdAt !== 'string' || !Number.isFinite(Date.parse(data.createdAt))) return null;
  return { ...values, id: data.id, revision: Number(data.revision), archived: data.archived, createdAt: data.createdAt };
}
export function parseGoodsAfterSalesTemplatePage(value: unknown): GoodsAfterSalesTemplatePage | null {
  const data = object(value);
  if (!data || !Array.isArray(data.rows) || data.rows.length > 20 || data.pageSize !== 20
    || !Number.isSafeInteger(data.total) || Number(data.total) < 0 || !Number.isSafeInteger(data.page) || Number(data.page) < 1) return null;
  const rows = data.rows.map(parseGoodsAfterSalesTemplate);
  if (rows.some(row => row === null) || new Set(rows.map(row => row?.id)).size !== rows.length) return null;
  return { rows: rows as GoodsAfterSalesTemplate[], total: Number(data.total), page: Number(data.page), pageSize: 20 };
}
export function goodsAfterSalesError(message?: string): string {
  if (message === 'operation_conflict') return '저장 요청의 계정 또는 입력 정보가 달라졌습니다. 저장된 내용을 다시 불러와 확인해주세요.';
  if (message === 'goods_after_sales_changed' || message === 'goods_after_sales_template_changed') return '다른 저장 결과가 있습니다. 입력은 유지했습니다. 저장된 내용을 다시 확인해주세요.';
  if (message === 'good_not_found') return '상품을 찾을 수 없거나 보관된 상품입니다. 상품 목록에서 현재 상태를 확인해주세요.';
  if (message === 'operator_capability_required') return '현재 상품 관리 권한을 확인해주세요.';
  return '저장하지 못했습니다. 전화번호 20자·A/S 안내 1,300자·판매자 특이사항 1,300자와 현재 권한을 확인해주세요.';
}
