import { parseGoodsFulfillment, type GoodsFulfillment } from '@/lib/goods-fulfillment';
import { parseShippingSettingsFulfillment, type ShippingSettingsFulfillment } from './shipping-settings-fulfillment';
import { isUuid } from '@/lib/uuid';
import type { GoodClaimPolicy } from '@/lib/goods-claim-policy';
import { readGoodsClaimPolicy } from './goods-claim-policy';
import { parseGoodsDeliveryTermsInput, type DeliveryTermsInput } from './goods-transaction-terms';
import { GOODS_TRANSACTION_INT_MAX, transactionEpochMicros, transactionExactKeys, transactionGoodId, transactionInstant, transactionInteger } from '@/lib/goods-transaction-values';
import { parseShippingChargeGroupSummary, type ShippingChargeGroupSummary } from './shipping-charge-groups';

export const SHIPPING_SETTINGS_PATH = '/admin/settings/shipping-templates';
export const SHIPPING_SETTINGS_GOOD_LIMIT = 100;
export type ShippingSettingsState = 'all' | 'enabled' | 'disabled';
export type ShippingSettingsDelivery = { mode: 'preserve' } | { mode: 'replace'; policy: DeliveryTermsInput };
export type ShippingSettingsChargeGroup = { mode: 'preserve' | 'clear' } | { mode: 'assign'; groupId: string };
export interface ShippingSettings {
  originId: string | null; feeType: 'policy' | 'free' | 'individual'; individualFee: number; claimPolicy: GoodClaimPolicy;
  /** Absent on legacy records: preserve the independently versioned policy. */
  delivery?: ShippingSettingsDelivery;
  chargeGroup?: ShippingSettingsChargeGroup;
  fulfillment?: ShippingSettingsFulfillment;
}
export interface ShippingSettingsTemplate {
  id: string; name: string; revision: number; enabled: boolean; settings: ShippingSettings; createdAt: string; updatedAt: string;
}
export interface ShippingSettingsFilters { query: string; state: ShippingSettingsState; page: number }
export interface ShippingSettingsListData { rows: ShippingSettingsTemplate[]; total: number; filters: ShippingSettingsFilters }
export interface ShippingSettingsGood {
  id: string; name: string; code: string; updatedAt: string; settings: ShippingSettings; templateId: string | null; templateRevision: number | null;
  ownerGoodId: string; familyGoodIds: string[]; editable: boolean; blocker: ShippingSettingsBlocker | null; effective: ShippingSettingsEffective;
}
export interface ShippingSettingsCandidates { rows: ShippingSettingsGood[]; page: number; pageSize: 20; total: number }
export interface ShippingSettingsIdentity { expectedActorId: string; expectedSessionId: string }
export interface ShippingSettingsEffective {
  originId: string | null; feeType: ShippingSettings['feeType']; individualFee: number; delivery: DeliveryTermsInput | null;
  chargeGroup?: ShippingChargeGroupSummary | null;
  fulfillment?: GoodsFulfillment;
}
export interface ShippingSettingsChargeGuard {
  assignmentRevision: number; assignmentVersionId: string | null; groupId: string | null; groupRevision: number | null;
}
export interface ShippingSettingsGoodGuard {
  id: string; updatedAt: string; ownerGoodId: string; ownerUpdatedAt: string; familyGoodIds: string[]; transactionRevision: number; deliveryVersionId: string | null;
  fulfillmentRevision?: number;
  assignmentRevision?: number; assignmentVersionId?: string | null; groupId?: string | null; groupRevision?: number | null;
}
export type ShippingSettingsBlocker = 'goods_aggregation_policy_owned_by_source' | 'checkout_contract_upgrade_required' | 'collect_contract_not_ready'
  | 'shipping_charge_group_unavailable' | 'shipping_charge_group_origin_mismatch';
export interface ShippingSettingsPreview {
  template: ShippingSettingsTemplate; actorId: string; sessionId: string; canApply: boolean;
  targetGroup?: ShippingChargeGroupSummary | null;
  origin: { id: string; name: string; updatedAt: string; baseFee: number; freeThreshold: number | null; returnAddress: string; defaultCarrier: string | null;
    collectRevision: number; collectVersionId: string | null; collectReady: boolean; collectorName: string | null };
  goods: (ShippingSettingsGoodGuard & { name: string; code: string; editable: boolean; blocker: ShippingSettingsBlocker | null;
    before: ShippingSettings; after: ShippingSettings; effectiveBefore: ShippingSettingsEffective; effectiveAfter: ShippingSettingsEffective })[];
}
export interface ShippingSettingsOperationContext extends ShippingSettingsIdentity {
  operationId: string; command: 'save' | 'apply'; templateId: string; expectedRevision: number;
}
export interface ShippingSettingsSaveRequest extends ShippingSettingsOperationContext {
  command: 'save'; name: string; enabled: boolean; settings: ShippingSettings;
}
export interface ShippingSettingsApplyInput extends ShippingSettingsOperationContext {
  command: 'apply'; originUpdatedAt: string; collectRevision: number; collectVersionId: string | null; goods: ShippingSettingsGoodGuard[];
  targetGroup?: { id: string; revision: number } | null;
}
export interface ShippingSettingsOperationReceipt {
  state: 'saved' | 'applied' | 'sealed'; operationId: string; command: 'save' | 'apply'; templateId: string; expectedRevision: number;
  actorId: string; sessionId: string; template: ShippingSettingsTemplate | null; appliedCount: number;
  /** Present only on v3 applied receipts, including applications of old templates. */
  chargeGroupVersion?: 1;
  fulfillmentVersion?: 1;
  goods: ({ id: string; updatedAt: string; fulfillmentRevision?: number; transactionRevision: number; deliveryVersionId: string | null } & Partial<ShippingSettingsChargeGuard>)[];
}
export type ShippingSettingsApplyResult = ShippingSettingsOperationReceipt;
const text = (form: FormData, key: string) => { const value = form.get(key); return typeof value === 'string' ? value.trim() : ''; };
export function normalizeShippingSettingsFilters(params: Record<string, string | string[] | undefined>): ShippingSettingsFilters {
  return { query: typeof params.q === 'string' ? params.q.trim().slice(0, 80) : '',
    state: params.state === 'enabled' || params.state === 'disabled' ? params.state : 'all',
    page: Math.min(100000, Math.max(1, Number.parseInt(typeof params.page === 'string' ? params.page : '', 10) || 1)) };
}
export function shippingSettingsHref(filters: ShippingSettingsFilters, page = filters.page): string {
  const params = new URLSearchParams(); if (filters.query) params.set('q', filters.query); if (filters.state !== 'all') params.set('state', filters.state);
  if (page > 1) params.set('page', String(page)); return `${SHIPPING_SETTINGS_PATH}${params.size ? `?${params}` : ''}`;
}
export function parseShippingSettingsTemplateForm(form: FormData) {
  const errors: Record<string, string> = {}; const id = text(form, 'id'); const revision = Number(text(form, 'revision'));
  const name = text(form, 'name'); const originId = text(form, 'originId'); const feeType = text(form, 'feeType');
  const rawFee = text(form, 'individualFee'); const individualFee = Number(rawFee); const enabled = text(form, 'enabled');
  if (!isUuid(id) || !Number.isSafeInteger(revision) || revision < 0) errors.form = '템플릿을 다시 열어주세요.';
  if (!name || name.length > 80 || /[\u0000-\u001f\u007f]/.test(name)) errors.name = '템플릿 이름을 80자 이내로 입력해주세요.';
  if (!isUuid(originId)) errors.originId = '출고지를 선택해주세요.';
  if (!['policy', 'free', 'individual'].includes(feeType)) errors.feeType = '배송비 유형을 선택해주세요.';
  if (!/^\d+$/.test(rawFee) || !Number.isSafeInteger(individualFee) || individualFee > 1_000_000) errors.individualFee = '개별 배송비는 0~1,000,000원 정수로 입력해주세요.';
  if (!['true', 'false'].includes(enabled)) errors.enabled = '사용 여부를 선택해주세요.';
  const claim = readGoodsClaimPolicy(form); Object.assign(errors, claim.errors);
  let delivery: ShippingSettingsDelivery | null = { mode: 'preserve' };
  if (form.has('delivery')) {
    try { delivery = parseShippingSettingsDelivery(JSON.parse(String(form.get('delivery')))); } catch { delivery = null; }
    if (!delivery) errors.delivery = '확장 배송비의 유지 또는 적용 설정을 확인해주세요.';
  }
  let chargeGroup: ShippingSettingsChargeGroup | undefined;
  if (form.has('chargeGroup')) {
    try { chargeGroup = parseShippingSettingsChargeGroup(JSON.parse(String(form.get('chargeGroup')))) ?? undefined; } catch { chargeGroup = undefined; }
    if (!chargeGroup) errors.chargeGroup = '묶음그룹의 유지·해제 또는 지정 값을 확인해주세요.';
  }
  let fulfillment: ShippingSettingsFulfillment | undefined;
  if (form.has('fulfillment')) {
    try { fulfillment = parseShippingSettingsFulfillment(JSON.parse(String(form.get('fulfillment')))) ?? undefined; } catch { fulfillment = undefined; }
    if (!fulfillment) errors.fulfillment = '수령 방식·금액·적용 근거와 확인 여부를 점검해주세요.';
  }
  if (!claim.value) errors.form = '반품·교환 조건을 확인해주세요.';
  if (Object.keys(errors).length || !claim.value || !delivery) return { ok: false as const, errors };
  return { ok: true as const, id: id.toLowerCase(), revision, name, enabled: enabled === 'true', settings: {
    originId: originId.toLowerCase(), feeType: feeType as ShippingSettings['feeType'], individualFee, claimPolicy: claim.value, delivery,
    ...(chargeGroup ? { chargeGroup } : {}), ...(fulfillment ? { fulfillment } : {}),
  } };
}
export function shippingSettingsFeeLabel(settings: Pick<ShippingSettings, 'feeType' | 'individualFee'>): string {
  return settings.feeType === 'policy' ? '출고지 정책 따름' : settings.feeType === 'free' ? '무료배송' : `개별 ${settings.individualFee.toLocaleString('ko-KR')}원`;
}
export const shippingSettingsMoney = (amount: number | null) => amount === null ? '미확인' : `${amount.toLocaleString('ko-KR')}원`;

function record(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return (prototype === Object.prototype || prototype === null) && Reflect.ownKeys(value).every(key => {
    const property = Object.getOwnPropertyDescriptor(value, key);
    return typeof key === 'string' && property?.enumerable === true && 'value' in property;
  });
}
const uuid = (value: unknown): value is string => typeof value === 'string' && isUuid(value) && value === value.toLowerCase();
const nullableUuid = (value: unknown): value is string | null => value === null || uuid(value);
const revision = (value: unknown, min = 0) => transactionInteger(value, min, GOODS_TRANSACTION_INT_MAX);
const goodId = (value: unknown): value is string => transactionGoodId(value) && value.length <= 120;
const sameTime = (a: string, b: string) => transactionEpochMicros(a) === transactionEpochMicros(b);
const sqlTrim = (value: string) => value.replace(/^[ \t\n\r]+|[ \t\n\r]+$/g, '');
const CONTEXT_KEYS = ['operationId', 'command', 'templateId', 'expectedRevision', 'expectedActorId', 'expectedSessionId'] as const;

export function parseShippingSettingsDelivery(value: unknown): ShippingSettingsDelivery | null {
  if (!record(value)) return null;
  if (value.mode === 'preserve' && transactionExactKeys(value, ['mode'])) return { mode: 'preserve' };
  if (value.mode !== 'replace' || !transactionExactKeys(value, ['mode', 'policy'])) return null;
  const policy = parseGoodsDeliveryTermsInput(value.policy);
  return policy ? { mode: 'replace', policy } : null;
}
export const shippingSettingsDelivery = (settings: ShippingSettings): ShippingSettingsDelivery => settings.delivery ?? { mode: 'preserve' };
export const shippingSettingsChargeGroup = (settings: ShippingSettings): ShippingSettingsChargeGroup => settings.chargeGroup ?? { mode: 'preserve' };
export function parseShippingSettingsChargeGroup(value: unknown): ShippingSettingsChargeGroup | null {
  if (!record(value)) return null;
  if (['preserve', 'clear'].includes(String(value.mode)) && transactionExactKeys(value, ['mode'])) return value as unknown as ShippingSettingsChargeGroup;
  return value.mode === 'assign' && transactionExactKeys(value, ['mode', 'groupId']) && uuid(value.groupId)
    ? { mode: 'assign', groupId: value.groupId } : null;
}
export const SHIPPING_SETTINGS_CHARGE_GUARD_KEYS = ['assignmentRevision', 'assignmentVersionId', 'groupId', 'groupRevision'] as const;
export function parseShippingSettingsChargeGuard(value: unknown): ShippingSettingsChargeGuard | null {
  if (!record(value) || !transactionExactKeys(value, SHIPPING_SETTINGS_CHARGE_GUARD_KEYS)
    || !revision(value.assignmentRevision) || !nullableUuid(value.assignmentVersionId)
    || (value.assignmentRevision === 0) !== (value.assignmentVersionId === null) || !nullableUuid(value.groupId)
    || !(value.groupRevision === null || revision(value.groupRevision, 1)) || (value.groupId === null) !== (value.groupRevision === null)
    || value.groupId !== null && value.assignmentRevision === 0) return null;
  return value as unknown as ShippingSettingsChargeGuard;
}
export function shippingSettingsGoodGuard(value: ShippingSettingsGoodGuard): ShippingSettingsGoodGuard {
  return Object.fromEntries(['id', 'updatedAt', 'ownerGoodId', 'ownerUpdatedAt', 'familyGoodIds', 'transactionRevision', 'deliveryVersionId',
    ...('assignmentRevision' in value ? SHIPPING_SETTINGS_CHARGE_GUARD_KEYS : []), ...('fulfillmentRevision' in value ? ['fulfillmentRevision'] : [])].map(key => [key, value[key as keyof ShippingSettingsGoodGuard]])) as unknown as ShippingSettingsGoodGuard;
}

export function parseShippingSettingsValue(value: unknown, allowMissingOrigin = false): ShippingSettings | null {
  if (!record(value) || !transactionExactKeys(value, ['originId', 'feeType', 'individualFee', 'claimPolicy', ...('delivery' in value ? ['delivery'] : []), ...('chargeGroup' in value ? ['chargeGroup'] : []), ...('fulfillment' in value ? ['fulfillment'] : [])])
    || !(uuid(value.originId) || allowMissingOrigin && value.originId === null) || !['policy', 'free', 'individual'].includes(String(value.feeType))
    || !transactionInteger(value.individualFee, 0, 1_000_000) || !record(value.claimPolicy)) return null;
  const claim = value.claimPolicy;
  if (!transactionExactKeys(claim, ['returnAllowed', 'exchangeAllowed', 'restrictionReason', 'returnFee', 'returnFreeShippingFee', 'exchangeFee'])
    || ['returnAllowed', 'exchangeAllowed'].some(key => claim[key] !== null && typeof claim[key] !== 'boolean')
    || claim.restrictionReason !== null && (typeof claim.restrictionReason !== 'string' || claim.restrictionReason.length > 2000
      || claim.restrictionReason !== sqlTrim(claim.restrictionReason) || !claim.restrictionReason || /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(claim.restrictionReason))
    || (claim.returnAllowed === false || claim.exchangeAllowed === false) && !claim.restrictionReason
    || ['returnFee', 'returnFreeShippingFee', 'exchangeFee'].some(key => claim[key] !== null && !transactionInteger(claim[key], 0, 1_000_000))
    || 'delivery' in value && !parseShippingSettingsDelivery(value.delivery)
    || 'fulfillment' in value && !parseShippingSettingsFulfillment(value.fulfillment)
    || 'chargeGroup' in value && !parseShippingSettingsChargeGroup(value.chargeGroup)) return null;
  return value as unknown as ShippingSettings;
}
export function parseShippingSettingsTemplateValue(value: unknown): ShippingSettingsTemplate | null {
  if (!record(value) || !transactionExactKeys(value, ['id', 'name', 'revision', 'enabled', 'settings', 'createdAt', 'updatedAt'])
    || !uuid(value.id) || typeof value.name !== 'string' || !sqlTrim(value.name) || value.name.length > 80
    || value.name !== sqlTrim(value.name) || /[\u0000-\u001f\u007f]/.test(value.name) || !revision(value.revision, 1)
    || typeof value.enabled !== 'boolean' || !transactionInstant(value.createdAt) || !transactionInstant(value.updatedAt)
    || !parseShippingSettingsValue(value.settings)) return null;
  return value as unknown as ShippingSettingsTemplate;
}
export function parseShippingSettingsEffective(value: unknown): ShippingSettingsEffective | null {
  if (!record(value) || !transactionExactKeys(value, ['originId', 'feeType', 'individualFee', 'delivery', ...('chargeGroup' in value ? ['chargeGroup'] : []), ...('fulfillment' in value ? ['fulfillment'] : [])]) || !nullableUuid(value.originId)
    || !['policy', 'free', 'individual'].includes(String(value.feeType)) || !transactionInteger(value.individualFee, 0, 1_000_000)
    || value.delivery !== null && !parseGoodsDeliveryTermsInput(value.delivery)
    || 'fulfillment' in value && !parseGoodsFulfillment(value.fulfillment)
    || 'chargeGroup' in value && value.chargeGroup !== null && !parseShippingChargeGroupSummary(value.chargeGroup)) return null;
  return value as unknown as ShippingSettingsEffective;
}
export function parseShippingSettingsIdentity(value: unknown): ShippingSettingsIdentity | null {
  return record(value) && transactionExactKeys(value, ['expectedActorId', 'expectedSessionId']) && uuid(value.expectedActorId) && uuid(value.expectedSessionId)
    ? value as unknown as ShippingSettingsIdentity : null;
}
function contextFields(value: Record<string, unknown>): boolean {
  return uuid(value.operationId) && uuid(value.templateId) && uuid(value.expectedActorId) && uuid(value.expectedSessionId)
    && ['save', 'apply'].includes(String(value.command)) && revision(value.expectedRevision, value.command === 'apply' ? 1 : 0)
    && (value.command !== 'save' || Number(value.expectedRevision) < GOODS_TRANSACTION_INT_MAX);
}
export function parseShippingSettingsOperationContext(value: unknown): ShippingSettingsOperationContext | null {
  return record(value) && transactionExactKeys(value, CONTEXT_KEYS) && contextFields(value) ? value as unknown as ShippingSettingsOperationContext : null;
}
export function shippingSettingsOperationContext(value: ShippingSettingsOperationContext): ShippingSettingsOperationContext {
  return Object.fromEntries(CONTEXT_KEYS.map(key => [key, value[key]])) as unknown as ShippingSettingsOperationContext;
}
export function parseShippingSettingsSaveRequest(value: unknown): ShippingSettingsSaveRequest | null {
  if (!record(value) || !transactionExactKeys(value, [...CONTEXT_KEYS, 'name', 'enabled', 'settings']) || !contextFields(value)
    || value.command !== 'save' || typeof value.name !== 'string' || !sqlTrim(value.name) || value.name !== sqlTrim(value.name)
    || value.name.length > 80 || /[\u0000-\u001f\u007f]/.test(value.name) || typeof value.enabled !== 'boolean' || !parseShippingSettingsValue(value.settings)) return null;
  const request = value as unknown as ShippingSettingsSaveRequest;
  return { ...request, settings: { ...request.settings, delivery: shippingSettingsDelivery(request.settings),
    ...(request.settings.fulfillment && !request.settings.chargeGroup ? { chargeGroup: { mode: 'preserve' as const } } : {}) } };
}
export function parseShippingSettingsGoodGuard(value: unknown): ShippingSettingsGoodGuard | null {
  if (!record(value) || !transactionExactKeys(value, ['id', 'updatedAt', 'ownerGoodId', 'ownerUpdatedAt', 'familyGoodIds', 'transactionRevision', 'deliveryVersionId', ...('assignmentRevision' in value ? SHIPPING_SETTINGS_CHARGE_GUARD_KEYS : []), ...('fulfillmentRevision' in value ? ['fulfillmentRevision'] : [])])
    || !goodId(value.id) || !goodId(value.ownerGoodId) || !transactionInstant(value.updatedAt) || !transactionInstant(value.ownerUpdatedAt)
    || !revision(value.transactionRevision) || !nullableUuid(value.deliveryVersionId) || 'fulfillmentRevision' in value && !revision(value.fulfillmentRevision)
    || value.deliveryVersionId !== null && value.transactionRevision === 0
    || !Array.isArray(value.familyGoodIds) || value.familyGoodIds.length < 1 || value.familyGoodIds.length > 100
    || value.familyGoodIds.some(id => !goodId(id)) || new Set(value.familyGoodIds).size !== value.familyGoodIds.length
    || !value.familyGoodIds.includes(value.ownerGoodId) || !value.familyGoodIds.includes(value.id)
    || value.ownerGoodId === value.id && !sameTime(value.updatedAt, value.ownerUpdatedAt)
    || 'assignmentRevision' in value && !parseShippingSettingsChargeGuard(Object.fromEntries(SHIPPING_SETTINGS_CHARGE_GUARD_KEYS.map(key => [key, value[key]])))) return null;
  return value as unknown as ShippingSettingsGoodGuard;
}
export function parseShippingSettingsApplyInput(value: unknown): ShippingSettingsApplyInput | null {
  if (!record(value) || !transactionExactKeys(value, [...CONTEXT_KEYS, 'originUpdatedAt', 'collectRevision', 'collectVersionId', 'goods', ...('targetGroup' in value ? ['targetGroup'] : [])])
    || !contextFields(value) || value.command !== 'apply' || !transactionInstant(value.originUpdatedAt) || !revision(value.collectRevision)
    || !nullableUuid(value.collectVersionId) || (value.collectRevision === 0) !== (value.collectVersionId === null)
    || !Array.isArray(value.goods) || value.goods.length < 1 || value.goods.length > SHIPPING_SETTINGS_GOOD_LIMIT
    || value.goods.some((row, _index, goods) => !parseShippingSettingsGoodGuard(row) || ('targetGroup' in value) !== ('assignmentRevision' in row)
      || ('fulfillmentRevision' in goods[0]) !== ('fulfillmentRevision' in row) || 'fulfillmentRevision' in row && !('targetGroup' in value))
    || 'targetGroup' in value && value.targetGroup !== null && (!record(value.targetGroup) || !transactionExactKeys(value.targetGroup, ['id', 'revision'])
      || !uuid(value.targetGroup.id) || !revision(value.targetGroup.revision, 1))
    || new Set(value.goods.map(row => row.id)).size !== value.goods.length) return null;
  return value as unknown as ShippingSettingsApplyInput;
}
export function parseShippingSettingsOperationReceipt(value: unknown): ShippingSettingsOperationReceipt | null {
  if (!record(value)) return null;
  const enhanced = Object.hasOwn(value, 'chargeGroupVersion'), fulfillment = Object.hasOwn(value, 'fulfillmentVersion');
  if (!transactionExactKeys(value, ['state', 'operationId', 'command', 'templateId', 'expectedRevision', 'actorId', 'sessionId', 'template', 'appliedCount', 'goods', ...(enhanced ? ['chargeGroupVersion'] : []), ...(fulfillment ? ['fulfillmentVersion'] : [])])
    || !contextFields({ ...value, expectedActorId: value.actorId, expectedSessionId: value.sessionId })
    || enhanced && (value.chargeGroupVersion !== 1 || value.state !== 'applied')
    || fulfillment && (value.fulfillmentVersion !== 1 || value.state !== 'applied' || !enhanced)
    || !['saved', 'applied', 'sealed'].includes(String(value.state)) || !transactionInteger(value.appliedCount, 0, SHIPPING_SETTINGS_GOOD_LIMIT)
    || !Array.isArray(value.goods) || value.goods.length !== value.appliedCount
    || value.goods.some(row => !record(row) || !transactionExactKeys(row, ['id', 'updatedAt', 'transactionRevision', 'deliveryVersionId', ...(enhanced ? SHIPPING_SETTINGS_CHARGE_GUARD_KEYS : []), ...(fulfillment ? ['fulfillmentRevision'] : [])])
      || fulfillment && !revision(row.fulfillmentRevision)
      || !goodId(row.id) || !transactionInstant(row.updatedAt) || !revision(row.transactionRevision) || !nullableUuid(row.deliveryVersionId)
      || row.deliveryVersionId !== null && row.transactionRevision === 0
      || enhanced && !parseShippingSettingsChargeGuard(Object.fromEntries(SHIPPING_SETTINGS_CHARGE_GUARD_KEYS.map(key => [key, row[key]]))))
    || new Set(value.goods.map(row => row.id)).size !== value.goods.length) return null;
  if (value.state === 'sealed') return value.template === null && value.appliedCount === 0 ? value as unknown as ShippingSettingsOperationReceipt : null;
  const template = parseShippingSettingsTemplateValue(value.template);
  if (!template || template.id !== value.templateId || template.revision !== Number(value.expectedRevision) + Number(value.state === 'saved')
    || value.state === 'applied' && template.settings.chargeGroup !== undefined && !enhanced
    || value.state === 'applied' && template.settings.fulfillment?.mode === 'replace' && !fulfillment
    || (value.state === 'saved' ? value.command !== 'save' || value.appliedCount !== 0 : value.command !== 'apply' || value.appliedCount < 1)) return null;
  return value as unknown as ShippingSettingsOperationReceipt;
}
export function shippingSettingsReceiptMatches(receipt: ShippingSettingsOperationReceipt, context: ShippingSettingsOperationContext): boolean {
  return receipt.operationId === context.operationId && receipt.command === context.command && receipt.templateId === context.templateId
    && receipt.expectedRevision === context.expectedRevision && receipt.actorId === context.expectedActorId && receipt.sessionId === context.expectedSessionId;
}
