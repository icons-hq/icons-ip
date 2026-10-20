import type { ShippingCollectEventReceipt, ShippingCollectEventRequest } from '@/lib/admin/shipping-collect-events';
export const shippingCollectRequest: ShippingCollectEventRequest = {
  orderId: 'ab140000-0000-4000-8000-000000000001', shipmentId: 'ab140000-0000-4000-8000-000000000002', expectedActorId: 'ab140000-0000-4000-8000-000000000003',
  expectedRevision: 1, operationId: 'ab140000-0000-4000-8000-000000000004', event: 'collected', amount: 2250,
  occurredAt: '2026-10-14T01:00:00.123456Z', party: 'TEST 운송사', reversesOperationId: null, reference: 'TEST-RECEIPT', note: 'TEST 외부 수납 확인',
};
export function shippingCollectReceipt(): ShippingCollectEventReceipt {
  const request = shippingCollectRequest;
  return { operationId: request.operationId, obligation: { shipmentId: request.shipmentId, orderId: request.orderId, originName: 'TEST 합성출고지', amount: 2250,
    state: 'collected', revision: 2, updatedAt: '2026-10-14T01:00:01Z', events: [{ operationId: request.operationId, event: request.event, amount: request.amount,
      recordedAt: '2026-10-14T01:00:01Z', occurredAt: request.occurredAt, party: request.party, reversesOperationId: request.reversesOperationId, reference: request.reference, note: request.note }] } };
}
