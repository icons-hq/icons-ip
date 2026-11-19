'use server';
import { unstable_rethrow } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { requireAdminActionAccess } from '@/lib/admin/action-access.server';
import {
  COUPON_REVOKE_FALLBACK, COUPON_REVOKE_MAX, COUPON_REVOKE_REASON_MAX, COUPON_REVOKE_REASON_MIN,
  couponRevokeError, parseCouponRevokeResult, type CouponRevokeResult,
} from '@/lib/admin/coupon-revoke';
import { isUuid } from '@/lib/uuid';

/* 지정 발급 쿠폰 개별 회수. 쓰기는 admin_revoke_user_coupons 한 곳이고 같은 작업 ID 재시도는 저장된 결과를 돌려준다. */
const COUPON_REVOKE_PATH = '/admin/sales/coupons';
export type CouponRevokeActionResult = { ok: true; result: CouponRevokeResult } | { ok: false; error: string };

export async function revokeUserCouponsAction(input: { userCouponIds: unknown; reason: unknown; operationId: unknown }): Promise<CouponRevokeActionResult> {
  const ids = Array.isArray(input?.userCouponIds) ? input.userCouponIds : null;
  const reason = typeof input?.reason === 'string' ? input.reason.trim() : '';
  if (!ids || ids.length < 1 || ids.length > COUPON_REVOKE_MAX || !ids.every(isUuid) || new Set(ids).size !== ids.length || !isUuid(input?.operationId)) {
    return { ok: false, error: `회수할 쿠폰을 1~${COUPON_REVOKE_MAX}개 골라주세요.` };
  }
  const length = [...reason].length;
  if (length < COUPON_REVOKE_REASON_MIN || length > COUPON_REVOKE_REASON_MAX) {
    return { ok: false, error: `회수 사유를 ${COUPON_REVOKE_REASON_MIN}~${COUPON_REVOKE_REASON_MAX}자로 적어주세요.` };
  }
  if (!await requireAdminActionAccess(COUPON_REVOKE_PATH, { capability: 'marketing.manage' })) return { ok: false, error: '쿠폰 회수 권한이 필요합니다.' };
  try {
    const { data, error } = await (await createClient()).rpc('admin_revoke_user_coupons', {
      p_user_coupon_ids: ids, p_reason: reason, p_operation_id: input.operationId,
    });
    if (error) return { ok: false, error: couponRevokeError(error.message) };
    const result = parseCouponRevokeResult(data);
    if (!result) return { ok: false, error: '회수 결과를 읽지 못했습니다. 고객 쿠폰 상태를 다시 확인해주세요.' };
    if (result.revokedCount > 0) { revalidatePath('/admin/customers/[userId]', 'page'); revalidatePath('/admin/sales/coupons/issue'); revalidatePath('/admin/sales/benefit-report'); revalidatePath('/my/coupons'); }
    return { ok: true, result };
  } catch (error) { unstable_rethrow(error); return { ok: false, error: COUPON_REVOKE_FALLBACK }; }
}
