import type { AdminDeliveryPolicy, AdminShipmentDelivery, DeliveryHistory } from '@/lib/shipment-delivery';

/* 주문 상세 배송 방식·인계 확인(ShipmentDeliveryPanel) 시험용 배송 건·운영 조건. */
export const DELIVERY_PANEL_SHIPMENT_ID = 'c3a00000-0000-4002-8000-000000000011';
export const DELIVERY_PANEL_ORDER_ID = 'c3a00000-0000-4002-8000-000000000012';
const ORIGIN_ID = 'c3a00000-0000-4002-8000-000000000013';

export function deliveryPolicyFixture(method: AdminDeliveryPolicy['method'], overrides: Partial<AdminDeliveryPolicy> = {}): AdminDeliveryPolicy {
  return {
    id: `c3a00000-0000-4002-8000-0000000001${method === 'quick' ? '1' : method === 'pickup' ? '2' : method === 'direct' ? '3' : '4'}0`, originId: ORIGIN_ID, method, revision: 3, state: 'active',
    contactName: '합성 인계 담당', contactPhone: '02-0000-0000', handoffLocation: '합성 인계 장소', handoffInstructions: '합성 인계 안내', appointmentInstructions: '합성 약속 안내',
    allowDelegate: false, completionInstructions: '합성 완료 안내', cancellationInstructions: '합성 취소 안내', approvalReference: null,
    createdAt: '2026-11-01T00:00:00Z', activatedAt: '2026-11-01T00:00:00Z', stoppedAt: null, ...overrides,
  };
}

export function deliveryPanelShipment(overrides: Partial<AdminShipmentDelivery> = {}): AdminShipmentDelivery {
  return {
    shipmentId: DELIVERY_PANEL_SHIPMENT_ID, orderId: DELIVERY_PANEL_ORDER_ID, originId: ORIGIN_ID, status: 'ready', orderStatus: 'confirmed',
    updatedAt: '2026-11-26T01:00:00+00:00', shippingFee: 3000, exportedAt: null, canSelect: true, canTransition: false, preorderReady: true,
    summary: { method: 'parcel', policy: null, providerName: null, canIssueReceipt: false }, policies: [], history: [], ...overrides,
  };
}

export function deliveryHistoryFixture(kind: DeliveryHistory['kind'], evidence: Record<string, unknown>): DeliveryHistory {
  return { id: `c3a00000-0000-4002-8000-00000000${kind.length.toString().padStart(4, '0')}`, kind, evidence, actorName: '수민', recordedAt: '2026-11-26T02:00:00+00:00' };
}
