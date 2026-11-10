'use server';
import { adminGoodsCopy } from '@/lib/admin/vocabulary';
import { revalidatePath } from 'next/cache';
import { requireAdminScreenAccess } from '@/lib/admin/guard.server';
import { createClient } from '@/lib/supabase/server';
import { normalizePurchaseRestrictionRegistration, normalizePurchaseRestrictionRelease, purchaseRestrictionError, type PurchaseRestrictionCustomer } from '@/lib/admin/purchase-restrictions';
const PATH = '/admin/sales/purchase-restrictions';
export interface RestrictionLookupState { customer?: PurchaseRestrictionCustomer; requestId?: string; error?: string }
export interface RestrictionActionState { error?: string; message?: string }
export async function findPurchaseRestrictionCustomerAction(_state: RestrictionLookupState, form: FormData): Promise<RestrictionLookupState> {
  await requireAdminScreenAccess(PATH);
  const query = String(form.get('customerQuery') ?? '').trim();
  if (!query || query.length > 254) return { error: '고객 ID 또는 정확한 이메일 주소를 입력해주세요.' };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('admin_find_purchase_restriction_customer', { p_query: query });
  if (error) return { error: '고객을 조회하지 못했습니다. 다시 시도해주세요.' };
  if (!data) return { error: '일치하는 고객을 찾을 수 없습니다.' };
  return { customer: data as PurchaseRestrictionCustomer, requestId: crypto.randomUUID() };
}
export async function registerPurchaseRestrictionAction(_state: RestrictionActionState, form: FormData): Promise<RestrictionActionState> {
  await requireAdminScreenAccess(PATH);
  const parsed = normalizePurchaseRestrictionRegistration(form);
  if ('error' in parsed) return { error: parsed.error };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('admin_register_purchase_restriction', {
    p_request_id: parsed.value.requestId, p_user_id: parsed.value.userId, p_reason_code: parsed.value.reasonCode,
    p_reason_detail: parsed.value.reasonDetail, p_evidence_order_id: parsed.value.evidenceOrderId,
  });
  if (error) return { error: purchaseRestrictionError(error.message) };
  revalidatePath(PATH);
  return { message: data?.releasedAt ? '이 요청으로 등록했던 구매제한은 이미 해제되었습니다. 새 등록은 고객을 다시 조회해주세요.' : data?.changed ? adminGoodsCopy('신규 굿즈 주문 구매제한을 등록했습니다.') : '이미 처리된 동일 등록 요청입니다. 목록에서 상태를 확인해주세요.' };
}
export async function releasePurchaseRestrictionAction(_state: RestrictionActionState, form: FormData): Promise<RestrictionActionState> {
  await requireAdminScreenAccess(PATH);
  const parsed = normalizePurchaseRestrictionRelease(form);
  if ('error' in parsed) return { error: parsed.error };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('admin_release_purchase_restriction', { p_restriction_id: parsed.value.restrictionId, p_reason: parsed.value.reason });
  if (error) return { error: purchaseRestrictionError(error.message) };
  revalidatePath(PATH);
  return { message: data?.changed ? '구매제한을 해제했습니다.' : '이미 해제된 구매제한입니다.' };
}
