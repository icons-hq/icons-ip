import { describe, expect, it } from 'vitest';
import { FORCED_DELIVERY_BLOCKERS, forcedDeliveryBlockerLabel, forcedDeliveryConfirmMessage, forcedDeliveryError, forcedDeliveryExportedPending, forcedDeliveryHref, forcedDeliveryTargets, normalizeForcedDeliveryOrderNumber, parseForcedDeliveryPreview, parseForcedDeliveryReceipt, type ForcedDeliveryPreview } from './forced-delivery';

describe('운영 강제 배송완료 값 (1014-083)', () => {
  it('주문번호는 공백·하이픈을 빼고 주문번호 형식(주문번호 모듈 판정)일 때만 받는다', () => {
    expect(normalizeForcedDeliveryOrderNumber(' 2026-1111-1000-0001 ')).toBe('2026111110000001');
    expect(normalizeForcedDeliveryOrderNumber('2026111130000001')).toBeNull();
    expect(normalizeForcedDeliveryOrderNumber(20261111)).toBeNull();
  });
  it('영수증은 정해진 여섯 값만 받고 처리 건수가 0이면 거절한다', () => {
    const receipt = { orderId: 'f0dd0000-0000-4001-8000-000000000001', orderNumber: '2026111110000001', status: 'delivered', deliveredShipments: 1, orderCount: 1, deliveredAt: '2026-11-11T02:00:00Z' };
    expect(parseForcedDeliveryReceipt(receipt)).toEqual(receipt);
    expect(parseForcedDeliveryReceipt({ ...receipt, deliveredShipments: 0 })).toBeNull();
    expect(parseForcedDeliveryReceipt({ ...receipt, staging: true })).toBeNull();
  });
  it('미리보기는 출고지시 전달 여부를 받고, 디지털 파일은 이번 대상에서 빼며 전달된 발송 전 건을 따로 센다', () => {
    const base = { orderId: 'f0dd0000-0000-4001-8000-000000000001', orderNumber: '2026111110000001', status: 'confirmed', createdAt: '2026-11-11T00:00:00Z', buyerName: '구매자',
      itemCount: 2, firstItemName: '굿즈', orderCount: 1, blockers: [] };
    const shipment = { id: 'f0dd0000-0000-4002-8000-000000000001', shipmentNumber: null, orderNumber: '2026111110000001', originName: '김포', status: 'ready', method: 'parcel', carrier: null, trackingNumber: null, exportedAt: '2026-11-11T01:00:00Z' };
    const preview = parseForcedDeliveryPreview({ ...base, shipments: [shipment, { ...shipment, id: 'f0dd0000-0000-4002-8000-000000000002', method: 'digital', exportedAt: null }, { ...shipment, id: 'f0dd0000-0000-4002-8000-000000000003', method: 'quick', exportedAt: null }] })!;
    expect(forcedDeliveryTargets(preview).map(row => row.method)).toEqual(['parcel', 'quick']);
    expect(forcedDeliveryExportedPending(preview).map(row => row.id)).toEqual([shipment.id]);
    expect(parseForcedDeliveryPreview({ ...base, shipments: [{ ...shipment, exportedAt: 'yesterday' }] })).toBeNull();
    expect(parseForcedDeliveryPreview({ ...base, shipments: [], blockers: ['parcel_only'] })).toBeNull();
  });
  it('막는 사유와 DB 거절은 모두 운영자 문구가 있다', () => {
    for (const blocker of FORCED_DELIVERY_BLOCKERS) expect(forcedDeliveryBlockerLabel(blocker).length).toBeGreaterThan(10);
    expect(forcedDeliveryError('P0002', 'forced_delivery_order_not_found')).toBe('선택한 주문을 찾지 못했습니다. 주문을 다시 골라주세요.');
    expect(forcedDeliveryError('22023', 'invalid_forced_delivery')).toBe('주문을 다시 골라주세요.');
    expect(forcedDeliveryError('PT409', 'shipment_pack_changed')).toContain('[강제 배송완료]를 다시 눌러');
    /* 화면에 없는 '요청 번호'·'(예외)' 같은 안쪽 말은 쓰지 않는다. */
    for (const message of [...FORCED_DELIVERY_BLOCKERS.map(forcedDeliveryBlockerLabel), forcedDeliveryError('23505', 'operation_conflict'), forcedDeliveryError(undefined, 'shipment_pack_changed')]) expect(message).not.toMatch(/요청 번호|\(예외\)/);
    expect(forcedDeliveryError('42501')).toBe('판매 관리 권한이 없거나 로그인이 끝났습니다. 로그인한 계정을 확인하고, 권한이 없으면 계정 주매니저에게 요청해주세요.');
    expect(forcedDeliveryError(undefined, 'order cancellation in progress')).toContain('취소·반품·교환 관리');
    /* QA1 S-T04-05: 이미 배송완료·취소된 주문은 '먼저 발주확인'이 아니라 처리할 배송 건이 없다고 알린다. */
    expect(forcedDeliveryError('23514', 'forced_delivery_nothing_to_deliver')).toContain('이미 배송완료됐거나 취소된 주문');
    expect(forcedDeliveryBlockerLabel('nothing_to_deliver')).not.toContain('발주확인');
    /* 출고 보류: 아직 나가지 않은 배송 건이 있는 보류 주문만 막는다(미리보기 막는 사유·실행 거절 모두). */
    expect(forcedDeliveryError('23514', 'order fulfillment hold')).toBe(forcedDeliveryBlockerLabel('fulfillment_hold'));
    expect(forcedDeliveryBlockerLabel('fulfillment_hold')).toContain('출고 보류');
  });
  it('주문 상세에서 강제 배송완료 카드를 그 주문번호로 여는 주소', () => {
    expect(forcedDeliveryHref('20261112140010000034')).toBe('/admin/sales/dispatch?forceDelivery=20261112140010000034#forced-delivery');
  });
  /* 확인창 글(S-14·S-15): 주문번호·구매자·상품·지금 상태·배송 건을 먼저 말하고, 실행하면 무엇이 시작되는지를 말한다. 확인 체크는 없다. */
  describe('확인창 글', () => {
    const orderNumber = '2026111110000001', other = '2026111110000002';
    const shipment = (id: number, method: ForcedDeliveryPreview['shipments'][number]['method'], extra: Partial<ForcedDeliveryPreview['shipments'][number]> = {}) => ({
      id: `f0dd0000-0000-4002-8000-00000000000${id}`, shipmentNumber: null, orderNumber, originName: '김포', status: 'ready' as const, method, carrier: null, trackingNumber: null, exportedAt: null, ...extra });
    const preview = (shipments: ForcedDeliveryPreview['shipments'], extra: Partial<ForcedDeliveryPreview> = {}): ForcedDeliveryPreview => ({ orderId: 'f0dd0000-0000-4001-8000-000000000001', orderNumber, status: 'confirmed',
      createdAt: '2026-11-11T00:00:00Z', buyerName: '시험 구매자', itemCount: 1, firstItemName: '시험 상품', orderCount: 1, shipments, blockers: [], ...extra });

    it('주문번호·구매자·상품·주문 상태·배송 건을 한 줄씩 말하고 결과 세 줄을 붙인다', () => {
      const message = forcedDeliveryConfirmMessage(preview([shipment(1, 'parcel'), shipment(2, 'parcel', { status: 'shipping' }), shipment(3, 'quick')]), '발주확인');
      expect(message.split('\n').slice(0, 5)).toEqual([`주문번호: ${orderNumber}`, '구매자: 시험 구매자', '상품: 시험 상품', '주문 상태: 발주확인', '배송 건: 택배 발송 대기 1건, 택배 배송중 1건, 퀵 발송 대기 1건']);
      const results = message.split('\n').filter(line => line.startsWith('· '));
      expect(results).toEqual([
        '· 주문이 배송완료가 되고, 고객에게 앱 알림 "배송이 완료됐어요"가 갑니다. 배송 메일은 보내지 않습니다.',
        '· 배송완료 시각부터 반품 기한과 거래확정 기한을 셉니다.',
        '· 되돌리려면 주문 상세의 [배송완료 되돌리기]를 씁니다(택배 배송 건만). 이미 간 앱 알림은 회수할 수 없습니다.',
      ]);
      for (const absent of ['합포장', '출고지시를 이미 전달', '디지털 파일']) expect(message).not.toContain(absent);
    });

    it('합포장 동반 주문·출고지시를 넘긴 배송 건·디지털 파일 배송 건은 있을 때만 덧붙인다', () => {
      const message = forcedDeliveryConfirmMessage(preview([shipment(1, 'parcel', { exportedAt: '2026-11-11T01:00:00Z' }), shipment(2, 'direct', { orderNumber: other }), shipment(3, 'digital')],
        { orderCount: 2, itemCount: 3 }), '배송중');
      expect(message).toContain('상품: 시험 상품 외 2건'); expect(message).toContain('배송 건: 택배 발송 대기 1건, 직접배송 발송 대기 1건');
      expect(message).toContain(`합포장으로 묶인 주문 2개가 함께 배송완료됩니다(다른 주문: ${other}).`);
      expect(message).toContain('출고지시를 이미 보낸 배송 건 1건이 있습니다. 창고 출고는 멈추지 않으니');
      expect(message).toContain('디지털 파일 배송 건 1건은 구매자가 내려받을 때 완료되므로 뺍니다');
      expect(message).not.toContain('"배송이 완료됐어요"가 갑니다'); expect(message).toContain('"배송이 시작됐어요" 앱 알림이 갈 수 있습니다');
    });

    it('상품 기록이 없으면 그렇게 말하고, 어떤 경우에도 확인 체크를 시키는 말이 없다', () => {
      const message = forcedDeliveryConfirmMessage(preview([shipment(1, 'parcel')], { firstItemName: null, itemCount: 0 }), '발주확인');
      expect(message).toContain('상품: 상품 기록 없음');
      expect(message).not.toMatch(/확인했습니다|체크/);
    });
  });
});
