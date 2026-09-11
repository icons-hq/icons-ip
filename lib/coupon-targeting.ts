export type CouponRecipientSegment = 'all' | 'first_purchase' | 'repeat_purchase';
export type CouponGoodsScope = 'all' | 'selected_goods';
export interface CouponTargeting {
  recipientSegment: CouponRecipientSegment;
  goodsScope: CouponGoodsScope;
  targetGoodIds: string[];
}
export interface CouponTargetGood { id: string; code: string; name: string; archivedAt?: string | null }
export interface CouponQuote {
  userCouponId: string; couponCode: string; eligibleSubtotal: number; discount: number; reason: string | null;
}
function object(value: unknown): value is Record<string, unknown> { return Boolean(value) && typeof value === 'object' && !Array.isArray(value); }
function amount(value: unknown): value is number { return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value <= 999_999_999_999; }
export function parseCouponQuote(value: unknown): CouponQuote | null {
  if (!object(value) || typeof value.userCouponId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value.userCouponId)
    || typeof value.couponCode !== 'string' || !/^[A-Z0-9][A-Z0-9-]{2,23}$/.test(value.couponCode)
    || !amount(value.eligibleSubtotal) || !amount(value.discount) || value.discount > value.eligibleSubtotal
    || !(value.reason === null || typeof value.reason === 'string' && /^coupon_[a-z_]+$/.test(value.reason))
    || value.reason !== null && value.discount !== 0 || value.reason === null && value.discount === 0) return null;
  return value as unknown as CouponQuote;
}
export function parseCouponTargetingRecord(value: unknown): CouponTargeting | null {
  if (!object(value) || typeof value.recipientSegment !== 'string' || !['all', 'first_purchase', 'repeat_purchase'].includes(value.recipientSegment)
    || typeof value.goodsScope !== 'string' || !['all', 'selected_goods'].includes(value.goodsScope) || !Array.isArray(value.targetGoodIds)
    || value.targetGoodIds.length > 1000 || value.targetGoodIds.some(id => typeof id !== 'string' || !id.trim() || id.length > 200)
    || new Set(value.targetGoodIds).size !== value.targetGoodIds.length || value.goodsScope === 'all' && value.targetGoodIds.length > 0) return null;
  return value as unknown as CouponTargeting;
}
export function parseCouponTargetGoods(value: unknown): CouponTargetGood[] | null {
  if (!Array.isArray(value) || value.some(item => !object(item) || typeof item.id !== 'string' || !item.id
    || typeof item.code !== 'string' || !item.code || typeof item.name !== 'string' || !item.name
    || !(item.archivedAt === undefined || item.archivedAt === null || typeof item.archivedAt === 'string' && Number.isFinite(Date.parse(item.archivedAt))))) return null;
  return value as CouponTargetGood[];
}
export function parseCouponTargeting(form: FormData): { ok: true; value: CouponTargeting } | { ok: false; errors: Record<string, string> } {
  const read = (name: string) => typeof form.get(name) === 'string' ? String(form.get(name)).trim() : '';
  const segment = read('recipientSegment') || 'all'; const scope = read('goodsScope') || 'all';
  const errors: Record<string, string> = {};
  if (!['all', 'first_purchase', 'repeat_purchase'].includes(segment)) errors.recipientSegment = '발급 대상 고객을 선택해주세요.';
  if (!['all', 'selected_goods'].includes(scope)) errors.goodsScope = '할인 대상 상품 범위를 선택해주세요.';
  let ids: string[] = [];
  try {
    const input: unknown = JSON.parse(read('targetGoodIds') || '[]');
    if (!Array.isArray(input) || input.length > 1000 || input.some(value => typeof value !== 'string' || !value.trim() || value.length > 200 || /[\u0000-\u001f\u007f]/.test(value))) throw new Error('invalid');
    ids = [...new Set(input.map(value => (value as string).trim()))].sort();
  } catch { errors.targetGoodIds = '할인 대상 상품을 다시 선택해주세요.'; }
  if (scope === 'selected_goods' && !ids.length && read('status') !== 'archived') errors.targetGoodIds = '선택 상품 쿠폰을 활성화하려면 대상 상품이 필요합니다.';
  if (scope === 'all') ids = [];
  return Object.keys(errors).length ? { ok: false, errors } : { ok: true, value: { recipientSegment: segment as CouponRecipientSegment, goodsScope: scope as CouponGoodsScope, targetGoodIds: ids } };
}
export function couponTargetingLabel(value: Partial<CouponTargeting>): string {
  const recipient = value.recipientSegment === 'first_purchase' ? '첫구매 고객' : value.recipientSegment === 'repeat_purchase' ? '재구매 고객' : '전체 고객';
  return `${recipient} · ${value.goodsScope === 'selected_goods' ? `선택 굿즈 ${value.targetGoodIds?.length ?? 0}종` : '전체 굿즈'}`;
}
