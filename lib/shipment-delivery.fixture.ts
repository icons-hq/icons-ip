import type { ShipmentDeliverySummary } from './shipment-delivery';

export function shipmentDeliveryFixture(overrides: Partial<ShipmentDeliverySummary> = {}): ShipmentDeliverySummary {
  return {
    method: 'pickup', providerName: null, canIssueReceipt: true,
    policy: {
      version: 1, policyId: '00000000-0000-4000-8000-000000000492', revision: 2,
      contactName: '합성 인계 담당', contactPhone: '02-0000-0000', handoffLocation: '합성 수령 장소',
      handoffInstructions: '합성 인계 안내', appointmentInstructions: '합의한 예약 시각을 확인해주세요.',
      completionInstructions: '상품 확인 후 일회 수령 확인값을 제시해주세요.',
      cancellationInstructions: '발주확인 이후에는 고객센터에서 검토합니다.', allowDelegate: false,
      feeRule: 'order_fee_unchanged', confirmationRule: 'recipient_code',
    }, ...overrides,
  };
}
