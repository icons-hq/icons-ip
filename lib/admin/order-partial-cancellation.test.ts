import { describe, expect, it } from 'vitest';
import {
  ORDER_PARTIAL_CANCELLATION_STATE_LABELS,
  STAFF_CANCELLATION_PARTIALLY_DISPATCHED_GUIDE,
  orderHasUnsentShipmentAfterDispatch,
  orderPartialCancellationBlockerMessage,
  orderPartialCancellationConfirmCopy,
  orderPartialCancellationErrorMessage,
  orderPartialCancellationItemBlockerLabel,
  orderPartialCancellationPanelVisible,
  orderPartialCancellationReconcileMessage,
  orderPartialCancellationResolutionMessage,
  orderPartialCancellationV1AllocationIssueMessage,
} from './order-partial-cancellation';
import { ORDER_PARTIAL_CANCELLATION_STATES } from '@/lib/orders/partial-cancellation';

describe('부분 취소 패널 노출', () => {
  it.each([
    ['스위치 OFF·기록 없음', { enabled: false, canManage: true, blockers: ['partial_cancel_disabled'], history: [] }, false],
    ['스위치 OFF·기록 있음(켰다 끈 뒤)', { enabled: false, canManage: true, blockers: ['partial_cancel_disabled'], history: [{}] }, true],
    ['켜짐·발송 전', { enabled: true, canManage: true, blockers: [], history: [] }, true],
    ['켜짐·이미 발송', { enabled: true, canManage: true, blockers: ['shipment_already_dispatched'], history: [] }, false],
    ['켜짐·취소된 주문', { enabled: true, canManage: true, blockers: ['order_not_partial_cancelable'], history: [] }, false],
    ['켜짐·부분 취소 불가 결제', { enabled: true, canManage: true, blockers: ['partial_cancel_unsupported'], history: [] }, true],
    ['켜짐·배분을 확정할 수 없는 버전 1 주문', { enabled: true, canManage: true, blockers: ['partial_cancel_v1_allocation_mismatch'], history: [] }, true],
    ['켜짐·발송 전이지만 진행 중 클레임', { enabled: true, canManage: true, blockers: ['order_claim_in_progress'], history: [] }, true],
    ['조회 권한만·기록 없음', { enabled: true, canManage: false, blockers: [], history: [] }, false],
    ['조회 권한만·기록 있음', { enabled: true, canManage: false, blockers: [], history: [{}] }, true],
  ])('%s', (_label, context, expected) => {
    expect(orderPartialCancellationPanelVisible(context)).toBe(expected);
  });
});

describe('부분 취소 운영 문구', () => {
  it('주문 상태 이름은 어드민 말(신규주문·거래확정)로 말한다 — 결제완료·구매확정이 아니다', () => {
    const message = orderPartialCancellationBlockerMessage('order_not_partial_cancelable');
    expect(message).toContain('신규주문·발주확인·배송중(일부 발송)');
    expect(message).toContain('배송완료·거래확정 주문은 반품으로');
    expect(message).not.toMatch(/결제완료|구매확정/);
  });

  it('고를 수 없는 이유는 운영자 말이고 내부 말(금액 배분·품목)을 쓰지 않는다', () => {
    expect(orderPartialCancellationItemBlockerLabel('allocation_missing')).toBe('주문 당시 금액 기록 없음');
    expect(orderPartialCancellationItemBlockerLabel('order_item_not_found')).toBe('이 주문의 상품이 아님');
    expect(orderPartialCancellationBlockerMessage('legacy_order')).not.toMatch(/배분|품목/);
    expect(orderPartialCancellationBlockerMessage('partial_cancel_v1_allocation_mismatch')).not.toContain('대조');
  });

  it('고객이 정한 내용·권한·합포장 거절은 화면에 적힌 이름으로 다음 할 일을 말한다', () => {
    expect(orderPartialCancellationErrorMessage('partial_cancel_customer_decision_required')).toContain('고객이 정한 내용');
    expect(orderPartialCancellationErrorMessage('partial_cancel_shipment_packed')).toContain('[합포장 관리]');
    expect(orderPartialCancellationErrorMessage('operator_capability_required')).toContain('이 작업을 할 권한이 없습니다');
    expect(orderPartialCancellationErrorMessage('partial_cancel_operation_conflict')).not.toContain('요청 번호');
    expect(orderPartialCancellationErrorMessage('unknown_internal_code')).toContain('새로고침');
    expect(orderPartialCancellationBlockerMessage('partial_cancel_disabled')).toContain('운영 스위치');
  });

  it('송금 담당 권한 거절 문구는 그대로다(서버 액션 시험이 같은 글을 본다)', () => {
    expect(orderPartialCancellationErrorMessage('bank_refund_permission_required'))
      .toBe('송금 담당 권한이 필요합니다. 송금 권한이 있는 관리자 계정으로 로그인했는지 확인해주세요.');
  });

  it('모든 상태에 라벨이 있다', () => {
    expect(Object.keys(ORDER_PARTIAL_CANCELLATION_STATE_LABELS).sort()).toEqual([...ORDER_PARTIAL_CANCELLATION_STATES].sort());
  });

  it('DB 거절 코드를 운영 문구로 옮기고 원문 코드는 노출하지 않는다', () => {
    expect(orderPartialCancellationErrorMessage('warehouse_stop_confirmation_required')).toContain('출고 중단');
    expect(orderPartialCancellationErrorMessage('warehouse_stop_reply_required')).toContain('창고 회신 기록');
    expect(orderPartialCancellationErrorMessage('warehouse_already_shipped')).toContain('반품');
    expect(orderPartialCancellationErrorMessage('warehouse_stop_reply_used')).toContain('다른 취소');
    expect(orderPartialCancellationErrorMessage('partial_cancel_leaves_nothing')).toContain('운영자 전액 취소');
    expect(orderPartialCancellationErrorMessage('partial_cancel_unsupported')).toContain('전액 환불로 돌리지 않습니다');
    expect(orderPartialCancellationErrorMessage('partial_cancel_item_preorder_item')).toContain('예약 판매 상품');
    expect(orderPartialCancellationErrorMessage('unknown_internal_code')).not.toContain('unknown_internal_code');
    expect(orderPartialCancellationErrorMessage('partial_cancel_shipment_packed')).toContain('합포장을 해제');
    expect(orderPartialCancellationErrorMessage('partial_cancel_exceeds_balance')).toContain('남은 결제 금액');
    expect(orderPartialCancellationErrorMessage('partial_cancel_resolution_reason_required')).toContain('해소 사유');
    // 선물 주문은 막지 않는다(환불은 결제한 분에게) — 막힘 문구가 따로 없다.
    expect(orderPartialCancellationBlockerMessage('gift_order')).not.toContain('선물');
    expect(orderPartialCancellationItemBlockerLabel(null)).toBeNull();
    expect(orderPartialCancellationItemBlockerLabel('stock_topology_changed')).toBe('상품 통합·교환 재출고 이력 있음');
  });

  it('버전 1 주문: 배분을 확정할 수 없는 이유를 운영 문구로 옮긴다(원문 코드는 노출하지 않는다)', () => {
    expect(orderPartialCancellationErrorMessage('partial_cancel_v1_allocation_mismatch')).toContain('상품별 환불액을 확정할 수 없습니다');
    expect(orderPartialCancellationErrorMessage('partial_cancel_v1_allocation_unavailable')).toContain('운영자 전액 취소');
    expect(orderPartialCancellationBlockerMessage('partial_cancel_v1_allocation_mismatch')).not.toContain('partial_cancel');
    for (const code of ['amount_mismatch', 'shipping_snapshot_mismatch', 'coupon_amount_mismatch', 'coupon_target_mismatch', 'credit_mismatch',
      'coupon_unrecorded', 'unsupported_discount', 'items_missing']) {
      expect(orderPartialCancellationV1AllocationIssueMessage(code)).toMatch(/[가-힣]/);
    }
    expect(orderPartialCancellationV1AllocationIssueMessage('anything_else')).toBeNull();
    expect(orderPartialCancellationV1AllocationIssueMessage(null)).toBeNull();
  });

  it('결제사 확인 결과: 진행하지 않음은 돈·재고가 그대로라고 말하고, 확인 필요는 출고가 막혀 있다고 말한다', () => {
    expect(orderPartialCancellationReconcileMessage('partial_cancel_rejected')).toContain('돈은 움직이지 않았고');
    expect(orderPartialCancellationReconcileMessage('provider_unavailable')).toContain('출고되지 않습니다');
    expect(orderPartialCancellationReconcileMessage('provider_identity_mismatch')).toContain('provider_identity_mismatch');
  });

  it('모르는 결제사 확인 코드는 다음 할 일을 먼저 말하고 코드는 결제 담당자에게 알려 줄 값으로만 넣는다', () => {
    const message = orderPartialCancellationReconcileMessage('provider_identity_mismatch');
    expect(message.indexOf('[결제사 확인 다시 하기]')).toBeLessThan(message.indexOf('provider_identity_mismatch'));
    expect(message).toContain('결제 담당자에게 코드(provider_identity_mismatch)를 알려 주세요');
  });

  it('결제확인필요 해소를 하지 않은 이유는 아무것도 바꾸지 않았다고 말한다', () => {
    expect(orderPartialCancellationResolutionMessage('balance_unexplained')).toContain('해소하지 않았습니다');
    expect(orderPartialCancellationResolutionMessage('provider_unavailable')).toContain('조회하지 못했습니다');
    expect(orderPartialCancellationResolutionMessage('anything_else')).not.toContain('anything_else');
  });
});

/* 확인창은 되돌릴 수 없는 처리 앞이다. 제목은 환불액을 말하고, 결제 방식마다 확정하면 무엇이 일어나는지를 말한다. */
describe('부분 취소 확인창 문구', () => {
  it('토스 결제: 이 금액만 결제사에서 부분 취소하고, 결제사가 받지 않으면 아무것도 바꾸지 않으며, 구매자에게 알림이 간다', () => {
    const copy = orderPartialCancellationConfirmCopy({ provider: 'toss', refundAmount: 9_500 });
    expect(copy.title).toBe('이 상품만 취소하고 9,500원을 환불할까요?');
    expect(copy.description).toContain('되돌릴 수 없습니다.');
    expect(copy.description).toContain('결제사(토스)에서 이 금액만 부분 취소하고, 결제사 확인 뒤 재고를 되돌리고 배송 건에서 뺍니다.');
    expect(copy.description).toContain('결제사가 부분 취소를 받지 않는 결제면 아무것도 바꾸지 않습니다.');
    expect(copy.description).toContain('구매자에게 알림이 갑니다.');
    expect(copy.confirmLabel).toBe('부분 취소 확정');
  });

  it('무통장 결제: 바로 재고를 되돌리고 환불은 송금 대기로 남는다', () => {
    const copy = orderPartialCancellationConfirmCopy({ provider: 'bank_transfer', refundAmount: 12_500 });
    expect(copy.title).toContain('12,500원을 환불할까요?');
    expect(copy.description).toContain('환불은 송금 대기로 남습니다.');
    expect(copy.description).not.toContain('결제사(토스)');
    expect(copy.confirmLabel).toBe('부분 취소 확정 (송금 대기)');
  });

  it('환불 0원(전액 할인 상품): 결제사를 부르지 않고 바로 적용하며 제목에도 0원을 적는다', () => {
    for (const provider of ['toss', 'bank_transfer'] as const) {
      const copy = orderPartialCancellationConfirmCopy({ provider, refundAmount: 0 });
      expect(copy.title).toBe('이 상품만 취소할까요? (환불 0원)');
      expect(copy.description).toContain('결제사에 취소를 요청하지 않고, 바로 재고를 되돌리고 배송 건에서 뺍니다.');
      expect(copy.confirmLabel).toBe('부분 취소 확정 (환불 0원)');
    }
  });
});

/* 혼합 출고지 일부 발송(원장 #15): 발송 전 배송 건 몫은 부분 취소, 발송된 몫은 반품으로 안내한다. */
describe('일부 발송 주문', () => {
  it('발송된 배송 건 품목과 모두 발송된 주문의 막힘을 운영 문구로 옮긴다', () => {
    expect(orderPartialCancellationItemBlockerLabel('shipment_dispatched')).toBe('이미 발송된 배송 건(반품으로 처리)');
    expect(orderPartialCancellationErrorMessage('partial_cancel_item_shipment_dispatched')).toBe('고를 수 없는 상품이 있습니다(이미 발송된 배송 건(반품으로 처리)). 새로고침해주세요.');
    expect(orderPartialCancellationBlockerMessage('shipment_already_dispatched')).toBe('모든 배송 건이 이미 발송돼 부분 취소할 몫이 없습니다. 발송된 상품은 반품으로 처리해주세요.');
    expect(orderPartialCancellationBlockerMessage('order_not_partial_cancelable')).toContain('배송중(일부 발송)');
  });
  it('배송중이고 품목이 남은 발송 전 배송 건이 있을 때만 전액 취소 대신 안내한다', () => {
    const ready = { status: 'ready', orderItemIds: ['i1'] }, shipped = { status: 'shipping', orderItemIds: ['i2'] };
    expect(orderHasUnsentShipmentAfterDispatch({ status: 'shipping', shipments: [shipped, ready] })).toBe(true);
    expect(orderHasUnsentShipmentAfterDispatch({ status: 'shipping', shipments: [shipped, { status: 'ready', orderItemIds: [] }] })).toBe(false);
    expect(orderHasUnsentShipmentAfterDispatch({ status: 'shipping', shipments: [shipped, { status: 'canceled', orderItemIds: [] }] })).toBe(false);
    expect(orderHasUnsentShipmentAfterDispatch({ status: 'confirmed', shipments: [ready] })).toBe(false);
    expect(STAFF_CANCELLATION_PARTIALLY_DISPATCHED_GUIDE).toContain('재고 부족 부분 취소(설정이 켜져 있을 때)');
  });
});
