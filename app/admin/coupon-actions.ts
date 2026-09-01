'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { normalizeAdminCouponForm } from '@/lib/admin/coupons';
import { getCurrentAdminAuthState } from '@/lib/auth/admin';
import { createClient } from '@/lib/supabase/server';

/* 쿠폰 콘솔 저장 액션 (S7 #329).
 * 검증·감사·코드 불변 계약은 admin_upsert_coupon(security definer)이 진실원이고,
 * 여기서는 폼 정규화와 에러 번역만 한다. */

export interface AdminCouponActionState {
  errors?: Record<string, string> & { form?: string };
  message?: string;
}

async function requireStaffAction(): Promise<AdminCouponActionState | null> {
  const auth = await getCurrentAdminAuthState();
  if (!auth.isConfigured || !auth.user) redirect(`/login?next=${encodeURIComponent('/admin')}`);
  if (!auth.isStaff) return { errors: { form: '관리자 권한이 필요합니다.' } };
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
  return null;
}

export async function upsertAdminCouponAction(
  _state: AdminCouponActionState,
  formData: FormData,
): Promise<AdminCouponActionState> {
  const authError = await requireStaffAction();
  if (authError) return authError;

  const result = normalizeAdminCouponForm(formData);
  if (!result.ok) return { errors: result.errors };

  const supabase = await createClient();
  const { error } = await supabase.rpc('admin_upsert_coupon', {
    target_code: result.value.code,
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
  });

  if (error) {
    return couponWriteIntentFailure(error.message)
      ?? { errors: { form: '쿠폰을 저장하지 못했습니다. 다시 시도해주세요.' } };
  }

  revalidatePath('/admin/sales/coupons');
  return { message: `${result.value.code} 쿠폰을 저장했습니다.` };
}
