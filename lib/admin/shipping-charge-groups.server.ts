import 'server-only';
import { createClient } from '@/lib/supabase/server';
import { transactionExactKeys, transactionInteger } from '@/lib/goods-transaction-values';
import {
  parseShippingChargeGroup, parseShippingChargeGroupFilters, parseShippingChargeGroupGood, parseShippingChargeGroupGoodsFilters,
  parseShippingChargeGroupIdentity, parseShippingChargeGroupOriginGuard, parseShippingChargeGroupSummary, shippingChargeGroupRecord,
  type ShippingChargeGroup, type ShippingChargeGroupAssignmentPreview, type ShippingChargeGroupData, type ShippingChargeGroupFilters,
  type ShippingChargeGroupGood, type ShippingChargeGroupGoodData, type ShippingChargeGroupGoodsData, type ShippingChargeGroupGoodsFilters,
  type ShippingChargeGroupIdentity, type ShippingChargeGroupListData, type ShippingChargeGroupOriginGuard, type ShippingChargeGroupSummary,
} from './shipping-charge-groups';

const record = shippingChargeGroupRecord;
const identityMatches = (row: Record<string, unknown>, identity: ShippingChargeGroupIdentity) => row.actorId === identity.expectedActorId && row.sessionId === identity.expectedSessionId;
const unique = <T>(rows: readonly T[], key: (row: T) => unknown) => new Set(rows.map(key)).size === rows.length;
function pageMatches(value: Record<string, unknown>, page: number, count: number): boolean {
  return value.page === page && value.pageSize === 20 && transactionInteger(value.total)
    && count <= 20 && count <= Math.max(0, value.total - (page - 1) * 20);
}
function groupOriginMatches(group: ShippingChargeGroup, origin: ShippingChargeGroupOriginGuard): boolean {
  return group.originId === origin.id && (group.isDefault
    ? origin.defaultGroupId === group.id && origin.defaultGroupRevision === group.revision : origin.defaultGroupId !== group.id);
}
function summaryMatches(summary: ShippingChargeGroupSummary, group: ShippingChargeGroup): boolean {
  return summary.id === group.id && summary.originId === group.originId && summary.revision === group.revision && summary.name === group.name
    && summary.enabled === group.enabled && summary.archived === group.archived && summary.calculationMode === group.calculationMode
    && summary.regionalMode === group.regional.mode;
}

export function parseShippingChargeGroupListData(value: unknown, filters: ShippingChargeGroupFilters, identity: ShippingChargeGroupIdentity): ShippingChargeGroupListData | null {
  if (!record(value) || !transactionExactKeys(value, ['actorId', 'sessionId', 'runtimeEnabled', 'page', 'pageSize', 'total', 'groups', 'origins', 'canManageRegional'])
    || !identityMatches(value, identity) || typeof value.runtimeEnabled !== 'boolean' || typeof value.canManageRegional !== 'boolean'
    || !Array.isArray(value.groups) || !pageMatches(value, filters.page, value.groups.length) || !Array.isArray(value.origins)
    || value.origins.length > 10000) return null;
  const groups = value.groups.map(parseShippingChargeGroup), origins = value.origins.map(parseShippingChargeGroupOriginGuard);
  if (groups.some(row => !row) || origins.some(row => !row)) return null;
  const groupRows = groups as ShippingChargeGroup[], originRows = origins as ShippingChargeGroupOriginGuard[];
  if (!unique(groupRows, row => row.id) || !unique(originRows, row => row.id)
    || filters.originId !== null && (originRows.length > 1 || originRows.some(row => row.id !== filters.originId))
    || groupRows.some(row => filters.originId !== null && row.originId !== filters.originId
      || !originRows.some(origin => groupOriginMatches(row, origin))
      || filters.status === 'active' && (!row.enabled || row.archived)
      || filters.status === 'inactive' && (row.enabled || row.archived)
      || filters.status === 'archived' && !row.archived)) return null;
  return value as unknown as ShippingChargeGroupListData;
}
export function parseShippingChargeGroupData(value: unknown, groupId: string, identity: ShippingChargeGroupIdentity): ShippingChargeGroupData | null {
  if (!record(value) || !transactionExactKeys(value, ['actorId', 'sessionId', 'runtimeEnabled', 'group', 'origin', 'canManageRegional'])
    || !identityMatches(value, identity) || typeof value.runtimeEnabled !== 'boolean' || typeof value.canManageRegional !== 'boolean') return null;
  const group = parseShippingChargeGroup(value.group), origin = parseShippingChargeGroupOriginGuard(value.origin);
  return group && origin && group.id === groupId && groupOriginMatches(group, origin) ? value as unknown as ShippingChargeGroupData : null;
}
export function parseShippingChargeGroupGoodData(value: unknown, goodId: string, identity: ShippingChargeGroupIdentity): ShippingChargeGroupGoodData | null {
  if (!record(value) || !transactionExactKeys(value, ['actorId', 'sessionId', 'runtimeEnabled', 'good', 'group', 'origin', 'canManageRegional'])
    || !identityMatches(value, identity) || typeof value.runtimeEnabled !== 'boolean' || typeof value.canManageRegional !== 'boolean') return null;
  const good = parseShippingChargeGroupGood(value.good), group = value.group === null ? null : parseShippingChargeGroup(value.group);
  const origin = value.origin === null ? null : parseShippingChargeGroupOriginGuard(value.origin);
  if (!good || good.id !== goodId || value.group !== null && !group || value.origin !== null && !origin
    || good.originId !== (origin?.id ?? null) || good.groupId !== (group?.id ?? null) || good.groupRevision !== (group?.revision ?? null)
    || group && (!origin || !groupOriginMatches(group, origin))
    || good.originId === null && good.blocker !== (good.id === good.ownerGoodId ? 'shipping_charge_group_origin_unavailable' : 'goods_aggregation_policy_owned_by_source')) return null;
  return value as unknown as ShippingChargeGroupGoodData;
}
export function parseShippingChargeGroupGoodsData(value: unknown, filters: ShippingChargeGroupGoodsFilters, identity: ShippingChargeGroupIdentity): ShippingChargeGroupGoodsData | null {
  if (!record(value) || !transactionExactKeys(value, ['actorId', 'sessionId', 'page', 'pageSize', 'total', 'goods']) || !identityMatches(value, identity)
    || !Array.isArray(value.goods) || !pageMatches(value, filters.page, value.goods.length)) return null;
  const goods = value.goods.map(parseShippingChargeGroupGood);
  if (goods.some(row => !row)) return null;
  const rows = goods as ShippingChargeGroupGood[];
  if (!unique(rows, row => row.id) || rows.some(row => filters.originId !== null && row.originId !== filters.originId
    || filters.groupId !== null && row.groupId !== filters.groupId)) return null;
  return value as unknown as ShippingChargeGroupGoodsData;
}
export function parseShippingChargeGroupAssignmentPreview(value: unknown, groupId: string | null, goodIds: readonly string[],
  identity: ShippingChargeGroupIdentity): ShippingChargeGroupAssignmentPreview | null {
  if (!record(value) || !transactionExactKeys(value, ['actorId', 'sessionId', 'group', 'canAssign', 'runtimeEnabled', 'origins', 'goods', 'canManageRegional'])
    || !identityMatches(value, identity) || typeof value.runtimeEnabled !== 'boolean' || typeof value.canAssign !== 'boolean'
    || typeof value.canManageRegional !== 'boolean' || !Array.isArray(value.origins) || value.origins.length > 100
    || !Array.isArray(value.goods) || value.goods.length !== goodIds.length || !value.goods.length || value.goods.length > 100) return null;
  const group = value.group === null ? null : parseShippingChargeGroup(value.group);
  if (value.group !== null && !group || (group?.id ?? null) !== groupId) return null;
  const originResults = value.origins.map(parseShippingChargeGroupOriginGuard); if (originResults.some(row => !row)) return null;
  const origins = originResults as ShippingChargeGroupOriginGuard[], goods: ShippingChargeGroupAssignmentPreview['goods'] = [];
  if (!unique(origins, row => row.id)) return null;
  for (const raw of value.goods) {
    if (!record(raw) || !Object.hasOwn(raw, 'beforeGroup') || !Object.hasOwn(raw, 'afterGroup')) return null;
    const { beforeGroup: beforeRaw, afterGroup: afterRaw, ...plain } = raw;
    const good = parseShippingChargeGroupGood(plain), before = beforeRaw === null ? null : parseShippingChargeGroupSummary(beforeRaw);
    const after = afterRaw === null ? null : parseShippingChargeGroupSummary(afterRaw);
    if (!good || !goodIds.includes(good.id) || goods.some(row => row.id === good.id)
      || beforeRaw !== null && !before || afterRaw !== null && !after
      || good.groupId !== (before?.id ?? null) || good.groupRevision !== (before?.revision ?? null)
      || before && before.originId !== good.originId
      || (group ? !after || !summaryMatches(after, group) : after !== null)) return null;
    if (good.originId !== null && !origins.some(origin => origin.id === good.originId)
      || good.originId === null && value.canAssign && !(groupId === null && good.groupId === null && good.blocker === null)) return null;
    goods.push({ ...good, beforeGroup: before, afterGroup: after });
  }
  if (origins.some(origin => !goods.some(good => good.originId === origin.id))
    || value.canAssign && (!value.runtimeEnabled || goods.some(row => !row.editable || row.blocker !== null)
      || group && (!group.enabled || group.archived || origins.some(origin => !origin.isActive) || goods.some(row => row.originId !== group.originId)))) return null;
  return value as unknown as ShippingChargeGroupAssignmentPreview;
}

export class ShippingChargeGroupReadError extends Error {
  constructor(readonly code: string | undefined, readonly reason: string) { super('shipping_charge_group_read_failed'); }
}
async function read(name: string, args: Record<string, unknown>): Promise<unknown> {
  const { data, error } = await (await createClient()).rpc(name, args);
  if (error) throw new ShippingChargeGroupReadError(error.code, error.message);
  return data;
}
const rpcIdentity = (identity: ShippingChargeGroupIdentity) => ({ p_expected_actor_id: identity.expectedActorId, p_expected_session_id: identity.expectedSessionId });
export async function loadShippingChargeGroups(filters: ShippingChargeGroupFilters, identity: ShippingChargeGroupIdentity): Promise<ShippingChargeGroupListData> {
  if (!parseShippingChargeGroupFilters(filters) || !parseShippingChargeGroupIdentity(identity)) throw new Error('shipping_charge_group_read_invalid');
  const result = parseShippingChargeGroupListData(await read('admin_list_shipping_charge_groups', { p_origin_id: filters.originId,
    p_query: filters.query, p_status: filters.status, p_page: filters.page, ...rpcIdentity(identity) }), filters, identity);
  if (!result) throw new Error('shipping_charge_group_read_invalid'); return result;
}
export async function loadShippingChargeGroup(groupId: string, identity: ShippingChargeGroupIdentity): Promise<ShippingChargeGroupData> {
  const result = parseShippingChargeGroupData(await read('admin_get_shipping_charge_group', { p_group_id: groupId, ...rpcIdentity(identity) }), groupId, identity);
  if (!result) throw new Error('shipping_charge_group_read_invalid'); return result;
}
export async function loadGoodShippingChargeGroup(goodId: string, identity: ShippingChargeGroupIdentity): Promise<ShippingChargeGroupGoodData> {
  const result = parseShippingChargeGroupGoodData(await read('admin_get_good_shipping_charge_group', { p_good_id: goodId, ...rpcIdentity(identity) }), goodId, identity);
  if (!result) throw new Error('shipping_charge_group_read_invalid'); return result;
}
export async function searchShippingChargeGroupGoods(filters: ShippingChargeGroupGoodsFilters, identity: ShippingChargeGroupIdentity): Promise<ShippingChargeGroupGoodsData> {
  if (!parseShippingChargeGroupGoodsFilters(filters) || !parseShippingChargeGroupIdentity(identity)) throw new Error('shipping_charge_group_read_invalid');
  const result = parseShippingChargeGroupGoodsData(await read('admin_search_goods_for_shipping_charge_group', { p_origin_id: filters.originId,
    p_group_id: filters.groupId, p_query: filters.query, p_page: filters.page, ...rpcIdentity(identity) }), filters, identity);
  if (!result) throw new Error('shipping_charge_group_read_invalid'); return result;
}
export async function previewShippingChargeGroupAssignment(groupId: string | null, goodIds: string[], identity: ShippingChargeGroupIdentity): Promise<ShippingChargeGroupAssignmentPreview> {
  const result = parseShippingChargeGroupAssignmentPreview(await read('admin_preview_shipping_charge_group_assignment', {
    p_group_id: groupId, p_good_ids: goodIds, ...rpcIdentity(identity) }), groupId, goodIds, identity);
  if (!result) throw new Error('shipping_charge_group_read_invalid'); return result;
}
