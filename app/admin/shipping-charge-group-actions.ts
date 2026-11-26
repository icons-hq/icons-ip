'use server';

import { revalidatePath } from 'next/cache';
import { unstable_rethrow } from 'next/navigation';
import { requireAdminActionAccess } from '@/lib/admin/action-access.server';
import { revalidateGoodsSurfaces } from '@/lib/admin/revalidate-goods.server';
import { createClient } from '@/lib/supabase/server';
import { isUuid } from '@/lib/uuid';
import { transactionEpochMicros, transactionGoodId } from '@/lib/goods-transaction-values';
import { CHANGED_BY_OTHER, SAVE_UNKNOWN_MESSAGE } from '@/lib/admin/goods-template-save';
import {
  SHIPPING_CHARGE_GROUPS_PATH, SHIPPING_CHARGE_GROUP_BLOCKER_LABELS, SHIPPING_CHARGE_GROUP_RUNTIME_OFF, SHIPPING_CHARGE_GROUP_STOP_LABEL, parseShippingChargeGroupAssignRequest, parseShippingChargeGroupFilters, parseShippingChargeGroupGoodsFilters,
  parseShippingChargeGroupIdentity, parseShippingChargeGroupOperationContext, parseShippingChargeGroupOperationReceipt, parseShippingChargeGroupSaveRequest,
  shippingChargeGroupReceiptMatches, shippingChargeGroupValuesMatch,
  type ShippingChargeGroupAssignmentPreview, type ShippingChargeGroupAssignRequest, type ShippingChargeGroupData, type ShippingChargeGroupFilters,
  type ShippingChargeGroupGoodData, type ShippingChargeGroupGoodsData, type ShippingChargeGroupGoodsFilters, type ShippingChargeGroupIdentity,
  type ShippingChargeGroupListData, type ShippingChargeGroupOperationContext, type ShippingChargeGroupOperationReceipt, type ShippingChargeGroupSaveRequest,
} from '@/lib/admin/shipping-charge-groups';
import { loadGoodShippingChargeGroup, loadShippingChargeGroup, loadShippingChargeGroups, previewShippingChargeGroupAssignment,
  searchShippingChargeGroupGoods, ShippingChargeGroupReadError } from '@/lib/admin/shipping-charge-groups.server';

/** `uncertain`: 저장됐는지 모른다. `changed`: 다른 사람이 먼저 바꿔 저장하지 않았다. `conflict`: DB가 충돌로 거절했다(다른 저장이 진행 중인 경우 포함). */
export type ShippingChargeGroupActionResult<T> = { data: T } | { error: string; uncertain?: boolean; conflict?: boolean; changed?: boolean; authChanged?: boolean };
const invalid = () => ({ error: '보낸 값의 형식이 맞지 않아 저장하지 않았습니다. 화면을 새로고침한 뒤 다시 해 주세요.' });
const invalidRead = () => ({ error: '조회 조건의 형식이 맞지 않아 불러오지 못했습니다. 화면을 새로고침한 뒤 다시 해 주세요.' });
const denied = () => ({ error: '로그인이 끊겼거나 이 일을 할 권한이 없습니다. 지금 로그인한 계정으로 화면을 새로고침한 뒤 다시 해 주세요.', authChanged: true });
const unknown = () => ({ error: SAVE_UNKNOWN_MESSAGE, uncertain: true });
const readFailed = () => ({ error: '배송비 묶음그룹을 불러오지 못했습니다. 잠시 뒤 다시 해 주세요.' });
const uuid = (value: unknown): value is string => typeof value === 'string' && isUuid(value) && value === value.toLowerCase();
const goodId = (value: unknown): value is string => transactionGoodId(value) && value.length <= 120;

async function authorize(identity: ShippingChargeGroupIdentity) {
  const access = await requireAdminActionAccess(SHIPPING_CHARGE_GROUPS_PATH, { capability: 'catalog.manage' });
  if (!access || access.user.id !== identity.expectedActorId) return null;
  const client = await createClient(), claims = await client.auth.getClaims();
  return !claims.error && claims.data?.claims.sub === access.user.id && claims.data.claims.session_id === identity.expectedSessionId ? client : null;
}
/*
 * DB가 이유를 들어 거절한 저장의 안내. 왼쪽은 DB 오류 이름의 일부이고(앞에서부터 처음 맞는 줄을 쓴다), 오른쪽은 고칠 방법까지 적은 문장이다.
 * 다른 사람이 먼저 바꾼 경우(`…_changed`)는 화면이 지금 저장된 내용을 다시 읽어 두 길(내 입력으로 덮어쓰기 / 내 입력 버리기)을 보인다.
 */
const REJECTED: readonly (readonly [key: string, message: string, changed?: boolean])[] = [
  ['region_confirmation_required', '지역별 추가배송비가 바뀌는 저장인데 확인을 거치지 않았습니다. 화면을 새로고침해 묶음그룹을 다시 연 뒤 저장해 주세요.'],
  ['region_unavailable', "지역표의 택배사가 출고지의 기본 택배사와 다르거나 '사용 안 함'입니다. 지역표의 택배사를 출고지의 기본 택배사로 맞춘 뒤 다시 저장해 주세요."],
  ['region_policy_incomplete', "지역표나 적용 기간에 빠진 것이 있습니다. 적용 시작·종료, '표에 없는 지역', 지역표를 확인한 뒤 다시 저장해 주세요."],
  ['region_rules_overlap', '지역표에 우편번호·주소 범위가 겹치는 줄이 있습니다. 한 주소가 한 줄에만 맞도록 고친 뒤 다시 저장해 주세요.'],
  ['region_period_invalid', '적용 종료를 적용 시작보다 뒤로 고친 뒤 다시 저장해 주세요.'],
  ['group_changed', `${CHANGED_BY_OTHER} 지금 저장된 묶음그룹을 확인한 뒤 다시 해 주세요.`, true],
  ['default_changed', `${CHANGED_BY_OTHER} 이 출고지의 추천 묶음그룹이 바뀌었습니다. 지금 저장된 내용을 확인한 뒤 다시 저장해 주세요.`, true],
  ['origin_changed', `${CHANGED_BY_OTHER} 출고지 설정이 바뀌었습니다. 지금 저장된 내용을 확인한 뒤 다시 해 주세요.`, true],
  ['goods_changed', '그사이 상품이나 상품의 배송 설정이 바뀌었습니다. 상품을 다시 고르거나 미리보기를 다시 만들어 주세요.', true],
  ['assignment_changed', '그사이 상품의 묶음그룹이 바뀌었습니다. 상품을 다시 고르거나 미리보기를 다시 만들어 주세요.', true],
  ['origin_immutable', '묶음그룹의 출고지는 바꿀 수 없습니다. 다른 출고지에는 묶음그룹을 새로 만들어 주세요.'],
  ['origin_unavailable', "출고지가 없거나 '사용 안 함'입니다. 배송정보 관리에서 출고지를 '사용'으로 바꾼 뒤 다시 해 주세요."],
  ['origin_mismatch', '상품과 묶음그룹의 출고지가 다릅니다. 같은 출고지의 묶음그룹을 골라 주세요.'],
  ['has_assignments', "상품이 들어 있는 묶음그룹은 '사용 안 함'으로 바꾸거나 보관할 수 없습니다. 목록의 상품 수를 눌러 상품을 먼저 빼거나 다른 묶음그룹으로 옮겨 주세요."],
  ['group_unavailable', "묶음그룹이 '사용 안 함'이거나 보관돼 있습니다. 묶음그룹을 '사용'으로 바꾼 뒤 다시 해 주세요."],
  ['goods_unavailable', '지워졌거나 보관된 상품이 들어 있습니다. 상품을 다시 골라 주세요.'],
  ['owned_by_source', `${SHIPPING_CHARGE_GROUP_BLOCKER_LABELS.goods_aggregation_policy_owned_by_source}. 그 상품을 빼고 다시 해 주세요.`],
  /* DB는 막힌 이유의 이름(`collect_contract_not_ready`)을 그대로 오류로 던진다. 배송비 결제가 착불·구매자 선택인 상품인데 그 출고지에 '사용'인 착불 조건이 없을 때다. */
  ['collect_contract_not_ready', "착불을 쓰는 상품인데 이 출고지에 '사용'으로 저장한 착불 조건이 없습니다. 배송정보 관리에서 출고지의 착불 조건을 먼저 '사용'으로 저장한 뒤 다시 해 주세요."],
  ['operation_conflict', `앞서 누른 저장과 내용이 달라 이어서 저장하지 못했습니다. [${SHIPPING_CHARGE_GROUP_STOP_LABEL}]를 누른 뒤 처음부터 다시 해 주세요.`],
  ['retry', '다른 저장이 진행 중이라 저장하지 않았습니다. 잠시 뒤 다시 눌러 주세요.'],
  ['checkout_contract_upgrade_required', SHIPPING_CHARGE_GROUP_RUNTIME_OFF],
];
function failure(code: string | undefined, message: string, fallback = '저장하지 못했습니다. 화면을 새로고침해 지금 저장된 내용을 확인한 뒤 다시 해 주세요.'): Exclude<ShippingChargeGroupActionResult<never>, { data: never }> {
  if (code === '42501' || code === '28000') return denied();
  if (!['PT409', '22023', '23514', '23503', 'P0002', '23505', '55000'].includes(code ?? '')) return unknown();
  const rejected = REJECTED.find(([key]) => message.includes(key));
  return { error: rejected?.[1] ?? fallback, uncertain: false, conflict: code === 'PT409' || code === '23505', changed: Boolean(rejected?.[2]) };
}
function readFailure(error: unknown): Exclude<ShippingChargeGroupActionResult<never>, { data: never }> {
  unstable_rethrow(error);
  if (error instanceof ShippingChargeGroupReadError) {
    const result = failure(error.code, error.reason, readFailed().error); return result.uncertain ? readFailed() : result;
  }
  return readFailed();
}
function refresh(receipt: ShippingChargeGroupOperationReceipt) {
  if (receipt.state === 'sealed') return;
  // A lost response can be recovered even if cache invalidation failed.
  try { revalidateGoodsSurfaces(); revalidatePath(SHIPPING_CHARGE_GROUPS_PATH); revalidatePath('/admin/settings/shipping-templates'); } catch { /* Keep the committed receipt. */ }
}

export async function listShippingChargeGroupsAction(filters: ShippingChargeGroupFilters, identity: ShippingChargeGroupIdentity): Promise<ShippingChargeGroupActionResult<ShippingChargeGroupListData>> {
  if (!parseShippingChargeGroupFilters(filters) || !parseShippingChargeGroupIdentity(identity)) return invalidRead();
  try { if (!await authorize(identity)) return denied(); return { data: await loadShippingChargeGroups(filters, identity) }; }
  catch (error) { return readFailure(error); }
}
export async function getShippingChargeGroupAction(groupId: string, identity: ShippingChargeGroupIdentity): Promise<ShippingChargeGroupActionResult<ShippingChargeGroupData>> {
  if (!uuid(groupId) || !parseShippingChargeGroupIdentity(identity)) return invalidRead();
  try { if (!await authorize(identity)) return denied(); return { data: await loadShippingChargeGroup(groupId, identity) }; }
  catch (error) { return readFailure(error); }
}
export async function getGoodShippingChargeGroupAction(id: string, identity: ShippingChargeGroupIdentity): Promise<ShippingChargeGroupActionResult<ShippingChargeGroupGoodData>> {
  if (!goodId(id) || !parseShippingChargeGroupIdentity(identity)) return invalidRead();
  try { if (!await authorize(identity)) return denied(); return { data: await loadGoodShippingChargeGroup(id, identity) }; }
  catch (error) { return readFailure(error); }
}
export async function findShippingChargeGroupGoodsAction(filters: ShippingChargeGroupGoodsFilters, identity: ShippingChargeGroupIdentity): Promise<ShippingChargeGroupActionResult<ShippingChargeGroupGoodsData>> {
  if (!parseShippingChargeGroupGoodsFilters(filters) || !parseShippingChargeGroupIdentity(identity)) return invalidRead();
  try { if (!await authorize(identity)) return denied(); return { data: await searchShippingChargeGroupGoods(filters, identity) }; }
  catch (error) { return readFailure(error); }
}
export async function previewShippingChargeGroupAssignmentAction(groupId: string | null, goodIds: string[], identity: ShippingChargeGroupIdentity): Promise<ShippingChargeGroupActionResult<ShippingChargeGroupAssignmentPreview>> {
  if (!(groupId === null || uuid(groupId)) || !parseShippingChargeGroupIdentity(identity) || !Array.isArray(goodIds) || !goodIds.length
    || goodIds.length > 100 || goodIds.some(id => !goodId(id)) || new Set(goodIds).size !== goodIds.length) return invalidRead();
  try { if (!await authorize(identity)) return denied(); return { data: await previewShippingChargeGroupAssignment(groupId, goodIds, identity) }; }
  catch (error) { return readFailure(error); }
}
export async function saveShippingChargeGroupAction(raw: ShippingChargeGroupSaveRequest): Promise<ShippingChargeGroupActionResult<ShippingChargeGroupOperationReceipt>> {
  const input = parseShippingChargeGroupSaveRequest(raw); if (!input) return invalid();
  try {
    const client = await authorize(input); if (!client) return denied();
    const { data, error } = await client.rpc('admin_save_shipping_charge_group', { p_request: input });
    if (error) return failure(error.code, error.message);
    const receipt = parseShippingChargeGroupOperationReceipt(data);
    if (!receipt || !shippingChargeGroupReceiptMatches(receipt, input)) return unknown();
    if (receipt.state === 'sealed') return { data: receipt };
    if (receipt.state !== 'saved' || !receipt.group || receipt.group.originId !== input.originId
      || !shippingChargeGroupValuesMatch(receipt.group, input.values)) return unknown();
    const replacesDefault = input.values.isDefault && input.expectedDefaultGroupId !== null && input.expectedDefaultGroupId !== input.groupId;
    if (replacesDefault ? !receipt.changedDefaultGroup || receipt.changedDefaultGroup.id !== input.expectedDefaultGroupId
      || receipt.changedDefaultGroup.revision !== input.expectedDefaultGroupRevision + 1 : receipt.changedDefaultGroup !== null) return unknown();
    refresh(receipt); return { data: receipt };
  } catch (error) { unstable_rethrow(error); return unknown(); }
}
export async function assignShippingChargeGroupAction(raw: ShippingChargeGroupAssignRequest): Promise<ShippingChargeGroupActionResult<ShippingChargeGroupOperationReceipt>> {
  const input = parseShippingChargeGroupAssignRequest(raw); if (!input) return invalid();
  try {
    const client = await authorize(input); if (!client) return denied();
    const { data, error } = await client.rpc('admin_assign_shipping_charge_group', { p_request: input });
    if (error) return failure(error.code, error.message);
    const receipt = parseShippingChargeGroupOperationReceipt(data);
    if (!receipt || !shippingChargeGroupReceiptMatches(receipt, input)) return unknown();
    if (receipt.state === 'sealed') return { data: receipt };
    if (receipt.state !== 'assigned' || receipt.appliedCount !== input.goods.length || receipt.goods.some(after => {
      const before = input.goods.find(good => good.id === after.id);
      if (!before || after.ownerGoodId !== before.ownerGoodId || after.originId !== before.originId
        || after.familyGoodIds.length !== before.familyGoodIds.length || after.familyGoodIds.some(id => !before.familyGoodIds.includes(id))
        || after.transactionRevision !== before.transactionRevision || after.deliveryVersionId !== before.deliveryVersionId) return true;
      return before.groupId === input.groupId
        ? after.assignmentRevision !== before.assignmentRevision || after.assignmentVersionId !== before.assignmentVersionId
          || transactionEpochMicros(after.updatedAt) !== transactionEpochMicros(before.updatedAt)
        : after.assignmentRevision !== before.assignmentRevision + 1 || after.assignmentVersionId === null
          || after.assignmentVersionId === before.assignmentVersionId;
    })) return unknown();
    refresh(receipt); return { data: receipt };
  } catch (error) { unstable_rethrow(error); return unknown(); }
}
async function recover(raw: ShippingChargeGroupOperationContext, seal: boolean): Promise<ShippingChargeGroupActionResult<ShippingChargeGroupOperationReceipt | null>> {
  const context = parseShippingChargeGroupOperationContext(raw); if (!context) return invalid();
  try {
    const client = await authorize(context); if (!client) return denied();
    const { data, error } = await client.rpc(seal ? 'admin_seal_shipping_charge_group_operation' : 'admin_read_shipping_charge_group_operation', { p_context: context });
    if (error) return failure(error.code, error.message);
    if (data === null && !seal) return { data: null };
    const receipt = parseShippingChargeGroupOperationReceipt(data);
    if (!receipt || !shippingChargeGroupReceiptMatches(receipt, context)) return unknown();
    refresh(receipt); return { data: receipt };
  } catch (error) { unstable_rethrow(error); return unknown(); }
}
export async function readShippingChargeGroupOperationAction(context: ShippingChargeGroupOperationContext) { return recover(context, false); }
export async function sealShippingChargeGroupOperationAction(context: ShippingChargeGroupOperationContext) { return recover(context, true); }
