import { describe, expect, it } from 'vitest';
import { parseAdminShipmentDelivery, parseDeliveryPolicyInput, parseDeliveryEvidence, parseShipmentDeliverySummary, deliveryStatusLabel } from './shipment-delivery';
import { shipmentDeliveryFixture } from './shipment-delivery.fixture';

const fields = {
  state: 'active', contactName: '출고 담당', contactPhone: '02-1234-5678', handoffLocation: '실제 출고지 인계 장소',
  handoffInstructions: '담당자에게 주문번호를 알려주세요.', appointmentInstructions: '합의한 방문 시각을 먼저 확인합니다.',
  allowDelegate: false, completionInstructions: '물품을 확인한 뒤 주문 화면의 일회 수령 확인값을 제시합니다.',
  cancellationInstructions: '발주확인 이후에는 CS에서 취소 또는 클레임을 검토합니다.', approvalReference: '운영 승인 문서 1',
};

describe('delivery method contracts', () => {
  it('preserves unconfigured drafts and requires operational proof and an explicit proxy choice to activate', () => {
    expect(parseDeliveryPolicyInput({ state: 'draft' })).toMatchObject({ state: 'draft', allowDelegate: null, contactPhone: null });
    expect(parseDeliveryPolicyInput({ ...fields, contactPhone: '' })).toBeNull();
    expect(parseDeliveryPolicyInput({ ...fields, allowDelegate: null })).toBeNull();
    expect(parseDeliveryPolicyInput({ ...fields, approvalReference: '' })).toBeNull();
    expect(parseDeliveryPolicyInput(fields)).toEqual(fields);
    expect(parseDeliveryPolicyInput({ ...fields, shippingFee: 1000 })).toBeNull();
  });
  it('requires actual quick handoff evidence and preserves the KST date-time meaning', () => {
    expect(parseDeliveryEvidence('quick_handoff', { providerName: '실제 배송 업체', providerPhone: '010-1234-5678',
      handoffReference: '인계 기록 1', operatorName: '실제 인계 담당', occurredAt: '2026-09-10T18:30' }))
      .toMatchObject({ occurredAt: '2026-09-10T09:30:00.000Z', providerName: '실제 배송 업체' });
    expect(parseDeliveryEvidence('quick_handoff', { providerName: '업체', occurredAt: '2026-09-10T18:30' })).toBeNull();
    expect(parseDeliveryEvidence('pickup_receive', { operatorName: '담당', receiptReference: '확인 기록', recipientKind: 'self', occurredAt: '2026-09-10T18:30:12.345' }))
      .toMatchObject({ occurredAt: '2026-09-10T09:30:12.345Z' });
    expect(parseDeliveryEvidence('pickup_receive', { operatorName: '담당', receiptReference: '확인 기록', recipientKind: 'self', occurredAt: '2026-02-30T10:00' })).toBeNull();
  });
  it('requires a recipient kind and receipt record for both receipt methods', () => {
    const receipt = { operatorName: '인계 담당', receiptReference: '수령 확인 1', recipientKind: 'delegate', occurredAt: '2026-09-10T09:30:12.123456Z' };
    expect(parseDeliveryEvidence('pickup_receive', receipt)).toEqual(receipt);
    expect(parseDeliveryEvidence('quick_receive', { ...receipt, recipientKind: '' })).toBeNull();
    expect(parseDeliveryEvidence('pickup_receive', { ...receipt, receiptReference: '' })).toBeNull();
  });
  it('reads the forced delivery record (1014-083) in the method and handoff history and still refuses unknown kinds', () => {
    const shipment = { shipmentId: '00000000-0000-4000-8000-000000000001', orderId: '00000000-0000-4000-8000-000000000002', originId: '00000000-0000-4000-8000-000000000003',
      status: 'delivered', orderStatus: 'delivered', updatedAt: '2026-11-11T02:00:00.123456+00:00', shippingFee: 0, exportedAt: null, canSelect: false, canTransition: false,
      preorderReady: true, summary: shipmentDeliveryFixture(), policies: [],
      history: [{ id: '00000000-0000-4000-8000-000000000004', kind: 'forced_delivered', evidence: { reason: '시험 주문', occurredAt: '2026-11-11T02:00:00+00:00' }, actorName: '운영자', recordedAt: '2026-11-11T02:00:00.123456+00:00' }] };
    expect(parseAdminShipmentDelivery(shipment)?.history[0]).toMatchObject({ kind: 'forced_delivered', evidence: { reason: '시험 주문' } });
    expect(parseAdminShipmentDelivery({ ...shipment, history: [{ ...shipment.history[0], kind: 'forced_magic' }] })).toBeNull();
  });
  it('does not mislabel malformed non-parcel records as legacy parcels', () => {
    expect(parseShipmentDeliverySummary(null)).toBeNull();
    expect(parseShipmentDeliverySummary({ method: 'parcel' })).toEqual({ method: 'parcel', policy: null, providerName: null, canIssueReceipt: false });
    expect(parseShipmentDeliverySummary({ method: 'pickup', policy: null })).toBeNull();
    expect(deliveryStatusLabel('pickup', 'ready')).toBe('방문수령 준비');
    expect(deliveryStatusLabel('pickup', 'delivered')).toBe('방문수령 완료');
    expect(deliveryStatusLabel('quick', 'shipping')).toBe('퀵 배송 중');
  });
});
