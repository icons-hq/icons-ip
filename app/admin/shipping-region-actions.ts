'use server';

import { revalidatePath } from 'next/cache';
import { unstable_rethrow } from 'next/navigation';
import { getCurrentAdminAuthState } from '@/lib/auth/admin';
import { createClient } from '@/lib/supabase/server';
import { parseShippingRegionPolicy, parseShippingRegionPolicyInput, SHIPPING_REGIONS_PATH, type ShippingRegionPolicy } from '@/lib/admin/shipping-regions';

type Result = { ok: true; policy: ShippingRegionPolicy; message: string } | { ok: false; error: string };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function errorMessage(message: string): string {
  if (message === 'shipping_region_policy_changed') return '다른 관리자가 정책을 변경했습니다. 현재 입력을 보관한 뒤 저장된 정책을 다시 불러와주세요.';
  if (message === 'shipping_region_rules_overlap') return '지역표에 겹치는 우편번호·주소 구간이 있습니다. 각 주소가 한 행에만 해당하도록 수정해주세요.';
  if (message === 'shipping_region_period_overlap') return '같은 출고지·택배사의 적용 기간이 겹칩니다. 기존 정책의 종료·중단 상태를 확인해주세요.';
  if (message === 'shipping_region_carrier_mismatch') return '사용 중인 출고지의 기본 택배사와 실제 계약 택배사가 일치해야 합니다.';
  if (message === 'shipping_region_policy_expired') return '이미 종료된 기간은 활성화할 수 없습니다.';
  if (message === 'shipping_region_policy_immutable') return '활성화한 정책의 내용은 수정할 수 없습니다. 새 버전 초안을 만들어주세요.';
  if (message === 'shipping_region_policy_incomplete' || message === 'shipping_region_attestation_required') return '실제 원본과 필수 항목을 모두 확인한 뒤 활성화해주세요.';
  return '지역 배송 정책을 저장하지 못했습니다. 입력을 확인하고 다시 시도해주세요.';
}
function revalidate() {
  for (const path of [SHIPPING_REGIONS_PATH, '/admin/settings/origins', '/cart', '/checkout']) revalidatePath(path);
}
export async function saveShippingRegionPolicyAction(id: unknown, revision: unknown, value: unknown): Promise<Result> {
  try {
    const auth = await getCurrentAdminAuthState();
    if (!auth.isConfigured || !auth.user || !auth.isStaff || auth.role !== 'admin') return { ok: false, error: '지역 배송 정책은 관리자(admin)만 변경할 수 있습니다.' };
    const input = parseShippingRegionPolicyInput(value);
    if (!input || !(id === null || (typeof id === 'string' && UUID.test(id)))
      || (id === null ? revision !== null : !Number.isSafeInteger(revision) || Number(revision) < 1)) return { ok: false, error: '출고지·택배사와 지역표 입력 형식을 확인해주세요.' };
    const client = await createClient();
    const { data, error } = await client.rpc('admin_save_shipping_region_policy', { p_policy_id: id, p_values: input, p_expected_revision: revision });
    if (error) return { ok: false, error: errorMessage(error.message) };
    const policy = parseShippingRegionPolicy(data);
    if (!policy) return { ok: false, error: '저장 결과를 확인하지 못했습니다. 현재 입력을 보관한 뒤 저장된 정책을 다시 불러와주세요.' };
    revalidate(); return { ok: true, policy, message: '초안을 저장했습니다. 실제 원본과 필수 항목을 확인한 뒤 활성화해주세요.' };
  } catch (error) { unstable_rethrow(error); return { ok: false, error: '정책을 저장하지 못했습니다. 현재 입력은 유지됩니다.' }; }
}
export async function setShippingRegionPolicyStatusAction(id: string, revision: number, status: 'active' | 'retired', attested: boolean): Promise<Result> {
  try {
    const auth = await getCurrentAdminAuthState();
    if (!auth.isConfigured || !auth.user || !auth.isStaff || auth.role !== 'admin') return { ok: false, error: '지역 배송 정책은 관리자(admin)만 변경할 수 있습니다.' };
    if (!UUID.test(id) || !Number.isSafeInteger(revision) || revision < 1 || !['active', 'retired'].includes(status) || attested !== true) {
      return { ok: false, error: '저장된 정책과 원본 확인 항목을 확인해주세요.' };
    }
    const client = await createClient();
    const { data, error } = await client.rpc('admin_set_shipping_region_policy_status', {
      p_policy_id: id, p_status: status, p_expected_revision: revision, p_attested: attested,
    });
    if (error) return { ok: false, error: errorMessage(error.message) };
    const policy = parseShippingRegionPolicy(data);
    if (!policy) return { ok: false, error: '정책의 저장 상태를 확인하지 못했습니다. 페이지를 새로고침해주세요.' };
    revalidate(); return { ok: true, policy, message: status === 'active' ? '정책을 활성화했습니다. 적용 기간과 배송지에 따라 결제 전 배송비를 계산합니다.'
      : '정책을 중단했습니다. 적용할 다른 정책이 없으면 해당 출고지의 신규 주문이 차단됩니다.' };
  } catch (error) { unstable_rethrow(error); return { ok: false, error: '정책 상태를 변경하지 못했습니다. 다시 시도해주세요.' }; }
}
