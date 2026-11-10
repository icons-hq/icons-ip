import { normalizeAdminCouponForm } from '../../lib/admin/coupons';
import { withPreservedFormValues } from '../../lib/admin/form-state';
import { FIXTURE_GOODS } from './fixtures';
import type { AdminCouponActionState } from '../../app/admin/coupon-actions';
export async function upsertAdminCouponAction(state: AdminCouponActionState, data: FormData): Promise<AdminCouponActionState> {
  const parsed = normalizeAdminCouponForm(data);
  return withPreservedFormValues({ errors: parsed.ok ? { form: '합성 검수용 저장 실패: 입력을 보존합니다.' } : parsed.errors }, state, data);
}
export async function setAdminCouponStatusAction(): Promise<AdminCouponActionState> { return { errors: { form: '합성 검수용 상태 변경 실패: 실제 쿠폰은 바뀌지 않습니다.' } }; }
export async function searchCouponTargetGoodsAction(query: string, page = 1) {
  const items = FIXTURE_GOODS.filter(good => `${good.name} ${good.code}`.includes(query)).map(good => ({ id: good.id, code: good.code, name: good.name }));
  return { ok: true as const, items, total: items.length, page, pageSize: 20 };
}
export async function searchCouponCategoriesAction() {
  return { error: '합성 검수에서는 카테고리 검색을 제공하지 않습니다.' };
}
