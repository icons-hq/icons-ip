/** 운영자 화면 전용 문구(ADR-0014 운영 어휘). 고객 화면은 이 모듈을 쓰지 않는다. */
import { COUPON_GOODS_SCOPES, COUPON_TARGET_IP_ID, type CouponGoodsScope, type CouponRecipientSegment, type CouponTargeting } from '@/lib/coupon-targeting';
import { isUuid } from '@/lib/uuid';

export function parseCouponTargeting(form: FormData): { ok: true; value: CouponTargeting } | { ok: false; errors: Record<string, string> } {
  const read = (name: string) => typeof form.get(name) === 'string' ? String(form.get(name)).trim() : '';
  const segment = read('recipientSegment') || 'all'; const scope = read('goodsScope') || 'all';
  const errors: Record<string, string> = {};
  if (!['all', 'first_purchase', 'repeat_purchase'].includes(segment)) errors.recipientSegment = '발급 대상 고객을 선택해주세요.';
  if (!COUPON_GOODS_SCOPES.includes(scope as CouponGoodsScope)) errors.goodsScope = '할인 대상 상품 범위를 선택해주세요.';
  const mode = read('issuanceMode') || 'code';
  if (!['code', 'targeted'].includes(mode)) errors.issuanceMode = '쿠폰 발급 방식을 선택해주세요.';
  let ids: string[] = [];
  try {
    const input: unknown = JSON.parse(read('targetGoodIds') || '[]');
    if (!Array.isArray(input) || input.length > 1000 || input.some(value => typeof value !== 'string' || !value.trim() || value.length > 200 || /[\u0000-\u001f\u007f]/.test(value))) throw new Error('invalid');
    ids = [...new Set(input.map(value => (value as string).trim()))].sort();
  } catch { errors.targetGoodIds = '할인 대상 상품을 다시 선택해주세요.'; }
  if (scope === 'selected_goods' && !ids.length && read('status') !== 'archived') errors.targetGoodIds = '선택 상품 쿠폰을 활성화하려면 대상 상품이 필요합니다.';
  if (scope !== 'selected_goods') ids = [];
  let categoryIds: string[] = [];
  try {
    const input: unknown = JSON.parse(read('targetCategoryIds') || '[]');
    if (!Array.isArray(input) || input.length > 100 || input.some(id => typeof id !== 'string' || !isUuid(id))) throw new Error('invalid');
    categoryIds = [...new Set(input as string[])].sort();
  } catch { errors.targetCategoryIds = '할인 대상 카테고리를 다시 선택해주세요.'; }
  if (scope === 'selected_categories' && !categoryIds.length && read('status') !== 'archived') errors.targetCategoryIds = '카테고리 쿠폰을 활성화하려면 대상 카테고리가 필요합니다.';
  if (scope !== 'selected_categories') categoryIds = [];
  let ipIds: string[] = [];
  try {
    const input: unknown = JSON.parse(read('targetIpIds') || '[]');
    if (!Array.isArray(input) || input.length > 100 || input.some(id => typeof id !== 'string' || !COUPON_TARGET_IP_ID.test(id))) throw new Error('invalid');
    ipIds = [...new Set(input as string[])].sort();
  } catch { errors.targetIpIds = '할인 대상 IP를 다시 선택해주세요.'; }
  if (scope === 'selected_ips' && !ipIds.length && read('status') !== 'archived') errors.targetIpIds = 'IP 쿠폰을 활성화하려면 대상 IP가 필요합니다.';
  if (scope !== 'selected_ips') ipIds = [];
  return Object.keys(errors).length ? { ok: false, errors } : { ok: true, value: { recipientSegment: segment as CouponRecipientSegment, goodsScope: scope as CouponGoodsScope, targetGoodIds: ids,
    ...(form.has('targetCategoryIds') || scope === 'selected_categories' ? { targetCategoryIds: categoryIds } : {}),
    ...(form.has('targetIpIds') || scope === 'selected_ips' ? { targetIpIds: ipIds } : {}),
    ...(form.has('issuanceMode') ? { issuanceMode: mode as 'code' | 'targeted' } : {}),
  } };
}
