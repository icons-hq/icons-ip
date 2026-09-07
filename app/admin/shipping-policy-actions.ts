'use server';

import { randomUUID } from 'node:crypto';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import type { AdminCatalogActionState } from '@/app/admin/actions';
import { preserveValues } from '@/lib/admin/form-values';
import { normalizeShippingPolicyForm } from '@/lib/admin/shipping-policies';
import { getCurrentAdminAuthState } from '@/lib/auth/admin';
import { createClient } from '@/lib/supabase/server';

/*
 * 배송·교환반품 정책 액션 (현업 슬라이스 2).
 *
 * 배송비는 이제 코드 상수가 아니라 이 정책에서 나온다 — 화면 견적과 주문 청구가 같은
 * DB 함수(`shipping_fee_for_lines`)를 본다.
 */

const SHIPPING_SETTINGS_PATH = '/admin/settings/shipping';

async function requireStaff(): Promise<AdminCatalogActionState | null> {
  const auth = await getCurrentAdminAuthState();
  if (!auth.isConfigured || !auth.user) redirect('/login?next=%2Fadmin');
  if (!auth.isStaff) return { errors: { form: '관리자 권한이 필요합니다.' } };
  return null;
}

function rpcMessage(message: string, fallback: string) {
  if (message.includes('default_policy_cannot_be_archived')) {
    return '기본 정책은 보관할 수 없습니다. 다른 정책을 기본으로 지정한 뒤 다시 시도해주세요.';
  }
  if (message.includes('policy_not_found')) return '정책을 찾을 수 없습니다.';
  if (message.includes('shipping_policies_fee_shape_check')) {
    return '배송비 유형과 금액·기준이 서로 맞지 않습니다.';
  }
  return fallback;
}

function revalidateShipping() {
  for (const path of [SHIPPING_SETTINGS_PATH, '/admin/catalog/goods', '/cart', '/checkout', '/shop']) {
    revalidatePath(path);
  }
}

export async function upsertShippingPolicyAction(state: AdminCatalogActionState,
  formData: FormData,): Promise<AdminCatalogActionState> {
  return preserveValues(formData, () => run_upsertShippingPolicyAction(state, formData));
}

async function run_upsertShippingPolicyAction(_state: AdminCatalogActionState,
  formData: FormData,): Promise<AdminCatalogActionState> {
  const authError = await requireStaff();
  if (authError) return authError;

  const result = normalizeShippingPolicyForm(formData);
  if (!result.ok) return { errors: result.errors };
  const value = result.value;

  const supabase = await createClient();
  const { error } = await supabase.rpc('admin_upsert_shipping_policy', {
    p_id: value.id,
    p_name: value.name,
    p_method: value.method,
    p_bundling: value.bundling,
    p_fee_kind: value.feeKind,
    p_fee_amount: value.feeAmount,
    p_free_threshold: value.freeThreshold,
    p_remote_surcharge: value.remoteSurcharge,
    p_ship_from_location_id: value.shipFromLocationId,
    p_exchange_location_id: value.exchangeLocationId,
    p_return_location_id: value.returnLocationId,
    p_exchange_fee: value.exchangeFee,
    p_return_fee: value.returnFee,
    p_return_restrictions: value.returnRestrictions,
    p_support_note: value.supportNote,
    p_allow_bank_transfer: value.allowBankTransfer,
    p_is_default: value.isDefault,
    p_request_id: randomUUID(),
  });
  if (error) return { errors: { form: rpcMessage(error.message, '배송 정책을 저장하지 못했습니다.') } };

  revalidateShipping();
  return { message: '배송 정책을 저장했습니다.' };
}

export async function archiveShippingPolicyAction(state: AdminCatalogActionState,
  formData: FormData,): Promise<AdminCatalogActionState> {
  return preserveValues(formData, () => run_archiveShippingPolicyAction(state, formData));
}

async function run_archiveShippingPolicyAction(_state: AdminCatalogActionState,
  formData: FormData,): Promise<AdminCatalogActionState> {
  const authError = await requireStaff();
  if (authError) return authError;

  const id = typeof formData.get('id') === 'string' ? String(formData.get('id')).trim() : '';
  if (!id) return { errors: { form: '정책을 찾을 수 없습니다.' } };

  const supabase = await createClient();
  const { error } = await supabase.rpc('admin_archive_shipping_policy', {
    p_id: id,
    p_request_id: randomUUID(),
  });
  if (error) return { errors: { form: rpcMessage(error.message, '배송 정책을 보관하지 못했습니다.') } };

  revalidateShipping();
  /* 보관한 정책을 쓰던 상품은 기본으로 되돌아간다 — 참조가 남으면 조회가 빈 정책을 만난다. */
  return { message: '배송 정책을 보관했습니다. 이 정책을 쓰던 상품은 기본 정책으로 돌아갑니다.' };
}

export async function setGoodShippingPolicyAction(state: AdminCatalogActionState,
  formData: FormData,): Promise<AdminCatalogActionState> {
  return preserveValues(formData, () => run_setGoodShippingPolicyAction(state, formData));
}

async function run_setGoodShippingPolicyAction(_state: AdminCatalogActionState,
  formData: FormData,): Promise<AdminCatalogActionState> {
  const authError = await requireStaff();
  if (authError) return authError;

  const goodId = typeof formData.get('goodId') === 'string' ? String(formData.get('goodId')).trim() : '';
  const policyId = typeof formData.get('shippingPolicyId') === 'string'
    ? String(formData.get('shippingPolicyId')).trim()
    : '';
  if (!goodId) return { errors: { form: '굿즈를 찾을 수 없습니다.' } };

  const supabase = await createClient();
  const { error } = await supabase.rpc('admin_set_good_shipping_policy', {
    p_good_id: goodId,
    p_policy_id: policyId,
    p_request_id: randomUUID(),
  });
  if (error) return { errors: { form: rpcMessage(error.message, '배송 정책을 연결하지 못했습니다.') } };

  revalidateShipping();
  return { message: policyId ? '배송 정책을 연결했습니다.' : '기본 배송 정책으로 되돌렸습니다.' };
}
