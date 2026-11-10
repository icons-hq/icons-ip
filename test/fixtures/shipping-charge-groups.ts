import type { GoodsTransactionDisplay } from '@/lib/goods-transaction';
import type { ShippingChargeDetails, ShippingChargeSnapshot } from '@/lib/shipping-charge-groups';
import type { ShippingChargeGroup, ShippingChargeGroupAssignRequest, ShippingChargeGroupAssignmentPreview, ShippingChargeGroupGood,
  ShippingChargeGroupIdentity, ShippingChargeGroupOperationReceipt, ShippingChargeGroupOriginGuard, ShippingChargeGroupSaveRequest,
  ShippingChargeGroupRegionPolicy, ShippingChargeGroupSummary } from '@/lib/admin/shipping-charge-groups';

export const chargeId = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
export const chargeIds = { origin: chargeId(1), group: chargeId(2), version: chargeId(3), actor: chargeId(4), session: chargeId(5),
  operation: chargeId(6), other: chargeId(7), assignment: chargeId(8), quote: chargeId(9), order: chargeId(10) };
export const chargeIdentity: ShippingChargeGroupIdentity = { expectedActorId: chargeIds.actor, expectedSessionId: chargeIds.session };
export const chargeTime = '2026-10-14T00:00:00.123456Z';
export const chargeLater = '2026-10-14T00:01:00.123456Z';

export function chargePublicFixtures() {
  const chargeDetails: ShippingChargeDetails = { version: 1, unassignedBaseFee: 1000, originRegionalFee: 2000, originRegionFeeUnit: 'per_shipment',
    groups: [{ groupId: chargeIds.group, revision: 1, mode: 'max', quantity: 3, subtotal: 30000, baseFee: 5000,
      regionalFee: 3000, regionMode: 'override', goodIds: ['good-a', 'good-b'] }] };
  const snapshot: ShippingChargeSnapshot = { calculationVersion: 2, originId: chargeIds.origin, originName: 'TEST 출고지',
    totalFee: 7000, prepaidFee: 7000, collectFee: 4000, fullFee: 11000,
    components: [{ goodId: 'good-a', paymentMode: 'prepaid', baseFee: 2500, regionalFee: 1500, totalFee: 4000, deliveryPolicyId: null },
      { goodId: 'good-b', paymentMode: 'collect', baseFee: 2500, regionalFee: 1500, totalFee: 4000, deliveryPolicyId: chargeId(11) },
      { goodId: 'good-c', paymentMode: 'prepaid', baseFee: 1000, regionalFee: 2000, totalFee: 3000, deliveryPolicyId: null }],
    collector: { name: 'TEST 수납사', method: 'TEST 배송 시 지급', refundContact: 'TEST 연락처', instructions: 'TEST 안내' }, chargeDetails };
  const rows = [{ id: 'good-a', qty: 1, price: 15000 }, { id: 'good-b', qty: 2, price: 7500 }, { id: 'good-c', qty: 1, price: 5000 }];
  const display: GoodsTransactionDisplay = { calculationVersion: 2, currency: 'KRW', calculatedAt: chargeTime, nextChangeAt: null,
    lines: rows.map((row, i) => ({ lineId: chargeId(20 + i), goodId: row.id, variantId: chargeId(30 + i), qty: row.qty,
      regularUnitPrice: row.price, unitPrice: row.price, volumeUnitDiscount: 0, subtotal: row.price * row.qty, volumeDiscountTotal: 0,
      netSubtotal: row.price * row.qty, couponDiscount: 0, storeCreditDiscount: 0, paidGoodsTotal: row.price * row.qty, volumePolicyId: null })),
    shipping: [{ originId: snapshot.originId, prepaidFee: snapshot.prepaidFee, collectFee: snapshot.collectFee, fullFee: snapshot.fullFee,
      components: snapshot.components, collector: snapshot.collector, chargeDetails }],
    totals: { subtotal: 35000, volumeDiscountTotal: 0, netGoodsTotal: 35000, couponDiscountTotal: 0, storeCreditTotal: 0,
      prepaidShippingTotal: 7000, collectShippingTotal: 4000, onlineTotal: 42000, customerTotal: 46000 },
    userCouponId: null, storeCreditMaximum: 0, paymentMethods: { card: true, bankTransfer: true } };
  return { chargeDetails, snapshot, display, receipt: { orderId: chargeIds.order, quoteId: chargeIds.quote, display } };
}

export function chargeAdminFixtures() {
  const origin: ShippingChargeGroupOriginGuard = { id: chargeIds.origin, name: 'TEST 출고지', updatedAt: chargeTime,
    defaultCarrier: 'cj', isActive: true, defaultGroupId: null, defaultGroupRevision: 0 };
  const group: ShippingChargeGroup = { id: chargeIds.group, originId: chargeIds.origin, revision: 1, versionId: chargeIds.version,
    name: 'TEST 묶음그룹', enabled: true, archived: false, isDefault: false, calculationMode: 'min', regional: { mode: 'inherit', policy: null },
    assignedCount: 0, createdAt: chargeTime, updatedAt: chargeLater };
  const summary: ShippingChargeGroupSummary = { id: group.id, originId: group.originId, revision: group.revision, name: group.name,
    enabled: group.enabled, archived: group.archived, calculationMode: group.calculationMode, regionalMode: group.regional.mode };
  const good: ShippingChargeGroupGood = { id: 'good-a', updatedAt: chargeTime, ownerGoodId: 'good-a', ownerUpdatedAt: chargeTime,
    familyGoodIds: ['good-a'], transactionRevision: 0, deliveryVersionId: null, originId: chargeIds.origin,
    assignmentRevision: 0, assignmentVersionId: null, groupId: null, groupRevision: null,
    name: 'TEST 상품', code: 'TEST-1', editable: true, blocker: null, effectiveCount: 1 };
  const guard = { id:good.id, updatedAt:good.updatedAt, ownerGoodId:good.ownerGoodId, ownerUpdatedAt:good.ownerUpdatedAt,
    familyGoodIds:good.familyGoodIds, transactionRevision:good.transactionRevision, deliveryVersionId:good.deliveryVersionId,
    originId:good.originId, assignmentRevision:good.assignmentRevision, assignmentVersionId:good.assignmentVersionId,
    groupId:good.groupId, groupRevision:good.groupRevision };
  const save: ShippingChargeGroupSaveRequest = { ...chargeIdentity, operationId: chargeIds.operation, command: 'save', groupId: group.id,
    expectedRevision: 0, originId: origin.id, originUpdatedAt: origin.updatedAt, expectedDefaultGroupId: null, expectedDefaultGroupRevision: 0,
    values: { name: group.name, enabled: group.enabled, archived: group.archived, isDefault: group.isDefault,
      calculationMode: group.calculationMode, regional: group.regional }, attestRegional: false };
  const assign: ShippingChargeGroupAssignRequest = { ...chargeIdentity, operationId: chargeIds.operation, command: 'assign', groupId: group.id,
    expectedRevision: group.revision, origins: [origin], goods: [guard] };
  const saved: ShippingChargeGroupOperationReceipt = { state: 'saved', operationId: save.operationId, command: 'save', groupId: group.id,
    expectedRevision: 0, actorId: chargeIds.actor, sessionId: chargeIds.session, group, changedDefaultGroup: null, appliedCount: 0, goods: [], recordedAt: chargeLater };
  const assigned: ShippingChargeGroupOperationReceipt = { ...saved, state: 'assigned', command: 'assign', expectedRevision: group.revision,
    group: { ...group, assignedCount: 1 }, appliedCount: 1, goods: [{ ...guard, assignmentRevision: 1, assignmentVersionId: chargeIds.assignment,
      groupId: group.id, groupRevision: group.revision, updatedAt: chargeLater, ownerUpdatedAt: chargeLater }] };
  const sealed: ShippingChargeGroupOperationReceipt = { ...saved, state: 'sealed', group: null };
  const preview: ShippingChargeGroupAssignmentPreview = { actorId: chargeIds.actor, sessionId: chargeIds.session, group, canAssign: true,
    runtimeEnabled: true, origins: [origin], canManageRegional: false, goods: [{ ...good, beforeGroup: null, afterGroup: summary }] };
  const region: ShippingChargeGroupRegionPolicy = { carrierCode: 'cj', startsAt: chargeTime, endsAt: null, openEnded: true,
    sourceEvidence: 'TEST 계약 참조', unlistedDisposition: 'standard', noRulesConfirmed: true, rules: [] };
  return { origin, group, summary, good, guard, save, assign, saved, assigned, sealed, preview, region };
}
