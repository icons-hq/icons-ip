import type { PreorderScheduleChange, PreorderSchedulePreview, PreorderScheduleTarget } from './preorder-schedule-change';

/** 시험용 합성 값. 고객 이메일·이름·연락처가 없는 서버 응답 모양 그대로다. */
export const scheduleIds = {
  order1: '50000000-0000-4000-8000-000000000001', order2: '50000000-0000-4000-8000-000000000002', order3: '50000000-0000-4000-8000-000000000003',
  shipment1: '51000000-0000-4000-8000-000000000001', shipment2: '51000000-0000-4000-8000-000000000002', shipment3: '51000000-0000-4000-8000-000000000003',
  shipment4: '51000000-0000-4000-8000-000000000004', variant: '52000000-0000-4000-8000-000000000001', change: '53000000-0000-4000-8000-000000000001',
  notice: '54000000-0000-4000-8000-000000000001', target1: '55000000-0000-4000-8000-000000000001', target2: '55000000-0000-4000-8000-000000000002',
  target3: '55000000-0000-4000-8000-000000000003',
} as const;

export function scheduleTarget(overrides: Partial<PreorderScheduleTarget> = {}): PreorderScheduleTarget {
  return {
    shipmentId: scheduleIds.shipment1, orderId: scheduleIds.order1, orderNumber: '2026111210000001', shipmentLabel: '2026111230000001',
    originName: '김포', orderStatus: 'paid', paymentMethod: 'card', currentDate: '2026-12-02', originalDate: '2026-12-02', newDate: '2026-12-09',
    individuallyChanged: false, otherPreorder: false, version: 1762912800000000, ...overrides,
  };
}

export function schedulePreview(overrides: Partial<PreorderSchedulePreview> = {}): PreorderSchedulePreview {
  const targets = overrides.targets ?? [
    scheduleTarget(),
    scheduleTarget({ shipmentId: scheduleIds.shipment2, orderId: scheduleIds.order2, orderNumber: '2026111210000002', shipmentLabel: '2026111230000002', currentDate: '2026-12-05', individuallyChanged: true }),
    scheduleTarget({ shipmentId: scheduleIds.shipment3, orderId: scheduleIds.order3, orderNumber: '2026111210000003', shipmentLabel: '2026111230000003', orderStatus: 'pending', paymentMethod: 'bank_transfer' }),
  ];
  return {
    goodId: 'hsq-second', goodName: '홍실 2차 랜덤 포토카드', randomSale: false, variantId: null, variantName: null, expectedShipDate: '2026-12-09',
    fingerprint: '0123456789abcdef0123456789abcdef', targets,
    excluded: [{ shipmentId: scheduleIds.shipment4, orderId: scheduleIds.order1, orderNumber: '2026111210000004', shipmentLabel: '2026111230000004', originName: '김포', orderStatus: 'confirmed', currentDate: '2026-12-02', reason: 'exported' }],
    excludedCounts: { exported: 1 }, excludedTotal: 1, targetShipments: targets.length, targetOrders: new Set(targets.map((target) => target.orderId)).size,
    acceptingPolicies: [{ variantId: scheduleIds.variant, variantName: '기본 옵션', expectedShipDate: '2026-12-02', startsAt: '2026-11-10T00:00:00.000Z', endsAt: '2026-11-30T15:00:00.000Z' }],
    emailEnabled: true, smsEnabled: false, limit: 2000, ...overrides,
  };
}

export function scheduleChange(overrides: Partial<PreorderScheduleChange> = {}): PreorderScheduleChange {
  return {
    id: scheduleIds.change, goodId: 'hsq-second', goodName: '홍실 2차 랜덤 포토카드', variantId: null, variantName: null, expectedShipDate: '2026-12-09',
    reason: '공급처 입고 일정 변경', title: '예약 주문 발송 일정 변경 안내', customerBody: '발송 예정일이 바뀌었습니다.', actorName: '운영자',
    createdAt: '2026-11-25T01:00:00.000Z', noticeId: scheduleIds.notice, requestedAt: '2026-11-25T01:00:00.000Z', emailEnabled: true, smsQueued: false,
    shipmentCount: 2, orderCount: 2, excludedCount: 1,
    targets: [
      { id: scheduleIds.target1, orderId: scheduleIds.order1, orderNumber: '2026111210000001', audience: 'payer', hasEmail: true,
        shipments: [{ shipmentId: scheduleIds.shipment1, label: '2026111230000001', originName: '김포', fromDate: '2026-12-02', toDate: '2026-12-09' }],
        inAppStatus: 'sent', emailStatus: 'queued', emailProviderState: null, errorCode: null, retryable: false, smsStatus: null, smsReason: null },
      { id: scheduleIds.target2, orderId: scheduleIds.order2, orderNumber: '2026111210000002', audience: 'payer', hasEmail: false,
        shipments: [{ shipmentId: scheduleIds.shipment2, label: '2026111230000002', originName: '김포', fromDate: '2026-12-05', toDate: '2026-12-09' }],
        inAppStatus: 'sent', emailStatus: 'suppressed', emailProviderState: null, errorCode: 'recipient_missing', retryable: false, smsStatus: null, smsReason: null },
      { id: scheduleIds.target3, orderId: scheduleIds.order2, orderNumber: '2026111210000002', audience: 'recipient', hasEmail: true,
        shipments: [{ shipmentId: scheduleIds.shipment2, label: '2026111230000002', originName: '김포', fromDate: '2026-12-05', toDate: '2026-12-09' }],
        inAppStatus: 'sent', emailStatus: 'failed', emailProviderState: null, errorCode: 'provider_retryable', retryable: true, smsStatus: null, smsReason: null },
    ],
    ...overrides,
  };
}
