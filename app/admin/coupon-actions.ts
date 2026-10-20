'use server';

import { revalidatePath } from 'next/cache';
import { redirect, unstable_rethrow } from 'next/navigation';
import {
  normalizeAdminCouponForm,
} from '@/lib/admin/coupons';
import { withPreservedFormValues, type AdminFormValuesState } from '@/lib/admin/form-state';
import { hasAdminCapability } from '@/lib/admin/access';
import { getCurrentAdminAuthState } from '@/lib/auth/admin';
import { createClient } from '@/lib/supabase/server';

/* 쿠폰 콘솔 저장 액션 (S7 #329).
 * 검증·감사·코드 불변 계약은 admin_upsert_coupon(security definer)이 진실원이고,
 * 여기서는 폼 정규화와 에러 번역만 한다. */

export interface AdminCouponActionState extends AdminFormValuesState {
  errors?: Record<string, string> & { form?: string };
  message?: string;
  savedCode?: string;
  openTargetIssuance?: boolean;
}

async function requireStaffAction(): Promise<AdminCouponActionState | null> {
  const auth = await getCurrentAdminAuthState();
  if (!auth.isConfigured || !auth.user) redirect(`/login?next=${encodeURIComponent('/admin')}`);
  if (!auth.isStaff || !hasAdminCapability(auth, 'marketing.manage')) return { errors: { form: '관리자 권한이 필요합니다.' } };
  return null;
}

/* 신규 등록이 기존 레코드를 덮어쓰지 못하게 막은 RPC의 응답을 운영자 언어로 옮긴다. */
function couponWriteIntentFailure(message: string): AdminCouponActionState | null {
  if (message.includes('catalog_id_taken')) {
    return { errors: { code: '이미 사용 중인 코드입니다. 수정하려면 목록에서 선택해주세요.' } };
  }
  if (message.includes('catalog_record_missing')) {
    return { errors: { form: '수정할 쿠폰을 찾을 수 없습니다. 목록을 새로고침한 뒤 다시 시도해주세요.' } };
  }
  if (message.includes('catalog_id_immutable')) {
    return { errors: { code: '등록된 코드는 변경할 수 없습니다.' } };
  }
  if (message.includes('coupon_issued_benefit_immutable')) return { errors: { form: '발급된 쿠폰의 상품·배송비 할인 구분, 중복 사용 조건과 발급 방식은 바꿀 수 없습니다. 새 혜택으로 복사해주세요.' } };
  if (message.includes('coupon_targeted_grade_exclusive')) return { errors: { gradeBenefit: '고객 지정 쿠폰은 등급 자동 발급과 함께 설정할 수 없습니다.' } };
  if (message.includes('coupon_target_category_unavailable') || message.includes('coupon_category_scope_ready') || message.includes('coupon_category_changed')) return { errors: { targetCategoryIds: '할인 대상 카테고리의 설정과 현재 상태를 다시 확인해주세요.' } };
  if (message.includes('coupon_terms_changed')) return { errors: { form: '다른 작업에서 쿠폰 조건이 변경됐습니다. 목록을 새로고침한 뒤 다시 확인해주세요.' } };
  if (message.includes('coupon_target_good_unavailable') || message.includes('coupon_goods_scope_ready')) return { errors: { targetGoodIds: '할인 대상 상품의 설정과 현재 상태를 다시 확인해주세요.' } };
  return null;
}

export async function upsertAdminCouponAction(
  state: AdminCouponActionState,
  formData: FormData,
): Promise<AdminCouponActionState> {
  try {
    const result = await saveAdminCoupon(formData);
    return result.errors ? withPreservedFormValues(result, state, formData) : result;
  } catch (error) {
    unstable_rethrow(error);
    return withPreservedFormValues({ errors: { form: '쿠폰을 저장하지 못했습니다. 다시 시도해주세요.' } }, state, formData);
  }
}

async function saveAdminCoupon(formData: FormData): Promise<AdminCouponActionState> {
  const authError = await requireStaffAction();
  if (authError) return authError;

  const result = normalizeAdminCouponForm(formData);
  if (!result.ok) return { errors: result.errors };

  const supabase = await createClient();
  const { error } = await supabase.rpc('admin_upsert_coupon_scheduled', { target_payload: {
    target_code: result.value.code, target_benefit_kind: result.value.benefitKind, target_stackable: result.value.stackable,
    target_name: result.value.name,
    target_discount_type: result.value.discountType,
    target_discount_value: result.value.discountValue,
    target_max_discount_amount: result.value.maxDiscountAmount,
    target_min_subtotal: result.value.minSubtotal,
    target_starts_at: result.value.startsAt,
    target_ends_at: result.value.endsAt,
    target_issue_limit: result.value.issueLimit,
    target_status: result.value.status,
    target_grade_benefit: result.value.gradeBenefit,
    target_previous_code: result.value.previousCode,
    target_recipient_segment: result.value.recipientSegment,
    target_goods_scope: result.value.goodsScope,
    target_good_ids: result.value.targetGoodIds,
    target_category_ids: result.value.targetCategoryIds ?? [],
    target_issuance_mode: result.value.issuanceMode ?? 'code',
    target_expected_revision: result.value.expectedRevision,
    target_issue_starts_at: result.value.issueStartsAt,
    target_issue_ends_at: result.value.issueEndsAt,
    target_valid_days: result.value.validDays,
  } });

  if (error) {
    const intentFailure = couponWriteIntentFailure(error.message);
    return intentFailure ?? { errors: { form: '쿠폰을 저장하지 못했습니다. 다시 시도해주세요.' } };
  }

  revalidatePath('/admin/sales/coupons');
  revalidatePath('/cart');
  revalidatePath('/checkout');
  revalidatePath('/my/coupons');
  return { message: `${result.value.code} 쿠폰을 저장했습니다.`, savedCode: result.value.code,
    ...(result.value.issuanceMode === 'targeted' && !result.value.previousCode ? { openTargetIssuance: true } : {}),
  };
}

export async function setAdminCouponStatusAction(_state: AdminCouponActionState, formData: FormData): Promise<AdminCouponActionState> {
  const authError = await requireStaffAction(); if (authError) return authError;
  const code = String(formData.get('code') ?? '');
  const revision = Number(formData.get('revision'));
  const status = String(formData.get('status') ?? '');
  if (!/^[A-Z0-9][A-Z0-9-]{2,23}$/.test(code) || !Number.isSafeInteger(revision) || revision < 1 || !['active', 'archived'].includes(status)) {
    return { errors: { form: '쿠폰 상태와 버전을 확인해주세요.' } };
  }
  try {
    const supabase = await createClient();
    const { error } = await supabase.rpc('admin_set_coupon_status', { p_code: code, p_expected_revision: revision, p_status: status });
    if (error) return couponWriteIntentFailure(error.message) ?? { errors: { form: '혜택 상태를 변경하지 못했습니다.' } };
    revalidatePath('/admin/sales/coupons'); revalidatePath('/my/coupons'); revalidatePath('/cart'); revalidatePath('/checkout');
    return { message: status === 'archived' ? '혜택을 중지했습니다.' : '혜택을 다시 적용했습니다.' };
  } catch (error) { unstable_rethrow(error); return { errors: { form: '혜택 상태를 변경하지 못했습니다.' } }; }
}
