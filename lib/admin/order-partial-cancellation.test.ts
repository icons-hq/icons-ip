import { describe, expect, it } from 'vitest';
import {
  ORDER_PARTIAL_CANCELLATION_STATE_LABELS,
  orderPartialCancellationBlockerMessage,
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
  it('모든 상태에 라벨이 있다', () => {
    expect(Object.keys(ORDER_PARTIAL_CANCELLATION_STATE_LABELS).sort()).toEqual([...ORDER_PARTIAL_CANCELLATION_STATES].sort());
  });

  it('DB 거절 코드를 운영 문구로 옮기고 원문 코드는 노출하지 않는다', () => {
    expect(orderPartialCancellationErrorMessage('warehouse_stop_confirmation_required')).toContain('출고 중단');
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

  it('결제확인필요 해소를 하지 않은 이유는 아무것도 바꾸지 않았다고 말한다', () => {
    expect(orderPartialCancellationResolutionMessage('balance_unexplained')).toContain('해소하지 않았습니다');
    expect(orderPartialCancellationResolutionMessage('provider_unavailable')).toContain('조회하지 못했습니다');
    expect(orderPartialCancellationResolutionMessage('anything_else')).not.toContain('anything_else');
  });
});
