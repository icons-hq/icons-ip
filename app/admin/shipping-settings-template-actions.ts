'use server';

import { revalidatePath } from 'next/cache';
import { unstable_rethrow } from 'next/navigation';
import { requireAdminActionAccess } from '@/lib/admin/action-access.server';
import { revalidateGoodsSurfaces } from '@/lib/admin/revalidate-goods.server';
import { createClient } from '@/lib/supabase/server';
import { isUuid } from '@/lib/uuid';
import { sameGoodsTerms } from '@/lib/admin/goods-transaction-terms';
import { CHANGED_BY_OTHER, SAVE_UNKNOWN_MESSAGE, TEMPLATE_LATEST_UNREAD_MESSAGE } from '@/lib/admin/goods-template-save';
import {
  SHIPPING_SETTINGS_GOOD_LIMIT, SHIPPING_SETTINGS_PATH, SHIPPING_SETTINGS_RUNTIME_REJECTED, parseShippingSettingsApplyInput, parseShippingSettingsIdentity, parseShippingSettingsOperationContext,
  parseShippingSettingsOperationReceipt, parseShippingSettingsSaveRequest, shippingSettingsReceiptMatches, shippingSettingsChargeGroup,
  type ShippingSettingsApplyInput, type ShippingSettingsIdentity, type ShippingSettingsOperationContext,
  type ShippingSettingsOperationReceipt, type ShippingSettingsPreview, type ShippingSettingsSaveRequest, type ShippingSettingsTemplate,
} from '@/lib/admin/shipping-settings-templates';
import { loadShippingSettingsOutdatedGoods, parseShippingSettingsPreview, parseShippingSettingsTemplate } from '@/lib/admin/shipping-settings-templates.server';

/**
 * `uncertain`: 저장·적용됐는지 모른다(화면이 [저장됐는지 확인]을 보인다). `changed`: 다른 사람이 템플릿을 먼저 바꿨다(화면이 두 길을 보인다).
 * 둘 다 아니면 저장·적용되지 않은 것이 확실하다.
 */
export type ShippingSettingsActionResult<T> = { data: T } | { error: string; uncertain?: boolean; conflict?: boolean; changed?: boolean; authChanged?: boolean };
const invalid = () => ({ error: '화면의 내용이 지금 저장된 내용과 맞지 않아 처리하지 않았습니다. 화면을 새로고침한 뒤 다시 해 주세요.' });
const denied = () => ({ error: '로그인이 끊겼거나 상품 관리 권한이 바뀌었습니다. 지금 로그인한 계정으로 화면을 새로고침해 주세요.', authChanged: true });
const unknown = () => ({ error: SAVE_UNKNOWN_MESSAGE, uncertain: true });
async function authorize(identity: ShippingSettingsIdentity) {
  const access = await requireAdminActionAccess(SHIPPING_SETTINGS_PATH, { capability: 'catalog.manage' });
  if (!access || access.user.id !== identity.expectedActorId) return null;
  const client = await createClient(), claims = await client.auth.getClaims();
  return !claims.error && claims.data?.claims.sub === access.user.id && claims.data.claims.session_id === identity.expectedSessionId ? client : null;
}
/** DB가 거절한 이유를 운영자가 고칠 수 있는 말로 바꾼다. `saving`은 템플릿 저장(편집 창)에서 부른 경우다 — 다른 사람이 먼저 바꾼 것을 두 길로 풀게 알린다. */
function failure(code: string | undefined, message: string, saving = false): Exclude<ShippingSettingsActionResult<never>, { data: never }> {
  if (code === '42501' || code === '28000') return denied();
  if (!['PT409', '22023', '23514', '23503', 'P0002', '23505', '55000'].includes(code ?? '')) return unknown();
  const preview = '미리보기를 다시 만들어 주세요.';
  const messages: [string, string][] = [
    ['shipping_charge_group_origin_mismatch', '묶음그룹의 출고지가 템플릿의 출고지와 다릅니다. 같은 출고지의 묶음그룹을 고르거나, 묶음그룹에서 빼도록 템플릿을 고쳐 주세요.'],
    ['shipping_charge_group_unavailable', '고른 묶음그룹을 쓸 수 없습니다. 배송정보 관리에서 묶음그룹이 사용 상태인지, 출고지가 템플릿과 같은지 확인해 주세요.'],
    ['shipping_charge_group_changed', `묶음그룹이 그사이 바뀌었습니다. ${preview}`],
    ['shipping_settings_preview_upgrade_required', `화면이 오래됐습니다. 새로고침한 뒤 ${preview}`],
    ['origin_unavailable', '고른 출고지가 없거나 사용 안 함 상태입니다. 배송정보 관리에서 출고지를 사용으로 바꾸거나 다른 출고지를 골라 주세요.'],
    ['origin_changed', `출고지 설정이 그사이 바뀌었습니다. ${preview}`],
    ['template_changed', saving ? `${CHANGED_BY_OTHER} 적은 내용은 그대로 있습니다.` : `템플릿이 그사이 바뀌었습니다. ${preview}`],
    ['template_unavailable', '사용 안 함 상태인 템플릿은 상품에 적용할 수 없습니다. 템플릿을 사용으로 바꾼 뒤 다시 적용해 주세요.'],
    ['goods_changed', `고른 상품이나 그 상품의 배송 설정이 그사이 바뀌었습니다. ${preview}`],
    ['goods_unavailable', '삭제했거나 보관한 상품이 들어 있습니다. 상품을 다시 골라 주세요.'],
    ['goods_aggregation_policy_owned_by_source', `원상품에서 나눈 상품은 원상품에서 바꿔야 합니다. ${preview}`],
    ['collect', '출고지가 착불을 받을 준비가 돼 있지 않거나 그사이 바뀌었습니다. 배송정보 관리에서 출고지의 착불 조건을 확인해 주세요.'],
    ['request_conflict', '앞서 누른 저장과 내용이 달라 이어서 처리하지 못했습니다. 화면을 새로고침한 뒤 다시 해 주세요.'],
    ['operation_conflict', '앞서 누른 저장과 내용이 달라 이어서 처리하지 못했습니다. 화면을 새로고침한 뒤 다시 해 주세요.'],
    ['shipping_settings_retry', '다른 사람이 같은 템플릿이나 상품을 저장하는 중입니다. 잠시 뒤 다시 눌러 주세요.'],
    ['transaction_runtime_disabled', SHIPPING_SETTINGS_RUNTIME_REJECTED],
    ['feature_disabled', SHIPPING_SETTINGS_RUNTIME_REJECTED],
    ['checkout_contract_upgrade_required', SHIPPING_SETTINGS_RUNTIME_REJECTED],
  ];
  return { error: messages.find(([key]) => message.includes(key))?.[1] ?? '처리하지 못했습니다. 화면을 새로고침한 뒤 다시 해 주세요.',
    changed: saving && message.includes('shipping_settings_template_changed'),
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
    if (error) return failure(error.code, error.message, true);
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
    if (error) return { error: TEMPLATE_LATEST_UNREAD_MESSAGE };
    if (data === null) return { data: null };
    const template = parseShippingSettingsTemplate({ id: data.id, name: data.name, revision: data.revision, enabled: data.enabled,
      settings: data.settings, createdAt: data.created_at, updatedAt: data.updated_at });
    return template?.id === templateId ? { data: template } : { error: TEMPLATE_LATEST_UNREAD_MESSAGE };
  } catch (error) { unstable_rethrow(error); return { error: TEMPLATE_LATEST_UNREAD_MESSAGE }; }
}
/**
 * 템플릿을 고친 뒤 다시 적용하지 않은 상품(읽기 전용). 한 번에 적용할 수 있는 100개까지의 상품과 그런 상품의 전체 수를 돌려준다.
 * 목록의 [다시 적용]이 이 상품들로 바로 미리보기를 만든다.
 */
export async function findShippingSettingsOutdatedGoodsAction(templateId: string, identity: ShippingSettingsIdentity): Promise<ShippingSettingsActionResult<{ ids: string[]; total: number }>> {
  if (!isUuid(templateId) || !parseShippingSettingsIdentity(identity)) return invalid();
  const failed = { error: '다시 적용할 상품을 불러오지 못했습니다. 잠시 뒤 다시 눌러 주세요.' };
  try {
    const client = await authorize(identity); if (!client) return denied();
    const { data, error } = await client.from('shipping_settings_templates').select('revision').eq('id', templateId).maybeSingle();
    if (error || !data || !Number.isSafeInteger(data.revision)) return failed;
    return { data: await loadShippingSettingsOutdatedGoods(templateId, data.revision, SHIPPING_SETTINGS_GOOD_LIMIT) };
  } catch (error) { unstable_rethrow(error); return failed; }
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
      return { error: '미리보기를 읽지 못했습니다. 미리보기를 다시 만들어 주세요.' };
    }
    return { data: preview };
  } catch (error) { unstable_rethrow(error); return { error: '미리보기를 불러오지 못했습니다. 잠시 뒤 다시 눌러 주세요.' }; }
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
