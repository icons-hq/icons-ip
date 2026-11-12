/**
 * 재고 부족 부분 취소(ADR-0032)의 운영 화면 문구. DB 판정 코드를 운영팀 어휘(상품·옵션)로 옮긴다. 원문 코드는 노출하지 않는다.
 */
import type { OrderPartialCancellationState } from '@/lib/orders/partial-cancellation';

export const ORDER_PARTIAL_CANCELLATION_STATE_LABELS: Record<OrderPartialCancellationState, string> = {
  processing: '결제사 확인 중',
  needs_review: '결제확인필요',
  rejected: '진행하지 않음',
  completed: '완료',
  awaiting_transfer: '송금 대기',
};

/** 주문 단위로 부분 취소를 열 수 없는 이유. */
const ORDER_BLOCKERS: Record<string, string> = {
  partial_cancel_disabled: '재고 부족 부분 취소 설정이 꺼져 있습니다.',
  order_not_found: '주문을 찾을 수 없습니다.',
  order_not_partial_cancelable: '결제완료·발주확인 상태의 발송 전 주문만 부분 취소할 수 있습니다.',
  shipment_already_dispatched: '이미 발송된 배송 건이 있어 부분 취소할 수 없습니다. 배송 완료 뒤 반품으로 처리해주세요.',
  order_claim_in_progress: '진행 중인 취소·반품·교환 요청이 있습니다. 그 요청을 먼저 처리해주세요.',
  partial_cancel_in_progress: '결제사 확인을 기다리는 부분 취소가 있습니다. 아래 기록에서 결과를 먼저 확인해주세요.',
  payment_reconciliation_required: '결제 결과가 아직 확정되지 않았습니다. 결제 상태를 먼저 확인해주세요.',
  payment_unavailable: '결제 기록이 한 건의 결제완료가 아니라 부분 취소할 수 없습니다.',
  partial_cancel_unsupported: '이 결제는 결제사 부분 취소를 받지 않아 품목 부분 취소를 진행할 수 없습니다(나이스페이·코페이·토스 가상계좌·정기배송). 전액 환불로 돌리지 않습니다. 고객과 다시 상의해 운영자 전액 취소 여부를 정해주세요.',
  gift_order: '선물 주문은 결제한 분과 받는 분이 달라 부분 취소하지 않습니다. 운영자 전액 취소를 검토해주세요.',
  legacy_order: '금액 배분 기록이 없는 이전 주문이라 품목별 환불액을 정할 수 없습니다.',
};

/** 품목 단위로 고를 수 없는 이유(문맥 items[].blocker). */
const ITEM_BLOCKERS: Record<string, string> = {
  fully_canceled: '이미 모두 취소됨',
  preorder_item: '예약 판매 상품',
  production_item: '주문제작 상품',
  digital_item: '디지털·배송없음 상품',
  allocation_missing: '금액 배분 기록 없음',
  shipment_missing: '배송 건 확인 필요',
  stock_topology_changed: '상품 통합·교환 이력 있음',
  order_item_not_found: '품목 없음',
};

/** 시작·미리보기·송금 기록 RPC 거절 코드. */
const START_ERRORS: Record<string, string> = {
  warehouse_stop_confirmation_required: '출고지시가 나간 배송 건의 상품입니다. 창고에서 그 상품·수량의 출고 중단을 확인한 뒤 확인란을 체크해주세요.',
  partial_cancel_amount_changed: '확인창을 연 뒤 금액이 바뀌었습니다. 내용을 다시 확인해주세요.',
  partial_cancel_customer_decision_required: '고객 결정 기록을 2자 이상 입력해주세요(최대 500자).',
  invalid_partial_cancel_note: '메모는 500자 이내로 입력해주세요.',
  partial_cancel_refund_account_required: '무통장 주문은 환불받을 계좌(은행·계좌번호·예금주)를 모두 입력해주세요.',
  partial_cancel_refund_account_not_allowed: '카드 결제 주문에는 환불계좌를 받지 않습니다.',
  partial_cancel_leaves_nothing: '남는 상품이 없습니다. 주문 전체를 취소하려면 운영자 전액 취소를 쓰세요.',
  partial_cancel_remaining_balance_zero: '부분 취소 뒤 남는 결제 금액이 없습니다. 운영자 전액 취소를 쓰세요.',
  partial_cancel_refund_zero: '고른 상품의 환불액이 0원입니다(전액 할인). 부분 취소로 처리할 수 없습니다.',
  partial_cancel_qty_exceeds_remaining: '남은 수량보다 많이 고를 수 없습니다.',
  partial_cancel_item_not_found: '이 주문의 상품이 아닙니다. 새로고침해주세요.',
  invalid_partial_cancel_items: '취소할 상품과 수량을 확인해주세요.',
  partial_cancel_operation_conflict: '같은 요청 번호가 다른 주문에 쓰였습니다. 새로고침해주세요.',
  partial_cancel_transfer_evidence_required: '송금 근거와 확인 메모를 각각 2~300자로 입력해주세요.',
  partial_cancel_transfer_already_recorded: '이미 다른 송금 완료가 기록됐습니다.',
  partial_cancel_not_awaiting_transfer: '송금 대기 상태가 아닙니다. 새로고침해주세요.',
  partial_cancel_not_bank_transfer: '무통장 주문의 부분 취소가 아닙니다.',
  partial_cancel_refund_account_missing: '환불계좌 원문이 없습니다(파기됨). 고객에게 계좌를 다시 받아 담당자에게 넘겨주세요.',
  bank_refund_permission_required: '송금 담당 권한(관리자 로그인 세션)이 필요합니다.',
  operator_capability_required: '관리자 권한이 필요합니다.',
};

/** 결제사 확인 결과 사유(오케스트레이터 코드). */
const RECONCILE_ERRORS: Record<string, string> = {
  partial_cancel_rejected: '결제사가 이 결제의 부분 취소를 받지 않아 품목 부분 취소를 진행하지 않았습니다. 돈은 움직이지 않았고 주문·재고도 그대로입니다. 전액 환불로 돌리지 않으니 고객과 다시 상의해주세요.',
  provider_unavailable: '결제사 응답을 확인하지 못했습니다. 잠시 뒤 [결제사 확인 다시 하기]를 눌러주세요. 그동안 이 주문은 출고되지 않습니다.',
  provider_cancel_ambiguous: '결제사 응답을 확인하지 못했습니다. 잠시 뒤 [결제사 확인 다시 하기]를 눌러주세요.',
  provider_balance_mismatch: '결제사 잔액이 예상과 다릅니다(다른 취소가 끼어들었을 수 있음). 상점관리자에서 취소하지 말고 결제 담당 admin에게 넘겨주세요.',
  local_finalize_failed: '결제사 부분 취소는 확인됐지만 주문에 적용하지 못했습니다. [결제사 확인 다시 하기]를 눌러주세요. 같은 오류가 반복되면 결제 담당 admin에게 넘겨주세요.',
  payment_evidence_invalid: '결제 원장이 시작 때와 달라 결제사를 부르지 않았습니다. 결제 담당 admin에게 넘겨주세요.',
  provider_mismatch: '결제사가 확인한 결제가 원장의 결제와 다릅니다. 결제 담당 admin에게 넘겨주세요.',
  local_state_unavailable: '부분 취소 상태를 읽지 못했습니다. 잠시 뒤 다시 시도해주세요.',
  not_found: '부분 취소 기록을 찾을 수 없습니다.',
  not_ready: '결제사 확인을 기다리는 부분 취소가 아닙니다. 새로고침해주세요.',
};

/* 발송 전이 아닌 주문(이미 발송·취소 등)만 막는 이유. 기록이 없으면 패널을 그리지 않는다 — 모든 주문 상세에 막힘 안내를 띄우지 않는다. */
const HIDDEN_WHEN_ONLY = new Set(['order_not_partial_cancelable', 'shipment_already_dispatched', 'order_not_found']);

/**
 * 주문 상세에 부분 취소 패널을 그릴지. 스위치가 꺼져 있고 기록이 없으면 그리지 않는다(스위치 OFF면 화면이 지금과 같다).
 * 켜져 있어도 기록이 없고 발송 전 주문이 아니면 그리지 않는다.
 */
export function orderPartialCancellationPanelVisible(context: { enabled: boolean; blockers: readonly string[]; history: readonly unknown[] }) {
  if (context.history.length > 0) return true;
  if (!context.enabled) return false;
  return context.blockers.length === 0 || !context.blockers.every(code => HIDDEN_WHEN_ONLY.has(code));
}

export function orderPartialCancellationBlockerMessage(code: string) {
  return ORDER_BLOCKERS[code] ?? '지금은 부분 취소할 수 없습니다. 주문 상태를 확인해주세요.';
}

export function orderPartialCancellationItemBlockerLabel(code: string | null) {
  return code ? ITEM_BLOCKERS[code] ?? '선택 불가' : null;
}

/** DB 오류 메시지(사유 코드)를 운영 문구로. 판정 코드(partial_cancel_item_*·주문 막힘)도 같은 표로 옮긴다. */
export function orderPartialCancellationErrorMessage(message: string | null | undefined) {
  const value = (message ?? '').trim();
  if (START_ERRORS[value]) return START_ERRORS[value];
  if (ORDER_BLOCKERS[value]) return ORDER_BLOCKERS[value];
  if (value.startsWith('partial_cancel_item_')) {
    const label = ITEM_BLOCKERS[value.slice('partial_cancel_item_'.length)];
    if (label) return `고를 수 없는 상품이 있습니다(${label}). 새로고침해주세요.`;
  }
  if (value === 'goods_group_retry') return '재고를 함께 바꾸는 다른 작업이 진행 중입니다. 잠시 뒤 다시 시도해주세요.';
  if (value === 'partial_cancel_state_changed') return '확인창을 연 뒤 주문·배송 건이 바뀌었습니다. 새로고침해 최신 상태로 다시 확인해주세요.';
  return '부분 취소를 처리하지 못했습니다. 최신 상태를 확인해주세요.';
}

export function orderPartialCancellationReconcileMessage(code: string) {
  if (RECONCILE_ERRORS[code]) return RECONCILE_ERRORS[code];
  if (code.startsWith('provider_')) return `결제사 확인이 끝나지 않았습니다(${code}). 런북의 결제확인필요 조치를 따라주세요. 그동안 이 주문은 출고되지 않습니다.`;
  return '결제사 확인을 마치지 못했습니다. 최신 상태를 확인해주세요.';
}
