import 'server-only';
import { shippingFulfillmentAfter } from './shipping-settings-fulfillment';
import { createClient } from '@/lib/supabase/server';
import { isUuid } from '@/lib/uuid';
import { transactionExactKeys, transactionGoodId, transactionInstant, transactionInteger, transactionRecord } from '@/lib/goods-transaction-values';
import { sameGoodsTerms } from './goods-transaction-terms';
import { parseShippingChargeGroupSummary } from './shipping-charge-groups';
import { parseShippingSettingsEffective, parseShippingSettingsGoodGuard, parseShippingSettingsIdentity, parseShippingSettingsTemplateValue,
  parseShippingSettingsValue, shippingSettingsDelivery, shippingSettingsChargeGroup, shippingSettingsGoodGuard,
  SHIPPING_SETTINGS_CHARGE_GUARD_KEYS, type ShippingSettingsGoodGuard, type ShippingSettingsCandidates, type ShippingSettingsFilters, type ShippingSettingsIdentity,
  type ShippingSettingsListData, type ShippingSettingsPreview } from './shipping-settings-templates';

export const parseShippingSettings = parseShippingSettingsValue;
export const parseShippingSettingsTemplate = parseShippingSettingsTemplateValue;
const nullableUuid = (value: unknown) => value === null || typeof value === 'string' && isUuid(value);
const blocker = (value: unknown) => value === null || ['goods_aggregation_policy_owned_by_source', 'checkout_contract_upgrade_required', 'collect_contract_not_ready',
  'shipping_charge_group_unavailable', 'shipping_charge_group_origin_mismatch'].includes(String(value));
const goodId = (value: unknown) => transactionGoodId(value) && value.length <= 120;

export async function loadShippingSettingsTemplates(filters: ShippingSettingsFilters): Promise<ShippingSettingsListData> {
  const client = await createClient(); const { data, error } = await client.rpc('admin_list_shipping_settings_templates', {
    p_query: filters.query, p_state: filters.state, p_page: filters.page,
  });
  if (error || !transactionRecord(data) || !transactionExactKeys(data, ['total', 'rows']) || !transactionInteger(data.total) || !Array.isArray(data.rows)
    || data.rows.some(row => !parseShippingSettingsTemplate(row))) throw new Error('배송정보 템플릿을 불러오지 못했습니다.');
  const lastPage = Math.max(1, Math.ceil(data.total / 20));
  if (filters.page > lastPage) return loadShippingSettingsTemplates({ ...filters, page: lastPage });
  return { rows: data.rows, total: data.total, filters };
}
export async function searchShippingSettingsGoods(query: string, page: number, identity: ShippingSettingsIdentity): Promise<ShippingSettingsCandidates> {
  if (!parseShippingSettingsIdentity(identity)) throw new Error('로그인 정보를 다시 확인해주세요.');
  const client = await createClient(); const { data, error } = await client.rpc('admin_search_goods_for_shipping_settings_v3', {
    p_query: query, p_page: page, p_expected_actor_id: identity.expectedActorId, p_expected_session_id: identity.expectedSessionId,
  });
  if (error || !transactionRecord(data) || !transactionExactKeys(data, ['rows', 'total', 'page', 'pageSize']) || !transactionInteger(data.total)
    || data.page !== page || data.pageSize !== 20 || !Array.isArray(data.rows)
    || data.rows.some(row => !transactionRecord(row) || !transactionExactKeys(row, ['id', 'name', 'code', 'updatedAt', 'settings', 'templateId', 'templateRevision', 'ownerGoodId', 'familyGoodIds', 'editable', 'blocker', 'effective'])
      || !goodId(row.id) || typeof row.name !== 'string' || typeof row.code !== 'string' || !transactionInstant(row.updatedAt)
      || !parseShippingSettings(row.settings, true) || !nullableUuid(row.templateId)
      || (row.templateRevision !== null && !transactionInteger(row.templateRevision, 1)) || (row.templateId === null) !== (row.templateRevision === null)
      || !goodId(row.ownerGoodId) || row.editable !== (row.ownerGoodId === row.id) || !blocker(row.blocker)
      || !Array.isArray(row.familyGoodIds) || row.familyGoodIds.length < 1 || row.familyGoodIds.length > 100 || row.familyGoodIds.some(id => !goodId(id))
      || new Set(row.familyGoodIds).size !== row.familyGoodIds.length || !row.familyGoodIds.includes(row.id) || !row.familyGoodIds.includes(row.ownerGoodId)
      || (row.editable ? row.blocker !== null : row.blocker !== 'goods_aggregation_policy_owned_by_source') || !parseShippingSettingsEffective(row.effective))) {
    throw new Error('상품을 불러오지 못했습니다.');
  }
  return data as unknown as ShippingSettingsCandidates;
}
export function parseShippingSettingsPreview(value: unknown): ShippingSettingsPreview | null {
  if (!transactionRecord(value) || !transactionExactKeys(value, ['template', 'actorId', 'sessionId', 'canApply', 'origin', 'goods', ...('targetGroup' in value ? ['targetGroup'] : [])])) return null;
  const template = parseShippingSettingsTemplate(value.template), origin = value.origin;
  if (!template || !template.enabled || typeof value.actorId !== 'string' || !isUuid(value.actorId) || typeof value.sessionId !== 'string' || !isUuid(value.sessionId)
    || typeof value.canApply !== 'boolean' || !transactionRecord(origin)
    || !transactionExactKeys(origin, ['id', 'name', 'updatedAt', 'baseFee', 'freeThreshold', 'returnAddress', 'defaultCarrier', 'collectRevision', 'collectVersionId', 'collectReady', 'collectorName'])
    || origin.id !== template.settings.originId || typeof origin.name !== 'string' || !transactionInstant(origin.updatedAt)
    || !transactionInteger(origin.baseFee) || (origin.freeThreshold !== null && !transactionInteger(origin.freeThreshold))
    || typeof origin.returnAddress !== 'string' || (origin.defaultCarrier !== null && typeof origin.defaultCarrier !== 'string')
    || !transactionInteger(origin.collectRevision) || !nullableUuid(origin.collectVersionId) || (origin.collectRevision === 0) !== (origin.collectVersionId === null)
    || typeof origin.collectReady !== 'boolean' || (origin.collectorName !== null && (typeof origin.collectorName !== 'string' || !origin.collectorName))
    || (origin.collectReady ? origin.collectVersionId === null || origin.collectorName === null : origin.collectorName !== null)
    || !Array.isArray(value.goods) || value.goods.length < 1 || value.goods.length > 100) return null;
  const directive = shippingSettingsDelivery(template.settings);
  const chargeDirective = shippingSettingsChargeGroup(template.settings), enhanced = 'targetGroup' in value;
  const targetGroup = value.targetGroup == null ? null : parseShippingChargeGroupSummary(value.targetGroup);
  if (enhanced ? value.targetGroup !== null && !targetGroup : template.settings.chargeGroup !== undefined) return null;
  if (enhanced && (chargeDirective.mode === 'assign'
    ? targetGroup?.id !== chargeDirective.groupId
    : targetGroup !== null)) return null;
  for (const row of value.goods) {
    if (!transactionRecord(row) || !transactionExactKeys(row, ['id', 'name', 'code', 'updatedAt', 'ownerGoodId', 'ownerUpdatedAt', 'familyGoodIds', 'transactionRevision', 'deliveryVersionId',
      'editable', 'blocker', 'before', 'after', 'effectiveBefore', 'effectiveAfter', ...(enhanced ? SHIPPING_SETTINGS_CHARGE_GUARD_KEYS : []), ...('fulfillmentRevision' in row ? ['fulfillmentRevision'] : [])]) || typeof row.name !== 'string' || typeof row.code !== 'string'
      || !parseShippingSettingsGoodGuard(shippingSettingsGoodGuard(row as unknown as ShippingSettingsGoodGuard))
      || row.editable !== (row.ownerGoodId === row.id) || !blocker(row.blocker) || !row.editable && row.blocker !== 'goods_aggregation_policy_owned_by_source'
      || !parseShippingSettings(row.before, true) || !parseShippingSettings(row.after) || !sameGoodsTerms(row.after, template.settings)) return null;
    const before = parseShippingSettingsEffective(row.effectiveBefore), after = parseShippingSettingsEffective(row.effectiveAfter);
    if (!before || !after || after.originId !== template.settings.originId || after.feeType !== template.settings.feeType || after.individualFee !== template.settings.individualFee
      || !sameGoodsTerms(after.delivery, directive.mode === 'preserve' ? before.delivery : directive.policy)) return null;
    if ('fulfillmentRevision' in row || template.settings.fulfillment?.mode === 'replace') {
      if (!before.fulfillment || !after.fulfillment || before.fulfillment.goodId !== row.id || before.fulfillment.revision !== row.fulfillmentRevision
        || !sameGoodsTerms(after.fulfillment, shippingFulfillmentAfter(before.fulfillment, template.settings.fulfillment ?? { mode: 'preserve' }))) return null;
    } else if (before.fulfillment || after.fulfillment) return null;
    if (enhanced && (!Object.hasOwn(before, 'chargeGroup') || !Object.hasOwn(after, 'chargeGroup')
      || (before.chargeGroup?.id ?? null) !== row.groupId || (before.chargeGroup?.revision ?? null) !== row.groupRevision
      || !sameGoodsTerms(after.chargeGroup, chargeDirective.mode === 'preserve' ? before.chargeGroup : chargeDirective.mode === 'assign' ? targetGroup : null))) return null;
  }
  if (new Set(value.goods.map(row => row.id)).size !== value.goods.length
    || value.canApply !== value.goods.every(row => row.editable && row.blocker === null)) return null;
  return value as unknown as ShippingSettingsPreview;
}
