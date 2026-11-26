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
  type ShippingSettingsListData, type ShippingSettingsPreview, type ShippingSettingsUsage } from './shipping-settings-templates';

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
type GoodsReader = Awaited<ReturnType<typeof createClient>>;
/** 이 템플릿이 적용돼 있는 상품(보관한 상품 제외). `beforeRevision`을 주면 그 번호보다 앞선 내용이 적용된 상품만 고른다. */
function templateGoods(client: GoodsReader, templateId: string, select: string, head: boolean, beforeRevision?: number) {
  const query = client.from('goods').select(select, { count: 'exact', head }).eq('shipping_settings_template_id', templateId).is('archived_at', null);
  return beforeRevision === undefined ? query : query.lt('shipping_settings_template_revision', beforeRevision);
}
/**
 * 목록에 보일 '적용 상품 수'. 템플릿마다 적용된 상품 수와, 템플릿을 고친 뒤 다시 적용하지 않은 상품 수를 센다(읽기 전용).
 * 한 번의 조회로 이 쪽의 템플릿이 적용된 상품을 모두 읽어 센다. 조회가 한 번에 돌려주는 줄 수를 넘으면(전체 수와 받은 줄 수가 다르면)
 * 템플릿마다 수만 세는 조회로 바꾼다. 세지 못한 템플릿은 결과에서 뺀다 — 틀린 수를 보이지 않는다.
 */
export async function loadShippingSettingsUsage(templates: readonly { id: string; revision: number }[]): Promise<Record<string, ShippingSettingsUsage>> {
  if (!templates.length) return {};
  try {
    const client = await createClient();
    const all = await client.from('goods').select('shipping_settings_template_id,shipping_settings_template_revision', { count: 'exact' })
      .in('shipping_settings_template_id', templates.map(template => template.id)).is('archived_at', null);
    const rows = all.data as unknown as { shipping_settings_template_id?: unknown; shipping_settings_template_revision?: unknown }[] | null;
    if (!all.error && Array.isArray(rows) && all.count === rows.length) {
      return Object.fromEntries(templates.map(template => {
        const applied = rows.filter(row => row.shipping_settings_template_id === template.id);
        return [template.id, { applied: applied.length, outdated: applied.filter(row => Number(row.shipping_settings_template_revision) < template.revision).length }];
      }));
    }
    const counted = await Promise.all(templates.map(async template => {
      const [applied, outdated] = await Promise.all([templateGoods(client, template.id, 'id', true), templateGoods(client, template.id, 'id', true, template.revision)]);
      if (applied.error || outdated.error || !transactionInteger(applied.count) || !transactionInteger(outdated.count)) return null;
      return [template.id, { applied: applied.count, outdated: outdated.count }] as const;
    }));
    return Object.fromEntries(counted.filter(entry => entry !== null));
  } catch { return {}; }
}
/** 템플릿을 고친 뒤 다시 적용하지 않은 상품을 한 번에 적용할 수 있는 만큼(100개) 고른다. `total`은 그런 상품 전체 수다. */
export async function loadShippingSettingsOutdatedGoods(templateId: string, revision: number, limit: number): Promise<{ ids: string[]; total: number }> {
  const client = await createClient();
  const { data, count, error } = await templateGoods(client, templateId, 'id', false, revision).order('id').limit(limit);
  const rows = data as unknown as { id?: unknown }[] | null;
  if (error || !Array.isArray(rows) || !transactionInteger(count) || rows.some(row => !goodId(row.id))) throw new Error('상품을 불러오지 못했습니다.');
  return { ids: rows.map(row => String(row.id)), total: count };
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
