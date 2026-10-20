'use server';

import { revalidatePath } from 'next/cache';
import { unstable_rethrow } from 'next/navigation';
import { requireAdminActionAccess } from '@/lib/admin/action-access.server';
import { revalidateGoodsSurfaces } from '@/lib/admin/revalidate-goods.server';
import { createClient } from '@/lib/supabase/server';
import { isUuid } from '@/lib/uuid';
import { sameGoodsTerms } from '@/lib/admin/goods-transaction-terms';
import {
  SHIPPING_SETTINGS_PATH, parseShippingSettingsApplyInput, parseShippingSettingsIdentity, parseShippingSettingsOperationContext,
  parseShippingSettingsOperationReceipt, parseShippingSettingsSaveRequest, shippingSettingsReceiptMatches, shippingSettingsChargeGroup,
  type ShippingSettingsApplyInput, type ShippingSettingsCandidates, type ShippingSettingsIdentity, type ShippingSettingsOperationContext,
  type ShippingSettingsOperationReceipt, type ShippingSettingsPreview, type ShippingSettingsSaveRequest, type ShippingSettingsTemplate,
} from '@/lib/admin/shipping-settings-templates';
import { parseShippingSettingsPreview, parseShippingSettingsTemplate, searchShippingSettingsGoods } from '@/lib/admin/shipping-settings-templates.server';

export type ShippingSettingsActionResult<T> = { data: T } | { error: string; uncertain?: boolean; conflict?: boolean; authChanged?: boolean };
const invalid = () => ({ error: '입력값과 현재 작업의 저장 기준을 확인해주세요.' });
const denied = () => ({ error: '로그인 상태나 상품관리 권한이 바뀌었습니다. 현재 계정으로 화면을 다시 열어주세요.', authChanged: true });
const unknown = () => ({ error: '처리 결과가 불확실합니다. 같은 요청의 저장 결과를 확인해주세요.', uncertain: true });
async function authorize(identity: ShippingSettingsIdentity) {
  const access = await requireAdminActionAccess(SHIPPING_SETTINGS_PATH, { capability: 'catalog.manage' });
  if (!access || access.user.id !== identity.expectedActorId) return null;
  const client = await createClient(), claims = await client.auth.getClaims();
  return !claims.error && claims.data?.claims.sub === access.user.id && claims.data.claims.session_id === identity.expectedSessionId ? client : null;
}
function failure(code: string | undefined, message: string): Exclude<ShippingSettingsActionResult<never>, { data: never }> {
  if (code === '42501' || code === '28000') return denied();
  if (!['PT409', '22023', '23514', '23503', 'P0002', '23505', '55000'].includes(code ?? '')) return unknown();
  const messages: [string, string][] = [
    ['shipping_charge_group_origin_mismatch', '묶음그룹과 적용할 출고지가 다릅니다. 같은 출고지의 그룹을 지정하거나 배정을 해제해주세요.'],
    ['shipping_charge_group_unavailable', '묶음그룹을 사용할 수 없습니다. 그룹의 사용 상태와 출고지를 확인해주세요.'],
    ['shipping_charge_group_changed', '묶음그룹이 변경되었습니다. 기존 요청의 결과를 확인한 뒤 미리보기를 다시 만들어주세요.'],
    ['shipping_settings_preview_upgrade_required', '수령 방식과 묶음배송 설정을 확인할 수 있도록 화면을 새로 열고 미리보기를 다시 만들어주세요.'],
    ['origin_unavailable', '선택한 출고지가 없거나 비활성 상태입니다. 활성 출고지를 확인해주세요.'],
    ['origin_changed', '출고지 정책이 변경되었습니다. 기존 요청을 확인한 뒤 미리보기를 다시 만들어주세요.'],
    ['template_changed', '템플릿이 변경되었습니다. 기존 요청을 확인한 뒤 최신 저장본과 비교해주세요.'],
    ['template_unavailable', '사용 가능한 템플릿이 아닙니다. 사용 상태를 확인해주세요.'],
    ['goods_changed', '선택 상품이나 배송 조건이 변경되었습니다. 기존 요청을 확인한 뒤 미리보기를 다시 만들어주세요.'],
    ['goods_unavailable', '삭제되었거나 보관된 상품이 포함되어 있습니다. 선택 상품을 다시 확인해주세요.'],
    ['owner', '합산군의 다른 상품에 적용할 수 없습니다. 미리보기에 표시된 원상품에서 확인해주세요.'],
    ['collect', '출고지의 착불 수납 조건이 준비되지 않았거나 변경되었습니다. 출고지 정책을 확인해주세요.'],
    ['request_conflict', '같은 요청번호에 다른 입력이 연결되어 있습니다. 원래 요청의 저장 결과를 확인해주세요.'],
    ['operation_conflict', '같은 요청번호에 다른 입력이 연결되어 있습니다. 원래 요청의 저장 결과를 확인해주세요.'],
    ['shipping_settings_retry', '다른 처리가 진행 중입니다. 같은 요청의 저장 결과를 먼저 확인해주세요.'],
    ['operation_sealed', '이 요청은 종료되었습니다. 최신 내용을 확인하고 새 요청을 만들어주세요.'],
    ['feature_disabled', '확장 배송비를 적용할 수 없습니다. 현재 상품 거래 설정을 확인해주세요.'],
    ['checkout_contract_upgrade_required', '현재 상품 거래 경로에서 확장 배송비를 사용할 수 없습니다. 운영 설정을 확인해주세요.'],
  ];
  return { error: messages.find(([key]) => message.includes(key))?.[1] ?? '처리하지 못했습니다. 입력값과 최신 상태를 확인해주세요.',
    uncertain: false, conflict: code === 'PT409' || code === '23505' };
}
function refresh(receipt: ShippingSettingsOperationReceipt) {
  if (receipt.state === 'sealed') return;
  // Reading the same receipt also repairs invalidation after a lost response.
  try { if (receipt.state === 'applied') revalidateGoodsSurfaces(); revalidatePath(SHIPPING_SETTINGS_PATH); } catch { /* Preserve the committed receipt. */ }
}
export async function saveShippingSettingsTemplateAction(raw: ShippingSettingsSaveRequest): Promise<ShippingSettingsActionResult<ShippingSettingsOperationReceipt>> {
  const input = parseShippingSettingsSaveRequest(raw); if (!input) return invalid();
  try {
    const client = await authorize(input); if (!client) return denied();
    const { data, error } = await client.rpc(input.settings.chargeGroup || input.settings.fulfillment ? 'admin_save_shipping_settings_template_v3' : 'admin_save_shipping_settings_template_v2', { p_request: input });
    if (error) return failure(error.code, error.message);
    const receipt = parseShippingSettingsOperationReceipt(data);
    if (!receipt || !shippingSettingsReceiptMatches(receipt, input)) return unknown();
    if (receipt.state === 'sealed') return { data: receipt };
    if (receipt.state !== 'saved' || !receipt.template
      || receipt.template.name !== input.name || receipt.template.enabled !== input.enabled || !sameGoodsTerms(receipt.template.settings, input.settings)) return unknown();
    refresh(receipt); return { data: receipt };
  } catch (error) { unstable_rethrow(error); return unknown(); }
}
export async function readShippingSettingsTemplateAction(templateId: string, identity: ShippingSettingsIdentity): Promise<ShippingSettingsActionResult<ShippingSettingsTemplate | null>> {
  if (!isUuid(templateId) || !parseShippingSettingsIdentity(identity)) return invalid();
  try {
    const client = await authorize(identity); if (!client) return denied();
    const { data, error } = await client.from('shipping_settings_templates').select('id,name,revision,enabled,settings,created_at,updated_at').eq('id', templateId).maybeSingle();
    if (error) return { error: '최신 템플릿을 읽지 못했습니다. 현재 입력은 유지됩니다.' };
    if (data === null) return { data: null };
    const template = parseShippingSettingsTemplate({ id: data.id, name: data.name, revision: data.revision, enabled: data.enabled,
      settings: data.settings, createdAt: data.created_at, updatedAt: data.updated_at });
    return template?.id === templateId ? { data: template } : { error: '최신 템플릿 응답을 확인하지 못했습니다. 현재 입력은 유지됩니다.' };
  } catch (error) { unstable_rethrow(error); return { error: '최신 템플릿을 읽지 못했습니다. 현재 입력은 유지됩니다.' }; }
}
export async function findShippingSettingsGoodsAction(query: string, page: number, identity: ShippingSettingsIdentity): Promise<ShippingSettingsActionResult<ShippingSettingsCandidates>> {
  if (typeof query !== 'string' || query.length > 100 || !Number.isSafeInteger(page) || page < 1 || page > 100000 || !parseShippingSettingsIdentity(identity)) return invalid();
  try {
    if (!await authorize(identity)) return denied();
    return { data: await searchShippingSettingsGoods(query.trim(), page, identity) };
  } catch (error) { unstable_rethrow(error); return { error: '상품을 불러오지 못했습니다. 다시 검색해주세요.' }; }
}
export async function previewShippingSettingsTemplateAction(templateId: string, goodIds: string[], identity: ShippingSettingsIdentity): Promise<ShippingSettingsActionResult<ShippingSettingsPreview>> {
  if (!isUuid(templateId) || !parseShippingSettingsIdentity(identity) || !Array.isArray(goodIds) || goodIds.length < 1 || goodIds.length > 100
    || new Set(goodIds).size !== goodIds.length || goodIds.some(id => typeof id !== 'string' || id.length < 1 || id.length > 120)) return invalid();
  try {
    const client = await authorize(identity); if (!client) return denied();
    const { data, error } = await client.rpc('admin_preview_shipping_settings_template_v3', { p_template_id: templateId, p_good_ids: goodIds,
      p_expected_actor_id: identity.expectedActorId, p_expected_session_id: identity.expectedSessionId });
    if (error) return failure(error.code, error.message);
    const preview = parseShippingSettingsPreview(data);
    if (!preview || preview.actorId !== identity.expectedActorId || preview.sessionId !== identity.expectedSessionId || preview.template.id !== templateId
      || preview.goods.length !== goodIds.length || new Set(preview.goods.map(row => row.id)).size !== goodIds.length || preview.goods.some(row => !goodIds.includes(row.id))) {
      return { error: '미리보기 응답을 확인하지 못했습니다. 다시 확인해주세요.' };
    }
    return { data: preview };
  } catch (error) { unstable_rethrow(error); return { error: '미리보기를 불러오지 못했습니다. 다시 확인해주세요.' }; }
}
export async function applyShippingSettingsTemplateAction(raw: ShippingSettingsApplyInput): Promise<ShippingSettingsActionResult<ShippingSettingsOperationReceipt>> {
  const input = parseShippingSettingsApplyInput(raw); if (!input) return invalid();
  try {
    const client = await authorize(input); if (!client) return denied();
    const { data, error } = await client.rpc(Object.hasOwn(input, 'targetGroup') ? 'admin_apply_shipping_settings_template_v3' : 'admin_apply_shipping_settings_template_v2', { p_request: input });
    if (error) return failure(error.code, error.message);
    const receipt = parseShippingSettingsOperationReceipt(data);
    if (!receipt || !shippingSettingsReceiptMatches(receipt, input)) return unknown();
    if (receipt.state === 'sealed') return { data: receipt };
    if (receipt.state !== 'applied' || receipt.appliedCount !== input.goods.length
      || receipt.goods.length !== input.goods.length || new Set(receipt.goods.map(row => row.id)).size !== input.goods.length
      || receipt.goods.some(row => !input.goods.some(good => good.id === row.id))) return unknown();
    if (Object.hasOwn(input, 'targetGroup')) {
      if (!receipt.template) return unknown();
      const directive = shippingSettingsChargeGroup(receipt.template.settings);
      if (directive.mode === 'assign' ? input.targetGroup?.id !== directive.groupId : input.targetGroup !== null) return unknown();
      if (receipt.goods.some(row => {
        const before = input.goods.find(good => good.id === row.id)!;
        const groupId = directive.mode === 'preserve' ? before.groupId : directive.mode === 'assign' ? input.targetGroup!.id : null;
        const groupRevision = directive.mode === 'preserve' ? before.groupRevision : directive.mode === 'assign' ? input.targetGroup!.revision : null;
        const changed = groupId !== before.groupId;
        return row.groupId !== groupId || row.groupRevision !== groupRevision || row.assignmentRevision !== Number(before.assignmentRevision) + Number(changed)
          || (changed ? !row.assignmentVersionId || row.assignmentVersionId === before.assignmentVersionId : row.assignmentVersionId !== before.assignmentVersionId);
      })) return unknown();
    }
    if (input.goods.some(row => row.fulfillmentRevision !== undefined)) {
      if (receipt.fulfillmentVersion !== 1 || receipt.goods.some(row => {
        const before = input.goods.find(good => good.id === row.id)!;
        return row.fulfillmentRevision !== Number(before.fulfillmentRevision) + Number(receipt.template?.settings.fulfillment?.mode === 'replace');
      })) return unknown();
    }
    refresh(receipt); return { data: receipt };
  } catch (error) { unstable_rethrow(error); return unknown(); }
}
async function recover(raw: ShippingSettingsOperationContext, seal: boolean): Promise<ShippingSettingsActionResult<ShippingSettingsOperationReceipt | null>> {
  const context = parseShippingSettingsOperationContext(raw); if (!context) return invalid();
  try {
    const client = await authorize(context); if (!client) return denied();
    const { data, error } = await client.rpc(seal ? 'admin_seal_shipping_settings_operation' : 'admin_read_shipping_settings_operation', { p_context: context });
    if (error) return failure(error.code, error.message);
    if (data === null && !seal) return { data: null };
    const receipt = parseShippingSettingsOperationReceipt(data);
    if (!receipt || !shippingSettingsReceiptMatches(receipt, context)) return unknown();
    refresh(receipt); return { data: receipt };
  } catch (error) { unstable_rethrow(error); return unknown(); }
}
export async function readShippingSettingsOperationAction(context: ShippingSettingsOperationContext) { return recover(context, false); }
export async function sealShippingSettingsOperationAction(context: ShippingSettingsOperationContext) { return recover(context, true); }
