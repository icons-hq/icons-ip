import type { ShippingSettingsApplyInput, ShippingSettingsCandidates, ShippingSettingsIdentity, ShippingSettingsOperationContext,
  ShippingSettingsOperationReceipt, ShippingSettingsPreview, ShippingSettingsSaveRequest, ShippingSettingsTemplate } from '@/lib/admin/shipping-settings-templates';
import type { DeliveryTermsInput } from '@/lib/admin/goods-transaction-terms';

export const shippingIds = {
  actor: '92000000-0000-4000-8000-000000000001', session: '92000000-0000-4000-8000-000000000002', template: '92000000-0000-4000-8000-000000000003',
  operation: '92000000-0000-4000-8000-000000000004', origin: '92000000-0000-4000-8000-000000000005', delivery: '92000000-0000-4000-8000-000000000006',
  collect: '92000000-0000-4000-8000-000000000007', other: '92000000-0000-4000-8000-000000000099',
};
export const shippingIdentity: ShippingSettingsIdentity = { expectedActorId: shippingIds.actor, expectedSessionId: shippingIds.session };
export function shippingFixtures() {
  const at = '2026-10-14T01:00:00.123456Z', next = '2026-10-14T02:00:00.123456Z';
  const policy: DeliveryTermsInput = { status: 'active', paymentMode: 'buyer_choice', quantityTerms: { kind: 'tier3', baseFee: 3000, firstLimit: 2, secondLimit: 4, extra1: 1000, extra2: 2000 },
    draftValues: { kind: 'tier3', baseFee: '3000', firstLimit: '2', secondLimit: '4', extra1: '1000', extra2: '2000', interval: '7', paymentMode: 'buyer_choice' } };
  const settings = { originId: shippingIds.origin, feeType: 'free' as const, individualFee: 3500,
    claimPolicy: { returnAllowed: null, exchangeAllowed: null, restrictionReason: null, returnFee: null, returnFreeShippingFee: null, exchangeFee: null }, delivery: { mode: 'preserve' as const } };
  const template: ShippingSettingsTemplate = { id: shippingIds.template, name: '합성 배송 조건', revision: 1, enabled: true, settings, createdAt: at, updatedAt: at };
  const guard = { id: 'good-1', updatedAt: at, ownerGoodId: 'good-1', ownerUpdatedAt: at, familyGoodIds: ['good-1'], transactionRevision: 3, deliveryVersionId: shippingIds.delivery };
  const effective = { originId: shippingIds.origin, feeType: 'free' as const, individualFee: 3500, delivery: policy };
  const preview: ShippingSettingsPreview = { template, actorId: shippingIds.actor, sessionId: shippingIds.session, canApply: true,
    origin: { id: shippingIds.origin, name: '합성 출고지', updatedAt: at, baseFee: 3000, freeThreshold: 50000, returnAddress: '합성 반송 주소', defaultCarrier: '합성택배',
      collectRevision: 1, collectVersionId: shippingIds.collect, collectReady: true, collectorName: '합성 수납자' },
    goods: [{ ...guard, name: '합성 상품', code: 'TEST-1', editable: true, blocker: null, before: settings, after: settings, effectiveBefore: effective, effectiveAfter: effective }] };
  const context: ShippingSettingsOperationContext = { ...shippingIdentity, operationId: shippingIds.operation, command: 'apply', templateId: shippingIds.template, expectedRevision: 1 };
  const apply: ShippingSettingsApplyInput = { ...context, command: 'apply', originUpdatedAt: at, collectRevision: 1, collectVersionId: shippingIds.collect, goods: [guard] };
  const save: ShippingSettingsSaveRequest = { ...context, command: 'save', expectedRevision: 0, name: template.name, enabled: true, settings };
  const applied: ShippingSettingsOperationReceipt = { operationId: context.operationId, command: 'apply', templateId: context.templateId, expectedRevision: 1,
    actorId: shippingIds.actor, sessionId: shippingIds.session, state: 'applied', template, appliedCount: 1,
    goods: [{ id: guard.id, updatedAt: next, transactionRevision: 3, deliveryVersionId: shippingIds.delivery }] };
  const saved: ShippingSettingsOperationReceipt = { ...applied, command: 'save', expectedRevision: 0, state: 'saved', appliedCount: 0, goods: [] };
  const sealed: ShippingSettingsOperationReceipt = { ...applied, state: 'sealed', template: null, appliedCount: 0, goods: [] };
  const candidates: ShippingSettingsCandidates = { rows: [{ id: guard.id, name: '합성 상품', code: 'TEST-1', updatedAt: at, settings,
    templateId: null, templateRevision: null, ownerGoodId: guard.ownerGoodId, familyGoodIds: guard.familyGoodIds, editable: true, blocker: null, effective }], page: 1, pageSize: 20, total: 1 };
  return { at, next, policy, settings, template, guard, effective, preview, context, apply, save, applied, saved, sealed, candidates };
}
