import { describe, expect, it } from 'vitest';
import {
  ORDER_PARTIAL_CANCELLATION_STATE_LABELS,
  orderPartialCancellationBlockerMessage,
  orderPartialCancellationErrorMessage,
  orderPartialCancellationItemBlockerLabel,
  orderPartialCancellationPanelVisible,
  orderPartialCancellationReconcileMessage,
} from './order-partial-cancellation';
import { ORDER_PARTIAL_CANCELLATION_STATES } from '@/lib/orders/partial-cancellation';

describe('부분 취소 패널 노출', () => {
  it.each([
    ['스위치 OFF·기록 없음', { enabled: false, blockers: ['partial_cancel_disabled'], history: [] }, false],
    ['스위치 OFF·기록 있음(켰다 끈 뒤)', { enabled: false, blockers: ['partial_cancel_disabled'], history: [{}] }, true],
    ['켜짐·발송 전', { enabled: true, blockers: [], history: [] }, true],
    ['켜짐·이미 발송', { enabled: true, blockers: ['shipment_already_dispatched'], history: [] }, false],
    ['켜짐·취소된 주문', { enabled: true, blockers: ['order_not_partial_cancelable'], history: [] }, false],
    ['켜짐·부분 취소 불가 결제', { enabled: true, blockers: ['partial_cancel_unsupported'], history: [] }, true],
    ['켜짐·발송 전이지만 진행 중 클레임', { enabled: true, blockers: ['order_claim_in_progress'], history: [] }, true],
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
    expect(orderPartialCancellationBlockerMessage('gift_order')).toContain('선물 주문');
    expect(orderPartialCancellationItemBlockerLabel(null)).toBeNull();
    expect(orderPartialCancellationItemBlockerLabel('stock_topology_changed')).toBe('상품 통합·교환 이력 있음');
  });

  it('결제사 확인 결과: 진행하지 않음은 돈·재고가 그대로라고 말하고, 확인 필요는 출고가 막혀 있다고 말한다', () => {
    expect(orderPartialCancellationReconcileMessage('partial_cancel_rejected')).toContain('돈은 움직이지 않았고');
    expect(orderPartialCancellationReconcileMessage('provider_unavailable')).toContain('출고되지 않습니다');
    expect(orderPartialCancellationReconcileMessage('provider_identity_mismatch')).toContain('provider_identity_mismatch');
  });
});
