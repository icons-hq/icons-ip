'use server';

import { revalidateGoodsSurfaces } from '@/lib/admin/revalidate-goods.server';
import { isUuid } from '@/lib/uuid';

import { revalidatePath } from 'next/cache';
import { unstable_rethrow } from 'next/navigation';
import { requireAdminActionAccess } from '@/lib/admin/action-access.server';
import { createClient } from '@/lib/supabase/server';
import { parseShippingRegionPolicy, parseShippingRegionPolicyInput, SHIPPING_REGIONS_PATH, type ShippingRegionPolicy } from '@/lib/admin/shipping-regions';

type Result = { ok: true; policy: ShippingRegionPolicy; message: string } | { ok: false; error: string };
function errorMessage(message: string): string {
  if (message === 'shipping_region_policy_changed') return '다른 관리자가 먼저 정책을 바꿨습니다. 지금 입력한 내용은 따로 복사해 두고, 새로고침해 저장된 정책을 다시 불러와주세요.';
  if (message === 'shipping_region_rules_overlap') return '지역표에 겹치는 우편번호·주소 구간이 있습니다. 한 주소가 지역표의 한 줄에만 해당하도록 고쳐주세요.';
  if (message === 'shipping_region_period_overlap') return '같은 출고지·택배사에 적용 기간이 겹치는 정책이 있습니다. 겹치는 기존 정책을 먼저 중단하거나 적용 기간이 겹치지 않게 고쳐주세요.';
  if (message === 'shipping_region_carrier_mismatch') return '계약 택배사가 출고지의 기본 택배사와 다릅니다. 배송정보 관리에서 출고지의 기본 택배사를 확인하고 같은 택배사로 골라주세요.';
  if (message === 'shipping_region_policy_expired') return '적용 종료 일시가 이미 지났습니다. 종료 일시를 고쳐 초안을 저장한 뒤 활성화해주세요.';
  if (message === 'shipping_region_policy_immutable') return '활성화한 정책은 내용을 고칠 수 없습니다. 정책을 열어 [이 정책으로 새 버전 초안 만들기]로 새 버전을 만든 뒤 고쳐주세요.';
  if (message === 'shipping_region_policy_incomplete' || message === 'shipping_region_attestation_required') return '물류사 원본 회신·계약 근거와 필수 항목을 모두 채우고, 원본과 일치함을 확인하는 칸을 체크한 뒤 활성화해주세요.';
  return '지역 배송 정책을 저장하지 못했습니다. 입력을 확인하고 다시 시도해주세요.';
}
function revalidate() {
  revalidateGoodsSurfaces();
  for (const path of [SHIPPING_REGIONS_PATH, '/admin/settings/origins']) revalidatePath(path);
}
export async function saveShippingRegionPolicyAction(id: unknown, revision: unknown, value: unknown): Promise<Result> {
  try {
    const auth = await requireAdminActionAccess(SHIPPING_REGIONS_PATH, { adminOnly: true, capability: 'platform.manage' });
    if (!auth) return { ok: false, error: '지역 배송 정책은 최고 관리자만 변경할 수 있습니다.' };
    const input = parseShippingRegionPolicyInput(value);
    if (!input || !(id === null || (typeof id === 'string' && isUuid(id)))
      || (id === null ? revision !== null : !Number.isSafeInteger(revision) || Number(revision) < 1)) return { ok: false, error: '출고지·택배사와 지역표 입력 형식을 확인해주세요.' };
    const client = await createClient();
    const { data, error } = await client.rpc('admin_save_shipping_region_policy', { p_policy_id: id, p_values: input, p_expected_revision: revision });
    if (error) return { ok: false, error: errorMessage(error.message) };
    const policy = parseShippingRegionPolicy(data);
    if (!policy) return { ok: false, error: '저장 결과를 확인하지 못했습니다. 지금 입력한 내용은 따로 복사해 두고, 새로고침해 저장됐는지 확인해주세요.' };
    revalidate(); return { ok: true, policy, message: '초안을 저장했습니다. 실제 원본과 필수 항목을 확인한 뒤 활성화해주세요.' };
  } catch (error) { unstable_rethrow(error); return { ok: false, error: '정책을 저장하지 못했습니다. 현재 입력은 유지됩니다.' }; }
}
export async function setShippingRegionPolicyStatusAction(id: string, revision: number, status: 'active' | 'retired', attested: boolean): Promise<Result> {
  try {
    const auth = await requireAdminActionAccess(SHIPPING_REGIONS_PATH, { adminOnly: true, capability: 'platform.manage' });
    if (!auth) return { ok: false, error: '지역 배송 정책은 최고 관리자만 변경할 수 있습니다.' };
    if (!isUuid(id) || !Number.isSafeInteger(revision) || revision < 1 || !['active', 'retired'].includes(status) || attested !== true) {
      return { ok: false, error: '원본과 일치함을 확인하는 칸을 체크해주세요. 체크했는데도 이 안내가 나오면 새로고침한 뒤 다시 시도해주세요.' };
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
