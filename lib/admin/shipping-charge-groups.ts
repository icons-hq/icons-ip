import { isUuid } from '@/lib/uuid';
import { GOODS_TRANSACTION_INT_MAX, GOODS_TRANSACTION_MAX_LINES, GOODS_TRANSACTION_SELECTION_MAX_BYTES, transactionEpochMicros,
  transactionExactKeys, transactionGoodId, transactionInstant, transactionInteger } from '@/lib/goods-transaction-values';
import { normalizeShippingAddress } from '@/lib/shipping-regions';
import type { ShippingChargeGroupMode, ShippingChargeRegionMode } from '@/lib/shipping-charge-groups';
import { MAX_SHIPPING_REGION_RULES, shippingRegionPolicyProblems, type ShippingRegionRuleInput } from './shipping-regions';

export const SHIPPING_CHARGE_GROUPS_PATH = '/admin/settings/origins';
export const SHIPPING_CHARGE_GROUP_GOOD_LIMIT = 100;
export interface ShippingChargeGroupIdentity { expectedActorId: string; expectedSessionId: string }
export interface ShippingChargeGroupRegionPolicy {
  carrierCode: string; startsAt: string | null; endsAt: string | null; openEnded: boolean | null;
  sourceEvidence: string; unlistedDisposition: 'standard' | 'manual_review' | null; noRulesConfirmed: boolean; rules: ShippingRegionRuleInput[];
}
export interface ShippingChargeGroupValues {
  name: string; enabled: boolean; archived: boolean; isDefault: boolean; calculationMode: ShippingChargeGroupMode;
  regional: { mode: 'inherit'; policy: null } | { mode: 'override'; policy: ShippingChargeGroupRegionPolicy };
}
export interface ShippingChargeGroup extends ShippingChargeGroupValues {
  id: string; originId: string; revision: number; versionId: string; assignedCount: number; createdAt: string; updatedAt: string;
}
export interface ShippingChargeGroupSummary {
  id: string; originId: string; revision: number; name: string; enabled: boolean; archived: boolean;
  calculationMode: ShippingChargeGroupMode; regionalMode: ShippingChargeRegionMode;
}
export interface ShippingChargeGroupOriginGuard {
  id: string; name: string; updatedAt: string; defaultCarrier: string | null; isActive: boolean;
  defaultGroupId: string | null; defaultGroupRevision: number;
}
export interface ShippingChargeGroupGoodGuard {
  id: string; updatedAt: string; ownerGoodId: string; ownerUpdatedAt: string; familyGoodIds: string[];
  transactionRevision: number; deliveryVersionId: string | null; originId: string | null;
  assignmentRevision: number; assignmentVersionId: string | null; groupId: string | null; groupRevision: number | null;
}
export const SHIPPING_CHARGE_GROUP_BLOCKERS = ['goods_aggregation_policy_owned_by_source', 'checkout_contract_upgrade_required',
  'shipping_charge_group_unavailable', 'shipping_charge_group_origin_mismatch', 'shipping_charge_group_origin_unavailable', 'collect_contract_not_ready'] as const;
export type ShippingChargeGroupBlocker = typeof SHIPPING_CHARGE_GROUP_BLOCKERS[number];
export interface ShippingChargeGroupGood extends ShippingChargeGroupGoodGuard {
  name: string; code: string | null; editable: boolean; blocker: ShippingChargeGroupBlocker | null; effectiveCount: number;
}
export interface ShippingChargeGroupOperationContext extends ShippingChargeGroupIdentity {
  operationId: string; command: 'save' | 'assign'; groupId: string | null; expectedRevision: number;
}
export interface ShippingChargeGroupSaveRequest extends ShippingChargeGroupOperationContext {
  command: 'save'; groupId: string; originId: string; originUpdatedAt: string; expectedDefaultGroupId: string | null;
  expectedDefaultGroupRevision: number; values: ShippingChargeGroupValues; attestRegional: boolean;
}
export interface ShippingChargeGroupAssignRequest extends ShippingChargeGroupOperationContext {
  command: 'assign'; origins: ShippingChargeGroupOriginGuard[]; goods: ShippingChargeGroupGoodGuard[];
}
export type ShippingChargeGroupOperationRequest = ShippingChargeGroupSaveRequest | ShippingChargeGroupAssignRequest;
export interface ShippingChargeGroupOperationReceipt {
  state: 'saved' | 'assigned' | 'sealed'; operationId: string; command: 'save' | 'assign'; groupId: string | null; expectedRevision: number;
  actorId: string; sessionId: string; group: ShippingChargeGroup | null; changedDefaultGroup: ShippingChargeGroup | null;
  appliedCount: number; goods: ShippingChargeGroupGoodGuard[]; recordedAt: string;
}
export interface ShippingChargeGroupFilters { originId: string | null; query: string; status: 'all' | 'active' | 'inactive' | 'archived'; page: number }
export interface ShippingChargeGroupListData {
  actorId: string; sessionId: string; runtimeEnabled: boolean; page: number; pageSize: 20; total: number;
  groups: ShippingChargeGroup[]; origins: ShippingChargeGroupOriginGuard[]; canManageRegional: boolean;
}
export interface ShippingChargeGroupData {
  actorId: string; sessionId: string; runtimeEnabled: boolean; group: ShippingChargeGroup; origin: ShippingChargeGroupOriginGuard; canManageRegional: boolean;
}
export interface ShippingChargeGroupGoodData extends Omit<ShippingChargeGroupData, 'group' | 'origin'> {
  good: ShippingChargeGroupGood; group: ShippingChargeGroup | null; origin: ShippingChargeGroupOriginGuard | null;
}
export interface ShippingChargeGroupGoodsFilters { originId: string | null; groupId: string | null; query: string; page: number }
export interface ShippingChargeGroupGoodsData {
  actorId: string; sessionId: string; page: number; pageSize: 20; total: number; goods: ShippingChargeGroupGood[];
}
export interface ShippingChargeGroupAssignmentPreview {
  actorId: string; sessionId: string; group: ShippingChargeGroup | null; canAssign: boolean; runtimeEnabled: boolean;
  origins: ShippingChargeGroupOriginGuard[]; canManageRegional: boolean;
  goods: (ShippingChargeGroupGood & { beforeGroup: ShippingChargeGroupSummary | null; afterGroup: ShippingChargeGroupSummary | null })[];
}

const VALUE_KEYS = ['name', 'enabled', 'archived', 'isDefault', 'calculationMode', 'regional'] as const;
const CONTEXT_KEYS = ['operationId', 'command', 'groupId', 'expectedRevision', 'expectedActorId', 'expectedSessionId'] as const;
const GOOD_GUARD_KEYS = ['id', 'updatedAt', 'ownerGoodId', 'ownerUpdatedAt', 'familyGoodIds', 'transactionRevision', 'deliveryVersionId',
  'originId', 'assignmentRevision', 'assignmentVersionId', 'groupId', 'groupRevision'] as const;
export function shippingChargeGroupRecord(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return (prototype === Object.prototype || prototype === null) && Reflect.ownKeys(value).every(key => {
    const property = Object.getOwnPropertyDescriptor(value, key);
    return typeof key === 'string' && property?.enumerable === true && 'value' in property;
  });
}
const record = shippingChargeGroupRecord;
const uuid = (value: unknown): value is string => typeof value === 'string' && isUuid(value) && value === value.toLowerCase();
const nullableUuid = (value: unknown): value is string | null => value === null || uuid(value);
const revision = (value: unknown, min = 0) => transactionInteger(value, min, GOODS_TRANSACTION_INT_MAX);
const goodId = (value: unknown): value is string => transactionGoodId(value) && value.length <= 120;
const sameTime = (a: string, b: string) => transactionEpochMicros(a) === transactionEpochMicros(b);
const text = (value: unknown, max: number, empty = false): value is string => typeof value === 'string' && value === value.trim()
  && (empty || value.length > 0) && [...value].length <= max && !/[\u0000-\u001f\u007f]/.test(value);
const bounded = (value: unknown) => { try { return new TextEncoder().encode(JSON.stringify(value)).byteLength <= GOODS_TRANSACTION_SELECTION_MAX_BYTES; } catch { return false; } };
const keys = <T extends object>(value: T, names: readonly string[]) => Object.fromEntries(names.map(key => [key, (value as Record<string, unknown>)[key]]));

export function emptyShippingChargeGroupRegionPolicy(carrierCode = ''): ShippingChargeGroupRegionPolicy {
  return { carrierCode, startsAt: null, endsAt: null, openEnded: null, sourceEvidence: '', unlistedDisposition: null, noRulesConfirmed: false, rules: [] };
}
export function emptyShippingChargeGroupValues(): ShippingChargeGroupValues {
  return { name: '', enabled: false, archived: false, isDefault: false, calculationMode: 'min', regional: { mode: 'inherit', policy: null } };
}
export function shippingChargeGroupRegionalProblems(policy: ShippingChargeGroupRegionPolicy): string[] {
  const periodProblem = '종료 일시는 시작 일시보다 뒤여야 합니다.';
  const problems = shippingRegionPolicyProblems({ ...policy, originId: '', name: '배송비 묶음그룹 지역 정책', feeUnit: 'per_shipment',
    chargePolicyGoods: true, waivePolicyThreshold: false, chargeFreeGoods: true, chargeIndividualGoods: true }).filter(problem => problem !== periodProblem);
  if (policy.startsAt && policy.endsAt && transactionInstant(policy.startsAt) && transactionInstant(policy.endsAt)
    && transactionEpochMicros(policy.startsAt) >= transactionEpochMicros(policy.endsAt)) problems.push(periodProblem);
  if (!policy.carrierCode) problems.unshift('출고지의 택배사를 확인해주세요.');
  return problems;
}
export function parseShippingChargeGroupRegionPolicy(value: unknown): ShippingChargeGroupRegionPolicy | null {
  if (!record(value) || !transactionExactKeys(value, ['carrierCode', 'startsAt', 'endsAt', 'openEnded', 'sourceEvidence', 'unlistedDisposition', 'noRulesConfirmed', 'rules'])
    || !text(value.carrierCode, 80) || !(value.startsAt === null || transactionInstant(value.startsAt))
    || !(value.endsAt === null || transactionInstant(value.endsAt)) || !(value.openEnded === null || typeof value.openEnded === 'boolean')
    || typeof value.sourceEvidence !== 'string' || value.sourceEvidence !== value.sourceEvidence.trim() || [...value.sourceEvidence].length > 2000
    || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value.sourceEvidence)
    || ![null, 'standard', 'manual_review'].includes(value.unlistedDisposition as null) || typeof value.noRulesConfirmed !== 'boolean'
    || !Array.isArray(value.rules) || value.rules.length > MAX_SHIPPING_REGION_RULES
    || value.startsAt !== null && value.endsAt !== null && transactionEpochMicros(value.startsAt) >= transactionEpochMicros(value.endsAt)) return null;
  const ids = new Set<string>();
  for (const row of value.rules) {
    if (!record(row) || !transactionExactKeys(row, ['id', 'postalFrom', 'postalTo', 'addressPrefix', 'regionLabel', 'disposition', 'amount'])
      || !nullableUuid(row.id) || row.id !== null && ids.has(row.id) || typeof row.postalFrom !== 'string' || !/^(\d{5})?$/.test(row.postalFrom)
      || typeof row.postalTo !== 'string' || !/^(\d{5})?$/.test(row.postalTo) || !text(row.addressPrefix, 200, true)
      || row.addressPrefix !== normalizeShippingAddress(row.addressPrefix) || !text(row.regionLabel, 100, true) || row.regionLabel !== normalizeShippingAddress(row.regionLabel)
      || !['', 'standard', 'surcharge', 'unavailable', 'manual_review'].includes(String(row.disposition))
      || !(row.amount === null || transactionInteger(row.amount, 0, 1_000_000))) return null;
    if (row.id !== null) ids.add(row.id);
  }
  return value as unknown as ShippingChargeGroupRegionPolicy;
}
export function parseShippingChargeGroupValues(value: unknown): ShippingChargeGroupValues | null {
  if (!record(value) || !transactionExactKeys(value, VALUE_KEYS) || !text(value.name, 80) || value.name !== normalizeShippingAddress(value.name)
    || typeof value.enabled !== 'boolean' || typeof value.archived !== 'boolean' || typeof value.isDefault !== 'boolean'
    || value.archived && value.enabled || value.isDefault && (!value.enabled || value.archived) || !['min', 'max'].includes(String(value.calculationMode))
    || !record(value.regional) || !transactionExactKeys(value.regional, ['mode', 'policy'])) return null;
  if (value.regional.mode === 'inherit') return value.regional.policy === null ? value as unknown as ShippingChargeGroupValues : null;
  if (value.regional.mode !== 'override') return null;
  const policy = parseShippingChargeGroupRegionPolicy(value.regional.policy);
  if (!policy || value.enabled && !value.archived && shippingChargeGroupRegionalProblems(policy).length) return null;
  return value as unknown as ShippingChargeGroupValues;
}
export function parseShippingChargeGroup(value: unknown): ShippingChargeGroup | null {
  if (!record(value) || !transactionExactKeys(value, [...VALUE_KEYS, 'id', 'originId', 'revision', 'versionId', 'assignedCount', 'createdAt', 'updatedAt'])
    || !uuid(value.id) || !uuid(value.originId) || !uuid(value.versionId) || !revision(value.revision, 1)
    || !transactionInteger(value.assignedCount) || !transactionInstant(value.createdAt) || !transactionInstant(value.updatedAt)
    || transactionEpochMicros(value.createdAt) > transactionEpochMicros(value.updatedAt) || !parseShippingChargeGroupValues(keys(value, VALUE_KEYS))
    || value.assignedCount > 0 && (!value.enabled || value.archived)) return null;
  return value as unknown as ShippingChargeGroup;
}
export function parseShippingChargeGroupSummary(value: unknown): ShippingChargeGroupSummary | null {
  return record(value) && transactionExactKeys(value, ['id', 'originId', 'revision', 'name', 'enabled', 'archived', 'calculationMode', 'regionalMode'])
    && uuid(value.id) && uuid(value.originId) && revision(value.revision, 1) && text(value.name, 80) && typeof value.enabled === 'boolean'
    && typeof value.archived === 'boolean' && ['min', 'max'].includes(String(value.calculationMode)) && ['inherit', 'override'].includes(String(value.regionalMode))
    ? value as unknown as ShippingChargeGroupSummary : null;
}
export function parseShippingChargeGroupOriginGuard(value: unknown): ShippingChargeGroupOriginGuard | null {
  return record(value) && transactionExactKeys(value, ['id', 'name', 'updatedAt', 'defaultCarrier', 'isActive', 'defaultGroupId', 'defaultGroupRevision'])
    && uuid(value.id) && text(value.name, 500) && transactionInstant(value.updatedAt) && (value.defaultCarrier === null || text(value.defaultCarrier, 80))
    && typeof value.isActive === 'boolean' && nullableUuid(value.defaultGroupId) && revision(value.defaultGroupRevision)
    && (value.defaultGroupId === null ? value.defaultGroupRevision === 0 : value.defaultGroupRevision > 0)
    ? value as unknown as ShippingChargeGroupOriginGuard : null;
}
export function parseShippingChargeGroupIdentity(value: unknown): ShippingChargeGroupIdentity | null {
  return record(value) && transactionExactKeys(value, ['expectedActorId', 'expectedSessionId']) && uuid(value.expectedActorId) && uuid(value.expectedSessionId)
    ? value as unknown as ShippingChargeGroupIdentity : null;
}
function contextFields(value: Record<string, unknown>): boolean {
  return uuid(value.operationId) && uuid(value.expectedActorId) && uuid(value.expectedSessionId) && ['save', 'assign'].includes(String(value.command))
    && nullableUuid(value.groupId) && transactionInteger(value.expectedRevision, 0, GOODS_TRANSACTION_INT_MAX - 1)
    && (value.command === 'save' ? uuid(value.groupId) && Number(value.expectedRevision) < GOODS_TRANSACTION_INT_MAX
      : value.groupId === null ? value.expectedRevision === 0 : Number(value.expectedRevision) > 0);
}
export function parseShippingChargeGroupOperationContext(value: unknown): ShippingChargeGroupOperationContext | null {
  return record(value) && transactionExactKeys(value, CONTEXT_KEYS) && contextFields(value) ? value as unknown as ShippingChargeGroupOperationContext : null;
}
export function shippingChargeGroupOperationContext(value: ShippingChargeGroupOperationContext): ShippingChargeGroupOperationContext {
  return keys(value, CONTEXT_KEYS) as unknown as ShippingChargeGroupOperationContext;
}
export function parseShippingChargeGroupGoodGuard(value: unknown): ShippingChargeGroupGoodGuard | null {
  if (!record(value) || !transactionExactKeys(value, GOOD_GUARD_KEYS) || !goodId(value.id) || !goodId(value.ownerGoodId)
    || !transactionInstant(value.updatedAt) || !transactionInstant(value.ownerUpdatedAt) || !nullableUuid(value.originId)
    || !revision(value.transactionRevision) || !nullableUuid(value.deliveryVersionId) || value.deliveryVersionId !== null && value.transactionRevision === 0
    || !revision(value.assignmentRevision) || !nullableUuid(value.assignmentVersionId) || (value.assignmentRevision === 0) !== (value.assignmentVersionId === null)
    || !nullableUuid(value.groupId) || !(value.groupRevision === null || revision(value.groupRevision, 1))
    || (value.groupId === null) !== (value.groupRevision === null) || value.groupId !== null && (value.assignmentRevision === 0 || value.originId === null)
    || !Array.isArray(value.familyGoodIds) || !value.familyGoodIds.length || value.familyGoodIds.length > GOODS_TRANSACTION_MAX_LINES
    || value.familyGoodIds.some(id => !goodId(id)) || new Set(value.familyGoodIds).size !== value.familyGoodIds.length
    || !value.familyGoodIds.includes(value.id) || !value.familyGoodIds.includes(value.ownerGoodId)
    || value.id === value.ownerGoodId && !sameTime(value.updatedAt, value.ownerUpdatedAt)) return null;
  return value as unknown as ShippingChargeGroupGoodGuard;
}
export function shippingChargeGroupGoodGuard(value: ShippingChargeGroupGoodGuard): ShippingChargeGroupGoodGuard {
  return keys(value, GOOD_GUARD_KEYS) as unknown as ShippingChargeGroupGoodGuard;
}
export function parseShippingChargeGroupGood(value: unknown): ShippingChargeGroupGood | null {
  if (!record(value) || !transactionExactKeys(value, [...GOOD_GUARD_KEYS, 'name', 'code', 'editable', 'blocker', 'effectiveCount'])
    || !parseShippingChargeGroupGoodGuard(keys(value, GOOD_GUARD_KEYS)) || !text(value.name, 500) || !(value.code === null || text(value.code, 120, true))
    || typeof value.editable !== 'boolean' || !(value.blocker === null || SHIPPING_CHARGE_GROUP_BLOCKERS.includes(value.blocker as ShippingChargeGroupBlocker))
    || value.editable !== (value.id === value.ownerGoodId) || value.id !== value.ownerGoodId && value.blocker !== 'goods_aggregation_policy_owned_by_source'
    || !transactionInteger(value.effectiveCount, 1) || value.effectiveCount !== (value.familyGoodIds as unknown[]).length) return null;
  return value as unknown as ShippingChargeGroupGood;
}
export function parseShippingChargeGroupSaveRequest(value: unknown): ShippingChargeGroupSaveRequest | null {
  return record(value) && bounded(value) && transactionExactKeys(value, [...CONTEXT_KEYS, 'originId', 'originUpdatedAt', 'expectedDefaultGroupId', 'expectedDefaultGroupRevision', 'values', 'attestRegional'])
    && contextFields(value) && value.command === 'save' && uuid(value.originId) && transactionInstant(value.originUpdatedAt)
    && nullableUuid(value.expectedDefaultGroupId) && revision(value.expectedDefaultGroupRevision)
    && (value.expectedDefaultGroupId === null ? value.expectedDefaultGroupRevision === 0 : value.expectedDefaultGroupRevision > 0)
    && parseShippingChargeGroupValues(value.values) && typeof value.attestRegional === 'boolean'
    ? value as unknown as ShippingChargeGroupSaveRequest : null;
}
export function parseShippingChargeGroupAssignRequest(value: unknown): ShippingChargeGroupAssignRequest | null {
  if (!record(value) || !bounded(value) || !transactionExactKeys(value, [...CONTEXT_KEYS, 'origins', 'goods']) || !contextFields(value) || value.command !== 'assign'
    || !Array.isArray(value.goods) || !value.goods.length || value.goods.length > SHIPPING_CHARGE_GROUP_GOOD_LIMIT
    || value.goods.some(row => !parseShippingChargeGroupGoodGuard(row) || row.id !== row.ownerGoodId
      || row.originId === null && !(value.groupId === null && row.groupId === null)
      || row.familyGoodIds.length > 100 || row.transactionRevision >= GOODS_TRANSACTION_INT_MAX || row.assignmentRevision >= GOODS_TRANSACTION_INT_MAX
      || row.groupRevision !== null && row.groupRevision >= GOODS_TRANSACTION_INT_MAX)
    || new Set(value.goods.map(row => row.id)).size !== value.goods.length || !Array.isArray(value.origins)
    || value.origins.length > SHIPPING_CHARGE_GROUP_GOOD_LIMIT || value.origins.some(row => !parseShippingChargeGroupOriginGuard(row) || row.defaultGroupRevision >= GOODS_TRANSACTION_INT_MAX)
    || new Set(value.origins.map(row => row.id)).size !== value.origins.length) return null;
  const goods = value.goods as ShippingChargeGroupGoodGuard[], origins = value.origins as ShippingChargeGroupOriginGuard[];
  if (goods.some(row => row.originId !== null && !origins.some(origin => origin.id === row.originId))
    || origins.some(origin => !goods.some(row => row.originId === origin.id))) return null;
  return value as unknown as ShippingChargeGroupAssignRequest;
}
export function parseShippingChargeGroupOperationReceipt(value: unknown): ShippingChargeGroupOperationReceipt | null {
  if (!record(value) || !transactionExactKeys(value, ['state', 'operationId', 'command', 'groupId', 'expectedRevision', 'actorId', 'sessionId', 'group', 'changedDefaultGroup', 'appliedCount', 'goods', 'recordedAt'])
    || !contextFields({ ...value, expectedActorId: value.actorId, expectedSessionId: value.sessionId })
    || !['saved', 'assigned', 'sealed'].includes(String(value.state)) || !transactionInstant(value.recordedAt)
    || !transactionInteger(value.appliedCount, 0, SHIPPING_CHARGE_GROUP_GOOD_LIMIT) || !Array.isArray(value.goods) || value.goods.length !== value.appliedCount
    || value.goods.some(row => !parseShippingChargeGroupGoodGuard(row)) || new Set(value.goods.map(row => row.id)).size !== value.goods.length) return null;
  if (value.state === 'sealed') return value.group === null && value.changedDefaultGroup === null && value.appliedCount === 0
    ? value as unknown as ShippingChargeGroupOperationReceipt : null;
  const group = value.group === null ? null : parseShippingChargeGroup(value.group);
  const changed = value.changedDefaultGroup === null ? null : parseShippingChargeGroup(value.changedDefaultGroup);
  if (value.group !== null && !group || value.changedDefaultGroup !== null && !changed
    || group?.id !== value.groupId && !(group === null && value.groupId === null)
    || group && (value.state === 'saved' ? ![Number(value.expectedRevision), Number(value.expectedRevision) + 1].includes(group.revision)
      : group.revision !== value.expectedRevision)) return null;
  if (value.state === 'saved') {
    if (value.command !== 'save' || !group || value.appliedCount !== 0 || changed && (changed.id === group.id || changed.originId !== group.originId || changed.isDefault)) return null;
  } else if (value.command !== 'assign' || value.appliedCount < 1 || changed !== null
    || value.goods.some(row => row.id !== row.ownerGoodId || row.groupId !== value.groupId || row.groupRevision !== (group?.revision ?? null)
      || group && row.originId !== group.originId)) return null;
  return value as unknown as ShippingChargeGroupOperationReceipt;
}
export function shippingChargeGroupReceiptMatches(receipt: ShippingChargeGroupOperationReceipt, context: ShippingChargeGroupOperationContext): boolean {
  return receipt.operationId === context.operationId && receipt.command === context.command && receipt.groupId === context.groupId
    && receipt.expectedRevision === context.expectedRevision && receipt.actorId === context.expectedActorId && receipt.sessionId === context.expectedSessionId;
}
export function parseShippingChargeGroupFilters(value: unknown): ShippingChargeGroupFilters | null {
  return record(value) && transactionExactKeys(value, ['originId', 'query', 'status', 'page']) && nullableUuid(value.originId)
    && text(value.query, 100, true) && ['all', 'active', 'inactive', 'archived'].includes(String(value.status)) && transactionInteger(value.page, 1, 1000000)
    ? value as unknown as ShippingChargeGroupFilters : null;
}
export function parseShippingChargeGroupGoodsFilters(value: unknown): ShippingChargeGroupGoodsFilters | null {
  return record(value) && transactionExactKeys(value, ['originId', 'groupId', 'query', 'page']) && nullableUuid(value.originId) && nullableUuid(value.groupId)
    && text(value.query, 100, true) && transactionInteger(value.page, 1, 1000000) ? value as unknown as ShippingChargeGroupGoodsFilters : null;
}

/** Generated rule UUIDs and PostgreSQL timestamp formatting are not user edits. */
export function shippingChargeGroupValuesMatch(actual: ShippingChargeGroupValues, expected: ShippingChargeGroupValues): boolean {
  if (VALUE_KEYS.filter(key => key !== 'regional').some(key => actual[key] !== expected[key]) || actual.regional.mode !== expected.regional.mode) return false;
  if (actual.regional.mode === 'inherit' || expected.regional.mode === 'inherit') return true;
  const a = actual.regional.policy, b = expected.regional.policy;
  if (a.carrierCode !== b.carrierCode || a.openEnded !== b.openEnded || a.sourceEvidence !== b.sourceEvidence
    || a.unlistedDisposition !== b.unlistedDisposition || a.noRulesConfirmed !== b.noRulesConfirmed || a.rules.length !== b.rules.length
    || ['startsAt', 'endsAt'].some(key => {
      const first = a[key as 'startsAt'], second = b[key as 'startsAt']; return first === null || second === null ? first !== second : !sameTime(first, second);
    })) return false;
  return a.rules.every((rule, index) => Object.entries(rule).every(([key, value]) => key === 'id'
    ? b.rules[index].id === null || value === b.rules[index].id : value === b.rules[index][key as keyof ShippingRegionRuleInput]));
}
