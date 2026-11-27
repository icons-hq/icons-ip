import { describe, expect, it } from 'vitest';
import { shipmentArrivalError, shipmentArrivalNeedsReason, shipmentCompletionFailure, shipmentDispatchRevertBlock, shipmentRevertError, shipmentRevertKind, shipmentRevertPrompt } from './shipment-revert';

const NOW = new Date('2026-11-19T03:00:00Z');

describe('배송 상태 정정·택배사 도착 일시 (ADR-0045)', () => {
  it('택배 배송 건만 한 단계 되돌린다: 배송완료 → 배송중, 배송중 → 발송 대기', () => {
    expect(shipmentRevertKind('delivered', true)).toBe('delivery');
    expect(shipmentRevertKind('shipping', true)).toBe('dispatch');
    expect(shipmentRevertKind('ready', true)).toBeNull();
    expect(shipmentRevertKind('canceled', true)).toBeNull();
    expect(shipmentRevertKind('delivered', false)).toBeNull();
  });

  it('확인창은 되돌리는 결과와 회수할 수 없는 고객 안내를 함께 적는다', () => {
    const delivery = shipmentRevertPrompt('delivery', { reference: '2026111930000001', packCount: 2 });
    expect(delivery.title).toBe('배송완료 되돌리기');
    expect(delivery.message).toContain('배송 건 2026111930000001을 배송중으로 되돌립니다. 합포장 묶음 2건이 함께 되돌아갑니다.');
    expect(delivery.message).toContain('거래확정 기한이 지워지고');
    expect(delivery.message).toContain('이미 본 알림은 회수할 수 없으니');
    expect(delivery.message).toContain('운송장 없이 강제 배송완료한 배송 건은 발송된 적이 없어 발송 대기로');
    expect(delivery.message).toContain('거래확정 보류 중이면 보류를 먼저 해제한 뒤 되돌리고');
    const dispatch = shipmentRevertPrompt('dispatch', { reference: 'AB12CD34', trackingLabel: '한진택배 1000000012' });
    expect(dispatch.message).toContain('운송장 한진택배 1000000012와 추가 운송장·발송 시각을 비워');
    expect(dispatch.message).toContain("'출고지시 보냄' 표시는 그대로");
    /* 줄 안내(ShipmentStatusRevertPanel)와 같은 문장으로 메일을 말한다. */
    expect(dispatch.message).toContain('이미 보낸 배송 안내 메일은 회수되지 않습니다.');
    expect(dispatch.message).toContain('합포장 묶음이면 묶인 배송 건이 함께 되돌아갑니다.');
  });

  it('도착 일시: 처리 시각(null)은 통과, 미래는 10분까지만, 7일보다 이르면 사유가 필요하다', () => {
    expect(shipmentArrivalError(null, '', NOW)).toBeNull();
    expect(shipmentArrivalError('2026-11-19T03:09:00Z', '', NOW)).toBeNull();
    expect(shipmentArrivalError('2026-11-19T03:11:00Z', '', NOW)).toContain('지금보다 뒤일 수 없습니다');
    expect(shipmentArrivalError('2026-11-12T03:01:00Z', '', NOW)).toBeNull();
    expect(shipmentArrivalError('2026-11-12T02:59:00Z', '', NOW)).toContain('7일보다 이른 배송완료 일시는 늦게 처리한 사유가 필요합니다');
    expect(shipmentArrivalError('2026-11-12T02:59:00Z', '처리를 놓침', NOW)).toBeNull();
    expect(shipmentArrivalError('2026-11-12T02:59:00Z', '짧음', NOW)).toContain('5자 이상');
    expect(shipmentArrivalError('2026-11-18T00:00:00Z', '가'.repeat(501), NOW)).toContain('500자 이내');
    expect(shipmentArrivalError('not-a-date', '', NOW)).toContain('확인해주세요');
    // 리뷰 R3: 7일보다 이른 일시는 판매 관리 권한만(사유가 있어도 물류 계정은 막는다). 7일 이내는 누구나.
    expect(shipmentArrivalError('2026-10-20T00:00:00Z', '택배사확인', NOW, false)).toContain('판매 관리 권한이 있는 운영자만');
    expect(shipmentArrivalError('2026-11-13T00:00:00Z', '', NOW, false)).toBeNull();
    expect(shipmentArrivalError('2026-10-20T00:00:00Z', '택배사 조회로 확인', NOW, true)).toBeNull();
    expect(shipmentArrivalNeedsReason('2026-11-11T00:00:00Z', NOW)).toBe(true);
    expect(shipmentArrivalNeedsReason('2026-11-18T00:00:00Z', NOW)).toBe(false);
    expect(shipmentArrivalNeedsReason(null, NOW)).toBe(false);
  });

  /* 주문 상세가 발송 되돌리기 줄을 미리 잠그는 조건. 멈춘 작업(임대 시간이 지난 '처리 중')까지 잠그면 DB가 받아 줄 되돌리기를 화면이 막는다. */
  it('배송 안내 메일을 방금 보내기 시작한 배송 건만 발송 되돌리기를 미리 잠근다', () => {
    const now = new Date('2026-11-26T05:00:00Z');
    expect(shipmentDispatchRevertBlock({ status: 'processing', updatedAt: '2026-11-26T04:58:00Z' }, now)).toBe(shipmentRevertError('shipment_revert_email_sending'));
    expect(shipmentDispatchRevertBlock({ status: 'processing', updatedAt: '2026-11-26T04:40:00Z' }, now)).toBeNull();
    for (const status of ['pending', 'completed', 'review']) expect(shipmentDispatchRevertBlock({ status, updatedAt: '2026-11-26T04:59:00Z' }, now)).toBeNull();
    expect(shipmentDispatchRevertBlock({ status: 'processing', updatedAt: '모름' }, now)).toBeNull();
    expect(shipmentDispatchRevertBlock(undefined, now)).toBeNull();
  });

  it('DB 거절 코드를 운영 문구로 바꾸고, 배송완료 건별 실패는 도착 일시 외에는 기존 문구를 쓴다', () => {
    expect(shipmentRevertError('shipment_revert_purchase_confirmed')).toContain('거래확정된 주문');
    expect(shipmentRevertError('shipment_revert_claim_exists')).toContain('취소·반품·교환');
    expect(shipmentRevertError('shipment_revert_changed')).toContain('새로고침');
    expect(shipmentRevertError('shipment_revert_email_sending')).toContain('메일을 보내는 중');
    expect(shipmentRevertError('shipment_revert_confirmation_held')).toContain('보류를 먼저 해제한 뒤 되돌리고');
    expect(shipmentRevertError('unknown_code')).toContain('되돌리지 못했습니다');
    expect(shipmentCompletionFailure('delivered_at_before_shipped')).toContain('발송 등록 시각보다 이릅니다');
    expect(shipmentCompletionFailure('invalid_shipment_transition')).toBe('지금 상태에서는 처리할 수 없는 배송 건입니다. 신규주문이면 먼저 발주확인하고, 이미 발송·배송완료·취소된 건인지 목록을 새로고침해 확인해주세요.');
  });
});
