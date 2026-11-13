import { isUuid } from '@/lib/uuid';
export type CouponRecipientSegment = 'all' | 'first_purchase' | 'repeat_purchase';
export type CouponGoodsScope = 'all' | 'selected_goods' | 'selected_categories' | 'selected_ips';
export const COUPON_GOODS_SCOPES: readonly CouponGoodsScope[] = ['all', 'selected_goods', 'selected_categories', 'selected_ips'];
/** IP ids follow the catalog slug rule (lowercase, digits, hyphen). */
export const COUPON_TARGET_IP_ID = /^[a-z0-9][a-z0-9-]{0,99}$/;
export interface CouponTargeting {
  recipientSegment: CouponRecipientSegment;
  goodsScope: CouponGoodsScope;
  targetGoodIds: string[];
  targetCategoryIds?: string[];
  /** IP coupons follow each good's current IP, including goods added later. */
  targetIpIds?: string[];
  issuanceMode?: 'code' | 'targeted';
}
export interface CouponTargetGood { id: string; code: string; name: string; archivedAt?: string | null }
export interface CouponTargetCategory { id: string; name: string; path: string; blocked: boolean }
export interface CouponTargetIp { id: string; title: string; blocked: boolean }
export interface CouponQuote {
  userCouponId: string; couponCode: string; eligibleSubtotal: number; discount: number; reason: string | null;
}
function object(value: unknown): value is Record<string, unknown> { return Boolean(value) && typeof value === 'object' && !Array.isArray(value); }
function amount(value: unknown): value is number { return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value <= 999_999_999_999; }
export function parseCouponQuote(value: unknown): CouponQuote | null {
  if (!object(value) || typeof value.userCouponId !== 'string' || !isUuid(value.userCouponId)
    || typeof value.couponCode !== 'string' || !/^[A-Z0-9][A-Z0-9-]{2,23}$/.test(value.couponCode)
    || !amount(value.eligibleSubtotal) || !amount(value.discount) || value.discount > value.eligibleSubtotal
    || !(value.reason === null || typeof value.reason === 'string' && /^coupon_[a-z_]+$/.test(value.reason))
    || value.reason !== null && value.discount !== 0 || value.reason === null && value.discount === 0) return null;
  return value as unknown as CouponQuote;
}
export function parseCouponTargetingRecord(value: unknown): CouponTargeting | null {
  if (!object(value) || typeof value.recipientSegment !== 'string' || !['all', 'first_purchase', 'repeat_purchase'].includes(value.recipientSegment)
    || typeof value.goodsScope !== 'string' || !COUPON_GOODS_SCOPES.includes(value.goodsScope as CouponGoodsScope) || !Array.isArray(value.targetGoodIds)
    || value.targetGoodIds.length > 1000 || value.targetGoodIds.some(id => typeof id !== 'string' || !id.trim() || id.length > 200)
    || new Set(value.targetGoodIds).size !== value.targetGoodIds.length || value.goodsScope !== 'selected_goods' && value.targetGoodIds.length > 0
    || value.issuanceMode !== undefined && value.issuanceMode !== 'code' && value.issuanceMode !== 'targeted'
    || value.goodsScope === 'selected_categories' && !Array.isArray(value.targetCategoryIds)
    || value.targetCategoryIds !== undefined && (!Array.isArray(value.targetCategoryIds) || value.targetCategoryIds.length > 100
      || value.targetCategoryIds.some(id => typeof id !== 'string' || !isUuid(id))
      || new Set(value.targetCategoryIds).size !== value.targetCategoryIds.length
      || value.goodsScope !== 'selected_categories' && value.targetCategoryIds.length > 0)
    || value.goodsScope === 'selected_ips' && !Array.isArray(value.targetIpIds)
    || value.targetIpIds !== undefined && (!Array.isArray(value.targetIpIds) || value.targetIpIds.length > 100
      || value.targetIpIds.some(id => typeof id !== 'string' || !COUPON_TARGET_IP_ID.test(id))
      || new Set(value.targetIpIds).size !== value.targetIpIds.length
      || value.goodsScope !== 'selected_ips' && value.targetIpIds.length > 0)) return null;
  return value as unknown as CouponTargeting;
}
export function parseCouponTargetCategories(value: unknown): CouponTargetCategory[] | null {
  if (!Array.isArray(value) || value.length > 100 || value.some(item => !object(item) || typeof item.id !== 'string' || !isUuid(item.id)
    || typeof item.name !== 'string' || !item.name || typeof item.path !== 'string' || !item.path || typeof item.blocked !== 'boolean')
    || new Set(value.map(item => item.id)).size !== value.length) return null;
  return value as CouponTargetCategory[];
}
export function parseCouponTargetIps(value: unknown): CouponTargetIp[] | null {
  if (!Array.isArray(value) || value.length > 100 || value.some(item => !object(item) || typeof item.id !== 'string' || !COUPON_TARGET_IP_ID.test(item.id)
    || typeof item.title !== 'string' || !item.title || typeof item.blocked !== 'boolean')
    || new Set(value.map(item => item.id)).size !== value.length) return null;
  return value as CouponTargetIp[];
}
export function parseCouponTargetGoods(value: unknown): CouponTargetGood[] | null {
  if (!Array.isArray(value) || value.some(item => !object(item) || typeof item.id !== 'string' || !item.id
    || typeof item.code !== 'string' || !item.code || typeof item.name !== 'string' || !item.name
    || !(item.archivedAt === undefined || item.archivedAt === null || typeof item.archivedAt === 'string' && Number.isFinite(Date.parse(item.archivedAt))))) return null;
  return value as CouponTargetGood[];
}
export function couponTargetingLabel(value: Partial<CouponTargeting>): string {
  const recipient = value.issuanceMode === 'targeted' ? '지정 고객' : value.recipientSegment === 'first_purchase' ? '첫구매 고객' : value.recipientSegment === 'repeat_purchase' ? '재구매 고객' : '전체 고객';
  return `${recipient} · ${value.goodsScope === 'selected_goods' ? `선택 굿즈 ${value.targetGoodIds?.length ?? 0}종` : value.goodsScope === 'selected_categories' ? `선택 카테고리 ${value.targetCategoryIds?.length ?? 0}개` : value.goodsScope === 'selected_ips' ? `선택 IP ${value.targetIpIds?.length ?? 0}개` : '전체 굿즈'}`;
}
