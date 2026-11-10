'use server';

import { revalidatePath } from 'next/cache';
import { unstable_rethrow } from 'next/navigation';
import { requireAdminActionAccess } from '@/lib/admin/action-access.server';
import { revalidateGoodsSurfaces } from '@/lib/admin/revalidate-goods.server';
import { createClient } from '@/lib/supabase/server';
import { isUuid } from '@/lib/uuid';
import { transactionEpochMicros, transactionGoodId } from '@/lib/goods-transaction-values';
import {
  SHIPPING_CHARGE_GROUPS_PATH, parseShippingChargeGroupAssignRequest, parseShippingChargeGroupFilters, parseShippingChargeGroupGoodsFilters,
  parseShippingChargeGroupIdentity, parseShippingChargeGroupOperationContext, parseShippingChargeGroupOperationReceipt, parseShippingChargeGroupSaveRequest,
  shippingChargeGroupReceiptMatches, shippingChargeGroupValuesMatch,
  type ShippingChargeGroupAssignmentPreview, type ShippingChargeGroupAssignRequest, type ShippingChargeGroupData, type ShippingChargeGroupFilters,
  type ShippingChargeGroupGoodData, type ShippingChargeGroupGoodsData, type ShippingChargeGroupGoodsFilters, type ShippingChargeGroupIdentity,
  type ShippingChargeGroupListData, type ShippingChargeGroupOperationContext, type ShippingChargeGroupOperationReceipt, type ShippingChargeGroupSaveRequest,
} from '@/lib/admin/shipping-charge-groups';
import { loadGoodShippingChargeGroup, loadShippingChargeGroup, loadShippingChargeGroups, previewShippingChargeGroupAssignment,
  searchShippingChargeGroupGoods, ShippingChargeGroupReadError } from '@/lib/admin/shipping-charge-groups.server';

export type ShippingChargeGroupActionResult<T> = { data: T } | { error: string; uncertain?: boolean; conflict?: boolean; authChanged?: boolean };
const invalid = () => ({ error: '입력값과 현재 작업의 저장 기준을 확인해주세요.' });
const denied = () => ({ error: '로그인 상태나 상품관리 권한이 바뀌었습니다. 현재 계정으로 화면을 다시 열어주세요.', authChanged: true });
const unknown = () => ({ error: '처리 결과가 불확실합니다. 같은 요청의 저장 결과를 확인해주세요.', uncertain: true });
const readFailed = () => ({ error: '배송비 묶음그룹 정보를 확인하지 못했습니다. 다시 불러와주세요.' });
const uuid = (value: unknown): value is string => typeof value === 'string' && isUuid(value) && value === value.toLowerCase();
const goodId = (value: unknown): value is string => transactionGoodId(value) && value.length <= 120;

async function authorize(identity: ShippingChargeGroupIdentity) {
  const access = await requireAdminActionAccess(SHIPPING_CHARGE_GROUPS_PATH, { capability: 'catalog.manage' });
  if (!access || access.user.id !== identity.expectedActorId) return null;
  const client = await createClient(), claims = await client.auth.getClaims();
  return !claims.error && claims.data?.claims.sub === access.user.id && claims.data.claims.session_id === identity.expectedSessionId ? client : null;
}
function failure(code: string | undefined, message: string): Exclude<ShippingChargeGroupActionResult<never>, { data: never }> {
  if (code === '42501' || code === '28000') return denied();
  if (!['PT409', '22023', '23514', '23503', 'P0002', '23505', '55000'].includes(code ?? '')) return unknown();
  const messages: [string, string][] = [
    ['region_confirmation_required', '지역 계약의 적용 범위와 실제 근거를 확인해주세요. 지역 계약 변경 권한이 필요합니다.'],
    ['regional_attestation', '지역 계약의 적용 범위와 실제 근거를 확인해주세요. 지역 계약 변경 권한이 필요합니다.'],
    ['regional_permission', '지역 계약을 변경할 권한이 없습니다. 기존 지역 설정을 유지하거나 권한 있는 관리자에게 요청해주세요.'],
    ['group_changed', '배송비 묶음그룹이 변경되었습니다. 기존 요청 결과를 확인한 뒤 최신 내용과 비교해주세요.'],
    ['default_changed', '기본 묶음그룹이 변경되었습니다. 최신 출고지 정보를 다시 확인해주세요.'],
    ['origin_changed', '출고지 정보가 변경되었습니다. 기존 요청 결과를 확인한 뒤 다시 확인해주세요.'],
    ['origin_unavailable', '선택한 출고지가 없거나 비활성 상태입니다. 활성 출고지를 확인해주세요.'],
    ['origin_mismatch', '상품과 배송비 묶음그룹의 출고지가 다릅니다. 같은 출고지의 그룹을 선택해주세요.'],
    ['group_in_use', '연결된 상품이 있어 사용 중지하거나 보관할 수 없습니다. 상품 배정을 먼저 해제하거나 이동해주세요.'],
    ['has_assignments', '연결된 상품이 있어 사용 중지하거나 보관할 수 없습니다. 상품 배정을 먼저 해제하거나 이동해주세요.'],
    ['assigned', '연결된 상품이 있어 사용 중지하거나 보관할 수 없습니다. 상품 배정을 먼저 확인해주세요.'],
    ['group_unavailable', '사용 가능한 배송비 묶음그룹이 아닙니다. 그룹 상태를 확인해주세요.'],
    ['goods_changed', '상품이나 공유 배송 조건이 변경되었습니다. 기존 요청 결과를 확인한 뒤 미리보기를 다시 만들어주세요.'],
    ['goods_unavailable', '삭제되었거나 보관된 상품이 포함되어 있습니다. 선택 상품을 다시 확인해주세요.'],
    ['owner', '합산군의 다른 상품은 개별 변경할 수 없습니다. 표시된 원상품에서 배정을 변경해주세요.'],
    ['collect', '출고지의 착불 수납 조건을 확인해주세요. 준비된 수납 계약이 필요합니다.'],
    ['operation_conflict', '같은 요청번호에 다른 입력이 연결되어 있습니다. 원래 요청의 저장 결과를 확인해주세요.'],
    ['request_conflict', '같은 요청번호에 다른 입력이 연결되어 있습니다. 원래 요청의 저장 결과를 확인해주세요.'],
    ['operation_sealed', '이 요청은 종료되었습니다. 최신 내용을 확인하고 새 요청을 만들어주세요.'],
    ['retry', '다른 처리가 진행 중입니다. 같은 요청의 저장 결과를 먼저 확인해주세요.'],
    ['feature_disabled', '현재 상품 거래 설정에서는 이 변경을 적용할 수 없습니다. 운영 설정을 확인해주세요.'],
    ['runtime', '현재 상품 거래 설정에서는 이 변경을 적용할 수 없습니다. 운영 설정을 확인해주세요.'],
    ['checkout_contract_upgrade_required', '현재 상품 거래 경로에서는 배송비 묶음그룹을 적용할 수 없습니다.'],
  ];
  return { error: messages.find(([key]) => message.includes(key))?.[1] ?? '처리하지 못했습니다. 입력값과 최신 상태를 확인해주세요.',
    uncertain: false, conflict: code === 'PT409' || code === '23505' };
}
function readFailure(error: unknown): Exclude<ShippingChargeGroupActionResult<never>, { data: never }> {
  unstable_rethrow(error);
  if (error instanceof ShippingChargeGroupReadError) {
    const result = failure(error.code, error.reason); return result.uncertain ? readFailed() : result;
  }
  return readFailed();
}
function refresh(receipt: ShippingChargeGroupOperationReceipt) {
  if (receipt.state === 'sealed') return;
  // A lost response can be recovered even if cache invalidation failed.
  try { revalidateGoodsSurfaces(); revalidatePath(SHIPPING_CHARGE_GROUPS_PATH); revalidatePath('/admin/settings/shipping-templates'); } catch { /* Keep the committed receipt. */ }
}

export async function listShippingChargeGroupsAction(filters: ShippingChargeGroupFilters, identity: ShippingChargeGroupIdentity): Promise<ShippingChargeGroupActionResult<ShippingChargeGroupListData>> {
  if (!parseShippingChargeGroupFilters(filters) || !parseShippingChargeGroupIdentity(identity)) return invalid();
  try { if (!await authorize(identity)) return denied(); return { data: await loadShippingChargeGroups(filters, identity) }; }
  catch (error) { return readFailure(error); }
}
export async function getShippingChargeGroupAction(groupId: string, identity: ShippingChargeGroupIdentity): Promise<ShippingChargeGroupActionResult<ShippingChargeGroupData>> {
  if (!uuid(groupId) || !parseShippingChargeGroupIdentity(identity)) return invalid();
  try { if (!await authorize(identity)) return denied(); return { data: await loadShippingChargeGroup(groupId, identity) }; }
  catch (error) { return readFailure(error); }
}
export async function getGoodShippingChargeGroupAction(id: string, identity: ShippingChargeGroupIdentity): Promise<ShippingChargeGroupActionResult<ShippingChargeGroupGoodData>> {
  if (!goodId(id) || !parseShippingChargeGroupIdentity(identity)) return invalid();
  try { if (!await authorize(identity)) return denied(); return { data: await loadGoodShippingChargeGroup(id, identity) }; }
  catch (error) { return readFailure(error); }
}
export async function findShippingChargeGroupGoodsAction(filters: ShippingChargeGroupGoodsFilters, identity: ShippingChargeGroupIdentity): Promise<ShippingChargeGroupActionResult<ShippingChargeGroupGoodsData>> {
  if (!parseShippingChargeGroupGoodsFilters(filters) || !parseShippingChargeGroupIdentity(identity)) return invalid();
  try { if (!await authorize(identity)) return denied(); return { data: await searchShippingChargeGroupGoods(filters, identity) }; }
  catch (error) { return readFailure(error); }
}
export async function previewShippingChargeGroupAssignmentAction(groupId: string | null, goodIds: string[], identity: ShippingChargeGroupIdentity): Promise<ShippingChargeGroupActionResult<ShippingChargeGroupAssignmentPreview>> {
  if (!(groupId === null || uuid(groupId)) || !parseShippingChargeGroupIdentity(identity) || !Array.isArray(goodIds) || !goodIds.length
    || goodIds.length > 100 || goodIds.some(id => !goodId(id)) || new Set(goodIds).size !== goodIds.length) return invalid();
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
