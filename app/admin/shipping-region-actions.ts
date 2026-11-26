'use server';

import { revalidateGoodsSurfaces } from '@/lib/admin/revalidate-goods.server';
import { isUuid } from '@/lib/uuid';

import { revalidatePath } from 'next/cache';
import { unstable_rethrow } from 'next/navigation';
import { requireAdminActionAccess } from '@/lib/admin/action-access.server';
import { createClient } from '@/lib/supabase/server';
import { formatOrderDateTime } from '@/lib/orders';
import { parseShippingRegionFees, parseShippingRegionPolicy, parseShippingRegionPolicyInput, SHIPPING_REGIONS_PATH, type ShippingRegionPolicy } from '@/lib/admin/shipping-regions';

type Result = { ok: true; policy: ShippingRegionPolicy; message: string } | { ok: false; error: string };
/** 적용 결과. `replaced`는 함께 끝냈거나 끝을 맞춘 설정이고, 실패의 `policies`는 방금 다시 읽은 목록이다(확인창을 새로 띄우는 데 쓴다). */
export type ShippingRegionApplyResult = { ok: true; policy: ShippingRegionPolicy; replaced: ShippingRegionPolicy[]; message: string }
  | { ok: false; error: string; policies?: ShippingRegionPolicy[] };
const ADMIN_ONLY = '지역별 추가배송비는 최고 관리자만 바꿀 수 있습니다.';
function errorMessage(message: string): string {
  if (message === 'shipping_region_policy_changed') return '다른 사람이 먼저 바꿨습니다. 적어 둔 내용을 따로 복사해 두고, 새로고침한 뒤 다시 해 주세요.';
  if (message === 'shipping_region_replace_changed') return '적용 중인 설정이 방금 바뀌었습니다. 다시 누르면 무엇이 바뀌는지 새로 확인할 수 있습니다.';
  if (message === 'shipping_region_rules_overlap') return '지역표에 우편번호·주소 범위가 겹치는 줄이 있습니다. 한 주소가 한 줄에만 맞도록 고쳐 주세요.';
  if (message === 'shipping_region_period_overlap') return '같은 출고지에 적용 기간이 겹치는 설정이 있습니다. 새로고침해 지금 설정을 확인한 뒤 다시 해 주세요.';
  if (message === 'shipping_region_period_invalid') return '적용 종료는 적용 시작보다 뒤여야 합니다. 적용 종료를 고쳐 주세요.';
  if (message === 'shipping_region_carrier_mismatch') return '이 출고지에는 지금 적용할 수 없습니다. 배송정보 관리와 택배사 관리에서 출고지와 기본 택배사가 모두 ‘사용’인지, 기본 택배사가 이 설정의 택배사와 같은지 확인해 주세요.';
  if (message === 'shipping_region_policy_expired') return '적용 종료가 이미 지난 설정입니다. 새로 적용하려면 적용 종료를 지금보다 뒤로 고쳐 주세요.';
  if (message === 'shipping_region_policy_immutable') return '이미 적용한 설정은 고칠 수 없습니다. 설정을 열어 [이 내용으로 새로 만들기]로 새로 만들어 주세요.';
  if (message === 'shipping_region_identity_immutable') return '저장해 둔 설정의 출고지와 택배사는 바꿀 수 없습니다. [새로 만들기]로 다시 만들어 주세요.';
  if (message === 'shipping_region_policy_incomplete') return '아직 채우지 않은 칸이 있습니다. 이름·적용 기간·지역표를 확인한 뒤 다시 눌러 주세요.';
  if (message === 'shipping_region_status_invalid') return '이미 끝난 설정입니다. 새로고침해 상태를 확인해 주세요.';
  if (message === 'shipping_region_policy_not_active') return '지금 적용 중인 설정만 금액을 바꿀 수 있습니다. 새로고침해 상태를 확인해 주세요.';
  if (message === 'shipping_region_fees_unchanged') return '바뀐 금액이 없습니다. 새 금액을 적은 뒤 다시 눌러 주세요.';
  if (message === 'shipping_region_fees_invalid') return '추가배송비는 0원부터 1,000,000원까지 원 단위 숫자로 적어 주세요.';
  if (message === 'shipping_region_fee_label_unknown') return '지역표에 없는 지역명이 있습니다. 새로고침해 지금 설정의 지역명을 다시 불러와 주세요.';
  if (message === 'operator_capability_required' || message === 'admin required') return ADMIN_ONLY;
  return '저장하지 못했습니다. 출고지와 지역표를 확인한 뒤 다시 해 주세요.';
}
function revalidate() {
  revalidateGoodsSurfaces();
  for (const path of [SHIPPING_REGIONS_PATH, '/admin/settings/origins']) revalidatePath(path);
}
const validTarget = (id: unknown, revision: unknown) => id === null ? revision === null
  : typeof id === 'string' && isUuid(id) && Number.isSafeInteger(revision) && Number(revision) >= 1;
const INPUT_INVALID = '출고지를 고르고 지역표를 다시 확인해 주세요. 그래도 저장되지 않으면 새로고침한 뒤 다시 해 주세요.';

/** 적용하지 않고 저장한다('준비 중'). 주문에는 쓰이지 않고, 비어 있는 칸이 있어도 저장된다. */
export async function saveShippingRegionPolicyAction(id: unknown, revision: unknown, value: unknown): Promise<Result> {
  try {
    const auth = await requireAdminActionAccess(SHIPPING_REGIONS_PATH, { adminOnly: true, capability: 'platform.manage' });
    if (!auth) return { ok: false, error: ADMIN_ONLY };
    const input = parseShippingRegionPolicyInput(value);
    if (!input || !validTarget(id, revision)) return { ok: false, error: INPUT_INVALID };
    const client = await createClient();
    const { data, error } = await client.rpc('admin_save_shipping_region_policy', { p_policy_id: id, p_values: input, p_expected_revision: revision });
    if (error) return { ok: false, error: errorMessage(error.message) };
    const policy = parseShippingRegionPolicy(data);
    if (!policy) return { ok: false, error: '저장됐는지 확인하지 못했습니다. 적어 둔 내용을 따로 복사해 두고, 새로고침해 목록에 ‘준비 중’으로 있는지 확인해 주세요.' };
    revalidate(); return { ok: true, policy, message: '적용하지 않고 저장했습니다. 아직 주문에는 적용되지 않습니다. 적용하려면 [저장하고 적용]을 눌러 주세요.' };
  } catch (error) { unstable_rethrow(error); return { ok: false, error: '저장하지 못했습니다. 적어 둔 내용은 그대로 있으니 다시 눌러 주세요.' }; }
}

/**
 * 저장과 적용을 한 번에 한다. DB `admin_apply_shipping_region_policy`가 한 트랜잭션에서 저장하고, 기간이 겹치는
 * 적용 중인 설정을 함께 정리한다(`replaceIds` — 확인창에 보여 준 목록). 목록이 그 사이에 달라졌으면 아무것도 바꾸지 않고
 * 방금 읽은 목록을 돌려준다. 반쪽만 저장되는 일은 없다.
 */
export async function applyShippingRegionPolicyAction(id: unknown, revision: unknown, value: unknown, replaceIds: unknown, startNow: unknown): Promise<ShippingRegionApplyResult> {
  try {
    const auth = await requireAdminActionAccess(SHIPPING_REGIONS_PATH, { adminOnly: true, capability: 'platform.manage' });
    if (!auth) return { ok: false, error: ADMIN_ONLY };
    const input = parseShippingRegionPolicyInput(value);
    if (!input || !validTarget(id, revision) || typeof startNow !== 'boolean'
      || !Array.isArray(replaceIds) || replaceIds.length > 100 || !replaceIds.every((item) => typeof item === 'string' && isUuid(item))) {
      return { ok: false, error: INPUT_INVALID };
    }
    const client = await createClient();
    const { data, error } = await client.rpc('admin_apply_shipping_region_policy', {
      p_policy_id: id, p_values: input, p_expected_revision: revision, p_replace_policy_ids: replaceIds, p_start_now: startNow,
    });
    if (error) {
      if (error.message !== 'shipping_region_replace_changed') return { ok: false, error: errorMessage(error.message) };
      /* 확인창에 보인 '바뀌는 설정'이 실제와 다르다. 지금 목록을 돌려줘 화면이 다시 계산하게 한다(적어 둔 내용은 그대로 둔다). */
      const fresh = await client.rpc('admin_list_shipping_region_policies');
      const policies = Array.isArray(fresh.data?.policies) ? fresh.data.policies.map(parseShippingRegionPolicy) : null;
      return policies && policies.every((policy: ShippingRegionPolicy | null): policy is ShippingRegionPolicy => policy !== null)
        ? { ok: false, error: errorMessage(error.message), policies }
        : { ok: false, error: '적용 중인 설정이 방금 바뀌었습니다. 적어 둔 내용을 따로 복사해 두고, 새로고침한 뒤 다시 해 주세요.' };
    }
    const policy = data && typeof data === 'object' ? parseShippingRegionPolicy((data as { policy?: unknown }).policy) : null;
    const replacedRows: unknown = data && typeof data === 'object' ? (data as { replaced?: unknown }).replaced : null;
    const replaced = Array.isArray(replacedRows) ? replacedRows.map(parseShippingRegionPolicy) : null;
    if (!policy || !replaced || replaced.some((row) => !row)) {
      return { ok: false, error: '적용됐는지 확인하지 못했습니다. 다시 누르지 말고 새로고침해 목록에서 상태를 확인해 주세요.' };
    }
    revalidate();
    const scheduled = policy.startsAt !== null && Date.parse(policy.startsAt) > Date.now();
    return { ok: true, policy, replaced: replaced as ShippingRegionPolicy[], message: scheduled
      ? `저장했습니다. ${formatOrderDateTime(policy.startsAt!)}부터 들어오는 주문에 적용됩니다.`
      : '적용했습니다. 지금부터 새 주문에 적용되고, 이미 들어온 주문의 배송비는 그대로입니다.' };
  } catch (error) { unstable_rethrow(error); return { ok: false, error: '적용됐는지 확인하지 못했습니다. 다시 누르지 말고 새로고침해 목록에서 상태를 확인해 주세요.' }; }
}

/** 적용 중이거나 예정인 설정을 끝낸다. 끝낸 설정은 다시 적용할 수 없다(새로 만들어 적용한다). */
export async function endShippingRegionPolicyAction(id: unknown, revision: unknown): Promise<Result> {
  try {
    const auth = await requireAdminActionAccess(SHIPPING_REGIONS_PATH, { adminOnly: true, capability: 'platform.manage' });
    if (!auth) return { ok: false, error: ADMIN_ONLY };
    if (typeof id !== 'string' || !isUuid(id) || !Number.isSafeInteger(revision) || Number(revision) < 1) {
      return { ok: false, error: '새로고침한 뒤 설정을 다시 열어 끝내 주세요.' };
    }
    const client = await createClient();
    /* 확인은 화면의 확인창이 받는다. DB의 확인 인자는 그대로 두고 true를 보낸다. */
    const { data, error } = await client.rpc('admin_set_shipping_region_policy_status', {
      p_policy_id: id, p_status: 'retired', p_expected_revision: revision, p_attested: true,
    });
    if (error) return { ok: false, error: errorMessage(error.message) };
    const policy = parseShippingRegionPolicy(data);
    if (!policy) return { ok: false, error: '끝냈는지 확인하지 못했습니다. 새로고침해 목록에서 상태를 확인해 주세요.' };
    revalidate(); return { ok: true, policy, message: '끝냈습니다. 이미 들어온 주문의 배송비는 그대로입니다.' };
  } catch (error) { unstable_rethrow(error); return { ok: false, error: '끝내지 못했습니다. 다시 눌러 주세요.' }; }
}

/**
 * 적용 중인 설정의 지역명별 추가배송비만 바꾼다. DB가 같은 지역표·기간으로 새 설정을 바로 적용하고 이전 설정을 같은
 * 트랜잭션에서 끝내므로, 그 사이에 새 주문이 막히는 틈이 없다. 지난 주문의 배송비는 그대로다.
 */
export async function changeShippingRegionFeesAction(id: unknown, revision: unknown, fees: unknown): Promise<Result & { replacedId?: string }> {
  try {
    const auth = await requireAdminActionAccess(SHIPPING_REGIONS_PATH, { adminOnly: true, capability: 'platform.manage' });
    if (!auth) return { ok: false, error: ADMIN_ONLY };
    const parsedFees = parseShippingRegionFees(fees);
    if (typeof id !== 'string' || !isUuid(id) || !Number.isSafeInteger(revision) || Number(revision) < 1) {
      return { ok: false, error: '새로고침한 뒤 설정을 다시 열어 금액을 바꿔 주세요.' };
    }
    if (!parsedFees) return { ok: false, error: errorMessage('shipping_region_fees_invalid') };
    const client = await createClient();
    const { data, error } = await client.rpc('admin_change_shipping_region_fees', { p_policy_id: id, p_expected_revision: revision, p_fees: parsedFees });
    if (error) return { ok: false, error: errorMessage(error.message) };
    const policy = parseShippingRegionPolicy(data);
    if (!policy) return { ok: false, error: '금액이 바뀌었는지 확인하지 못했습니다. 다시 누르지 말고 새로고침해 적용 중인 금액을 확인해 주세요.' };
    revalidate();
    return { ok: true, policy, replacedId: id, message: '추가배송비를 바꿨습니다. 지금부터 새 주문에 적용되고, 이미 들어온 주문의 배송비는 그대로입니다.' };
  } catch (error) { unstable_rethrow(error); return { ok: false, error: '금액이 바뀌었는지 확인하지 못했습니다. 새로고침해 적용 중인 금액을 확인한 뒤, 바뀌지 않았으면 다시 눌러 주세요.' }; }
}
