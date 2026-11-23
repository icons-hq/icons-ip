import { isUuid } from '@/lib/uuid';

/**
 * 주문 출고 보류(원장 PAY-050·SHP-093·OPS-074·OPS-065·CLM-051). DB가 보류를 판정하고 출고 경로를 막는다
 * (supabase/migrations/20261118156000_order_fulfillment_holds.sql). 화면은 사유·근거를 보이고 해제만 요청한다.
 *  - test_payment: 운영 배포에 토스 테스트 키가 물린 기간에 승인된 결제. 돈이 실제로 결제되지 않았다.
 *  - provider_canceled: 토스 상점관리자 등 결제사에서 직접 취소됐는데 우리 원장에 그 취소가 없다.
 *  - deposit_reversed: 토스가 가상계좌 입금(DONE)을 알린 뒤 은행이 그 입금을 취소했다(입금 대기로 되돌아감, ADR-0049).
 *    결제 원장은 되돌리지 않고 출고만 막는다 — 상점관리자에서 입금 상태를 확인한 뒤 해제하거나 운영자 전액 취소한다.
 *  - escrow_cancel_requested: 구매자가 토스 구매안전서비스(에스크로) 구매확정 메일에서 취소를 신청했다(ADR-0049).
 *    운영자 전액 취소가 이 결제에서는 결제 취소 대신 에스크로 취소 수락(구매자가 등록한 환불 계좌로 환불)을 부른다.
 */
export const FULFILLMENT_HOLD_REASONS = ['test_payment', 'provider_canceled', 'deposit_reversed', 'escrow_cancel_requested'] as const;
export type FulfillmentHoldReason = typeof FULFILLMENT_HOLD_REASONS[number];

export const FULFILLMENT_HOLD_LABELS: Record<FulfillmentHoldReason, string> = {
  test_payment: '테스트 결제',
  provider_canceled: '결제사 취소',
  deposit_reversed: '입금 오류 되돌림',
  escrow_cancel_requested: '에스크로 취소 요청',
};

export interface OrderFulfillmentHold {
  reason: FulfillmentHoldReason;
  placedAt: string | null;
  /** provider_canceled: 결제사 조회 상태(CANCELED·PARTIAL_CANCELED). */
  providerStatus: string | null;
  /** provider_canceled: 결제사가 취소한 누계 금액. */
  providerCanceledAmount: number | null;
  /** provider_canceled: 그중 우리 원장(적용된 부분 환불)이 설명하지 못하는 금액 — 보류의 근거다. */
  unexplainedAmount: number | null;
  paymentAmount: number | null;
  /**
   * 이 보류가 지금 출고를 막는가. 아직 나가지 않은 주문(신규주문·발주확인)이거나 발송 전 배송 건이 남아 있을 때만 true다.
   * 다 나간 주문의 보류는 경고다 — 배송완료는 막지 않고, 반품 접수 또는 사유를 적어 해제한다.
   */
  outboundBlocked: boolean;
}

export interface OrderFulfillmentHoldListItem {
  orderId: string;
  orderNumber: string | null;
  status: string;
  holds: OrderFulfillmentHold[];
}

export interface OrderFulfillmentHoldList {
  total: number;
  items: OrderFulfillmentHoldListItem[];
}

const isReason = (value: unknown): value is FulfillmentHoldReason =>
  typeof value === 'string' && (FULFILLMENT_HOLD_REASONS as readonly string[]).includes(value);
const nullableString = (value: unknown) => (typeof value === 'string' && value ? value : null);
const nullableAmount = (value: unknown) => (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null);

function parseHolds(value: unknown): OrderFulfillmentHold[] | null {
  if (!Array.isArray(value) || !value.length) return null;
  const holds: OrderFulfillmentHold[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return null;
    const row = entry as Record<string, unknown>;
    if (!isReason(row.reason)) return null;
    holds.push({
      reason: row.reason,
      placedAt: nullableString(row.placedAt),
      providerStatus: nullableString(row.providerStatus),
      providerCanceledAmount: nullableAmount(row.providerCanceledAmount),
      unexplainedAmount: nullableAmount(row.unexplainedAmount),
      paymentAmount: nullableAmount(row.paymentAmount),
      /* 모르는 값은 막는 쪽으로 읽는다(안내가 '출고하지 마세요'로 남는다). */
      outboundBlocked: row.outboundBlocked !== false,
    });
  }
  return holds;
}

/** admin_order_fulfillment_holds 응답(주문 id → 보류 목록). 형태가 어긋나면 null — 호출자가 화면을 실패로 연다. */
export function parseOrderFulfillmentHolds(value: unknown, orderIds: readonly string[]): Map<string, OrderFulfillmentHold[]> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const allowed = new Set(orderIds);
  const result = new Map<string, OrderFulfillmentHold[]>();
  for (const [orderId, entry] of Object.entries(value as Record<string, unknown>)) {
    const holds = parseHolds(entry);
    if (!allowed.has(orderId) || !holds) return null;
    result.set(orderId, holds);
  }
  return result;
}

export function parseOrderFulfillmentHoldList(value: unknown): OrderFulfillmentHoldList | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (!Number.isSafeInteger(record.total) || (record.total as number) < 0 || !Array.isArray(record.items)) return null;
  const items: OrderFulfillmentHoldListItem[] = [];
  for (const entry of record.items) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return null;
    const row = entry as Record<string, unknown>;
    const holds = parseHolds(row.holds);
    if (typeof row.orderId !== 'string' || !isUuid(row.orderId) || typeof row.status !== 'string' || !holds) return null;
    items.push({ orderId: row.orderId, orderNumber: nullableString(row.orderNumber), status: row.status, holds });
  }
  return { total: record.total as number, items };
}

const krw = (value: number) => `${value.toLocaleString('ko-KR')}원`;

/**
 * 보류 사유별 안내 문구. 다음 행동까지 말한다 — 아직 나가지 않은 주문은 운영자 전액 취소(또는 사유 적고 해제), 이미 발송된 주문은
 * 운영자 전액 취소가 열리지 않으므로 반품 접수 또는 사유 적고 해제다.
 */
export function fulfillmentHoldGuidance(hold: OrderFulfillmentHold): string {
  const unexplained = hold.unexplainedAmount ?? hold.providerCanceledAmount;
  if (hold.reason === 'deposit_reversed') {
    return hold.outboundBlocked
      ? '결제사가 가상계좌 입금을 알린 뒤 은행이 그 입금을 취소했습니다. 돈이 들어와 있지 않을 수 있으니 출고하지 마세요. 토스페이먼츠 상점관리자에서 이 결제의 입금 상태를 확인해, 입금이 다시 확인되면 사유를 적고 보류를 해제하고, 입금이 없으면 운영자 전액 취소로 주문을 닫으세요(재고·쿠폰·적립금이 돌아갑니다).'
      : '이미 발송된 주문인데 결제사가 알린 가상계좌 입금을 은행이 취소했습니다. 배송완료 처리는 막지 않습니다. 토스페이먼츠 상점관리자에서 입금 상태를 확인해, 입금이 다시 확인되면 사유를 적고 보류를 해제하고, 입금이 없으면 고객에게 연락해 반품을 접수하세요.';
  }
  if (hold.reason === 'escrow_cancel_requested') {
    return hold.outboundBlocked
      ? '구매자가 토스페이먼츠 구매안전서비스(에스크로)에서 결제 취소를 신청했습니다. 출고하지 마세요. 운영자 전액 취소를 누르면 구매자의 취소 신청을 수락해 구매자가 등록한 환불 계좌로 환불되고 주문이 닫힙니다. 고객과 통화해 그대로 출고하기로 했다면 사유를 적고 보류를 해제한 뒤, 토스페이먼츠 상점관리자에서 구매자에게 구매확정 요청을 다시 보내세요.'
      : '이미 발송된 주문인데 구매자가 토스페이먼츠 구매안전서비스(에스크로)에서 결제 취소를 신청했습니다. 배송완료 처리는 막지 않습니다. 물건을 돌려받을 주문이면 반품을 접수하고, 고객과 합의해 그대로 두기로 했다면 사유를 적고 보류를 해제한 뒤, 토스페이먼츠 상점관리자에서 구매자에게 구매확정 요청을 다시 보내세요.';
  }
  if (!hold.outboundBlocked) {
    if (hold.reason === 'test_payment') {
      return '토스 테스트 키로 승인된(실제 돈이 결제되지 않은) 결제인데 이미 발송된 주문입니다. 배송완료 처리는 막지 않습니다. 물건을 돌려받으려면 반품을 접수하고, 그대로 두기로 했다면 사유를 적고 보류를 해제하세요.';
    }
    return `이미 발송된 주문인데 결제사에서 취소된 금액${unexplained !== null ? `(${krw(unexplained)})` : ''}이 시스템에 기록돼 있지 않습니다. 배송완료 처리는 막지 않습니다. 물건을 돌려받으려면 반품을 접수하고, 고객과 합의해 그대로 두기로 했다면 사유를 적고 보류를 해제하세요. 운영자 전액 취소는 발송 전 주문에서만 열립니다.`;
  }
  if (hold.reason === 'test_payment') {
    return '운영 환경에서 토스 테스트 키로 승인된 결제입니다. 실제 돈이 결제되지 않았으므로 출고하지 마세요. 고객 주문이면 운영자 전액 취소로 주문을 닫고(재고·쿠폰이 돌아갑니다), 리허설 주문이면 그대로 두어도 출고되지 않습니다.';
  }
  const full = hold.paymentAmount !== null && hold.providerCanceledAmount !== null && hold.providerCanceledAmount >= hold.paymentAmount;
  const amount = unexplained !== null ? ` ${krw(unexplained)}` : '';
  if (full) {
    return `결제사에서 결제가 전액 취소되었습니다(취소${amount}). 출고하지 말고 운영자 전액 취소로 주문을 닫으세요 — 시스템이 이미 취소된 결제로 확인해 환불 기록을 남기고 재고·쿠폰을 되돌립니다.`;
  }
  return `결제사에서 결제 일부가 시스템 모르게 취소되었습니다(취소${amount}). 남은 금액도 취소해야 하면 토스 상점관리자에서 남은 금액을 마저 취소한 뒤 운영자 전액 취소로 주문을 닫으세요. 남은 금액으로 출고하기로 했다면 사유를 적고 보류를 해제하세요.`;
}

/** 해제 결과 오류 코드 → 문구. */
export function fulfillmentHoldReleaseError(code?: string | null, message?: string | null): string {
  if (code === '42501' || message?.includes('operator_capability_required')) return '주문 관리 권한이 필요합니다. 로그인 계정을 확인해주세요.';
  if (message?.includes('fulfillment_hold_not_active')) return '이미 해제된 보류입니다. 화면을 새로고침해 현재 상태를 확인해주세요.';
  if (code === 'PT409' || message?.includes('fulfillment_hold_operation_conflict')) return '같은 요청이 다른 내용으로 처리되었습니다. 화면을 새로고침한 뒤 다시 시도해주세요.';
  if (message?.includes('invalid_fulfillment_hold_release')) return '해제 사유를 5자 이상 500자 이하로 입력해주세요.';
  if (message?.includes('order_not_found')) return '주문을 찾을 수 없습니다.';
  return '보류를 해제하지 못했습니다. 화면을 새로고침해 현재 상태를 확인한 뒤 다시 시도해주세요.';
}

/** 보류 배지 문구. 출고를 막는 보류와 발송 뒤 경고를 글자로도 나눈다. */
export function fulfillmentHoldBadgeLabel(hold: OrderFulfillmentHold): string {
  return hold.outboundBlocked ? `출고 보류 · ${FULFILLMENT_HOLD_LABELS[hold.reason]}` : `발송 후 ${FULFILLMENT_HOLD_LABELS[hold.reason]} 확인`;
}

/** DB 출고 경로가 보류로 거절할 때의 오류 문구(message 'order fulfillment hold'). 괄호 안 사유는 다른 화면의 같은 오류 문구·가이드
 *  인용(troubleshooting)과 글자가 같아야 해서 그대로 둔다 — 사유 전체는 주문 상세의 출고 보류 안내가 보인다. */
export const FULFILLMENT_HOLD_BLOCKED_MESSAGE = '출고 보류 중인 주문입니다(결제 확인 필요). 주문 상세의 출고 보류 안내를 확인해주세요.';
export const isFulfillmentHoldError = (message?: string | null) => message?.includes('order fulfillment hold') === true;
