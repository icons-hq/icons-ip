import { isUuid } from '@/lib/uuid';
import type { ShipmentRecord } from '@/lib/orders/shipments';
import type { OrderWithdrawalReasonType } from '@/lib/orders';
import type { GoodsOptionSaleMode } from '@/lib/goods-option-sale-mode';
import {
  ORDER_STAFF_CANCELLATION_REASON_CODES,
  ORDER_STAFF_CANCELLATION_REASON_LABELS,
  type OrderClaimReasonType,
  type OrderClaimStage,
  type OrderClaimType,
  type OrderStaffCancellationReasonCode,
} from '@/lib/orders/claims';
import { adminSettledHref, normalizeAdminSettledFilters } from './settled';
import { normalizeShipmentFilters, shipmentConsoleHref } from './shipment-dispatch';
import { ADMIN_VOCABULARY } from './vocabulary';
import { appendSalesListOptions, normalizeSalesListOptions, salesDateField, salesPage, salesParam, SALES_ORDER_SEARCH_FIELDS, type SalesDateField, type SalesListOptions, type SalesOrderSearchField } from './sales-list';
import {
  carrierTrackingNumberIssue,
  findShippingCarrier,
  isSelectableShippingCarrier,
  isTrackingNumber,
  normalizeTrackingNumber,
  type ShippingCarrierRegistry,
} from '@/lib/orders/shipment';
import { providerCancelsAutomatically } from '@/lib/payments/provider-capabilities';

// DB의 order_status enum과 같은 순서를 유지한다 — 상태 필터의 표시 순서가
// 사다리 순서 그 자체다(#250).
export const ADMIN_ORDER_STATUSES = [
  'pending',
  'paid',
  'confirmed',
  'shipping',
  'delivered',
  'done',
  'canceled',
] as const;
export type AdminOrderStatus = (typeof ADMIN_ORDER_STATUSES)[number];
export type AdminOrderStatusFilter = AdminOrderStatus | 'all';

/** 주문 통합검색에서 검색할 원장을 고른다. 기본값은 기존 전체 검색이다. */
export type AdminOrderSearchField = SalesOrderSearchField;
export const ADMIN_ORDER_SEARCH_FIELDS = SALES_ORDER_SEARCH_FIELDS;

/**
 * 상태 표기의 단일 진실원.
 *
 * 필터 드롭다운과 오류 문구가 같은 말을 써야 한다 — 일괄 등록 실패 리포트가
 * "confirmed가 아닙니다"라고 적으면 운영자는 화면 어디에서도 그 단어를 찾을 수 없다.
 */
export const ADMIN_ORDER_STATUS_LABELS: Record<AdminOrderStatus, string> = {
  pending: '결제 대기',
  paid: '신규주문',
  confirmed: ADMIN_VOCABULARY.confirmed,
  shipping: '배송중',
  delivered: '배송완료',
  done: ADMIN_VOCABULARY.settled,
  canceled: '취소',
};

export const GOODS_PAYMENT_ATTEMPT_STATES = [
  'prepared',
  'confirming',
  'approved',
  'declined',
  'canceled',
  'unknown',
  'needs_review',
  /* 토스 가상계좌가 발급돼 입금을 기다리는 시도(ADR-0049). 입금 기한까지 재고를 잡고, 입금되면 approved로 닫힌다. */
  'awaiting_deposit',
] as const;
export type GoodsPaymentAttemptState = (typeof GOODS_PAYMENT_ATTEMPT_STATES)[number];

/** 결제 시도 상태의 운영자 표기. 주문 패널·상세가 같은 말을 쓴다. */
export const GOODS_PAYMENT_ATTEMPT_STATE_LABELS: Record<GoodsPaymentAttemptState, string> = {
  prepared: '결제 준비',
  confirming: '승인 확인 중',
  approved: '승인 완료',
  declined: '승인 거절',
  canceled: '취소 완료',
  unknown: '결과 미확인',
  needs_review: '운영 확인 필요',
  awaiting_deposit: '입금 대기(가상계좌)',
};

/**
 * 주문의 토스 가상계좌(무통장입금) 입금 정보 — `admin_order_virtual_account`(sales.read)가 돌려준다(ADR-0049).
 * 계좌번호는 결제사가 주문마다 발급한 수납 계좌라 구매자 개인정보가 아니지만, 주문 본인과 운영자에게만 보인다.
 * state: awaiting(입금 기한 전 입금 대기) · deposited(입금 확인 = 결제 승인) · checking(기한이 지났거나 결제사 확인이
 * 끝나지 않음 — 자동 재확인이 닫는다) · closed(입금 없이 반납·취소·만료로 닫힘).
 */
export const ADMIN_VIRTUAL_ACCOUNT_STATES = ['awaiting', 'deposited', 'checking', 'closed'] as const;
export type AdminVirtualAccountState = (typeof ADMIN_VIRTUAL_ACCOUNT_STATES)[number];

/**
 * 에스크로 배송 등록 작업(private.toss_escrow_deliveries, 20261125090200)의 운영자 투영. 구매자가 에스크로를 고른 결제는
 * 발송 때 결제사에 배송 정보를 등록해야 구매확정·정산이 진행된다. manual_required는 자동 등록이 안 돼 사람이 상점관리자에서 등록할 일이다.
 */
export const ADMIN_ESCROW_DELIVERY_STATES = ['waiting', 'ready', 'registered', 'skipped', 'manual_required'] as const;
export type AdminEscrowDeliveryState = (typeof ADMIN_ESCROW_DELIVERY_STATES)[number];
export const ADMIN_ESCROW_STATUSES = ['IN_PROGRESS', 'CANCEL_REQUESTED', 'CONFIRMED', 'CANCELED'] as const;
export type AdminEscrowStatus = (typeof ADMIN_ESCROW_STATUSES)[number];

export interface AdminOrderEscrowJob {
  deliveryState: AdminEscrowDeliveryState;
  /** 결제사 에스크로 거래 상태(마지막으로 다시 읽은 값). 아직 읽지 않았으면 null. */
  escrowStatus: AdminEscrowStatus | null;
  /** 자동 등록이 실패했거나 다시 시도 중일 때의 확인 코드. */
  lastErrorCode: string | null;
}

export const ADMIN_ESCROW_DELIVERY_STATE_LABELS: Record<AdminEscrowDeliveryState, string> = {
  waiting: '발송 전',
  ready: '배송 정보 등록 중',
  registered: '배송 정보 등록 완료',
  skipped: '에스크로 결제 아님',
  manual_required: '직접 등록 필요',
};

export const ADMIN_ESCROW_STATUS_LABELS: Record<AdminEscrowStatus, string> = {
  IN_PROGRESS: '구매확정 대기',
  CANCEL_REQUESTED: '구매자 취소 신청',
  CONFIRMED: '구매확정 완료',
  CANCELED: '에스크로 취소',
};

/** 자동 등록이 안 된 에스크로 배송 정보의 다음 일. */
export const ADMIN_ESCROW_MANUAL_REQUIRED_HINT =
  '발송한 배송 정보를 결제사에 자동으로 등록하지 못했습니다(택배사 코드 없음·운송장 형식 거절 등). 토스페이먼츠 상점관리자에서 이 결제의 배송 정보를 직접 등록해주세요. 등록하지 않으면 구매자가 구매확정을 할 수 없어 정산이 진행되지 않습니다.';

/**
 * 가상계좌 환불의 은행 송금 감시(private.virtual_account_refund_watches, ADR-0049 결정 5 보강). 환불(결제 취소) 뒤 은행이 영업일 2일 안에
 * 고객 계좌로 송금한다. pending: 송금 확인 전 · completed: 송금 완료 · failed: 송금 실패·7일째 확인 안 됨·결제사 기록 불일치 ·
 * resolved: 운영자가 결제사 밖에서 끝내고 처리 완료로 표시.
 */
export const ADMIN_VIRTUAL_ACCOUNT_REFUND_STATES = ['pending', 'completed', 'failed', 'resolved'] as const;
export type AdminVirtualAccountRefundState = (typeof ADMIN_VIRTUAL_ACCOUNT_REFUND_STATES)[number];
export const ADMIN_VIRTUAL_ACCOUNT_REFUND_FAILURES = ['refund_failed', 'refund_partial_failed', 'refund_overdue', 'payment_mismatch'] as const;
export type AdminVirtualAccountRefundFailure = (typeof ADMIN_VIRTUAL_ACCOUNT_REFUND_FAILURES)[number];

export interface AdminVirtualAccountRefundWatch {
  state: AdminVirtualAccountRefundState;
  /** 실패·지연 사유. 실패가 아니면 null. */
  failureCode: AdminVirtualAccountRefundFailure | null;
  /** 환불(결제 취소)을 확인한 시각. */
  refundedAt: string;
  /** 결제사에 마지막으로 조회한 시각. 아직 조회 전이면 null. */
  checkedAt: string | null;
  /** 운영자가 처리 완료로 표시하며 남긴 사유. */
  resolutionNote: string | null;
}

export const ADMIN_VIRTUAL_ACCOUNT_REFUND_STATE_LABELS: Record<AdminVirtualAccountRefundState, string> = {
  pending: '은행 송금 확인 중',
  completed: '환불 송금 완료',
  failed: '환불 송금 확인 필요',
  resolved: '처리 완료(운영자 확인)',
};

export const ADMIN_VIRTUAL_ACCOUNT_REFUND_FAILURE_LABELS: Record<AdminVirtualAccountRefundFailure, string> = {
  refund_failed: '은행이 고객 계좌로 송금하지 못했습니다',
  refund_partial_failed: '은행이 일부 금액을 송금하지 못했습니다',
  refund_overdue: '환불 뒤 7일이 지나도 송금 완료가 확인되지 않습니다',
  payment_mismatch: '결제사 기록이 이 주문의 환불과 맞지 않습니다',
};

/** 송금 상태별 다음 일. */
export const ADMIN_VIRTUAL_ACCOUNT_REFUND_HINTS: Record<AdminVirtualAccountRefundState, string> = {
  pending: '결제는 취소됐고 은행이 고객 계좌로 송금하는 중입니다(영업일 기준 2일 정도). 시스템이 결제사에 조회해 송금 완료를 확인합니다.',
  completed: '고객 환불 계좌로 송금이 끝났습니다.',
  failed: '고객에게 환불금이 가지 않았을 수 있습니다. 토스페이먼츠 상점관리자에서 이 결제의 환불 상태를 확인해 다시 환불하고 고객에게 안내해주세요. 상점관리자에서 다시 환불하면 시스템이 조회해 저절로 완료로 바꿉니다. 회사 계좌에서 직접 보내는 등 결제사 밖에서 끝냈다면 [처리 완료로 표시]를 누르고 처리 내용을 남겨주세요.',
  resolved: '운영자가 결제사 밖에서 환불을 끝내고 처리 완료로 표시했습니다.',
};

export interface AdminOrderVirtualAccount {
  /** 토스 은행 코드(2·3자리). 화면은 tossBankLabel로 은행 이름을 보인다. */
  bankCode: string;
  accountNumber: string;
  /** 입금 기한(ISO 시각). */
  dueAt: string;
  amount: number;
  /** 구매자가 구매안전서비스(에스크로)를 골랐는가. null이면 결제사 응답에 값이 없었다. */
  useEscrow: boolean | null;
  state: AdminVirtualAccountState;
  /** 에스크로 배송 등록 작업. 작업이 없으면(옛 응답 포함) null. */
  escrow: AdminOrderEscrowJob | null;
  /** 환불 뒤 은행 송금 감시. 환불 전이거나 감시가 없으면(옛 응답 포함) null. */
  refund: AdminVirtualAccountRefundWatch | null;
}

/**
 * 계좌이체 주문의 에스크로(구매안전서비스) 작업(admin_order_transfer_escrow, 20261125110100). 계좌이체는 구매자 선택을 남기는 곳이 없어
 * 작업자가 결제사에 조회해 확인한다 — useEscrow null은 아직 확인 전이다.
 */
export interface AdminOrderTransferEscrow {
  useEscrow: boolean | null;
  job: AdminOrderEscrowJob;
}

/** 계좌이체 에스크로 칸의 다음 일 안내. */
export const ADMIN_TRANSFER_ESCROW_HINT =
  '계좌이체는 고객이 결제할 때 구매안전서비스(에스크로)를 고를 수 있고, 시스템이 결제사에 조회해 적용 여부를 확인합니다. 적용된 결제는 실물 배송 건이 모두 발송되면 시스템이 결제사에 배송 정보를 등록합니다. 환불은 결제사가 대금이 출금된 계좌로 돌려줍니다.';

/** 계좌이체 에스크로 적용 표기. */
export function adminTransferEscrowLabel(useEscrow: boolean | null): string {
  if (useEscrow === true) return '적용(구매자가 선택)';
  if (useEscrow === false) return '적용 안 함';
  return '확인 중(결제사 조회 전)';
}

export const ADMIN_VIRTUAL_ACCOUNT_STATE_LABELS: Record<AdminVirtualAccountState, string> = {
  awaiting: '입금 대기',
  deposited: '입금 완료',
  checking: '입금 확인 중',
  closed: '입금 없이 닫힘',
};

/** 상태별 다음 일 안내. 운영자가 누를 버튼은 없다 — 입금 확인·만료 정리는 결제사 조회로 자동 처리된다. */
export const ADMIN_VIRTUAL_ACCOUNT_STATE_HINTS: Record<AdminVirtualAccountState, string> = {
  awaiting: '고객이 입금하면 결제사 확인 뒤 자동으로 결제완료(신규주문)가 됩니다. 입금 기한까지 입금이 없으면 주문이 자동 취소되고 재고·쿠폰·적립금이 돌아갑니다.',
  deposited: '결제사가 입금을 확인해 결제가 확정됐습니다. 입금 뒤 환불은 고객 환불 계좌로 보내므로, 취소·반품에서 환불 계좌(은행·계좌번호·예금주)가 있어야 합니다.',
  checking: '입금 기한이 지났거나 결제사 확인이 아직 끝나지 않았습니다. 시스템이 결제사에 다시 조회해 입금이 있으면 결제완료, 없으면 주문 취소로 닫습니다. 입금 기한이 2시간 넘게 지나도 그대로면 판매자 정보 → 시스템 상태의 미종결 결제에 보입니다.',
  closed: '입금 없이 계좌가 반납·만료돼 닫힌 결제입니다. 이 계좌로는 더 입금되지 않습니다.',
};

/** 구매안전서비스(에스크로) 적용 표기. */
export function adminVirtualAccountEscrowLabel(useEscrow: boolean | null): string {
  if (useEscrow === true) return '적용(구매자가 선택)';
  if (useEscrow === false) return '적용 안 함';
  return '기록 없음';
}

const VIRTUAL_ACCOUNT_STATE_SET = new Set<string>(ADMIN_VIRTUAL_ACCOUNT_STATES);
const VIRTUAL_ACCOUNT_REFUND_STATE_SET = new Set<string>(ADMIN_VIRTUAL_ACCOUNT_REFUND_STATES);
const VIRTUAL_ACCOUNT_REFUND_FAILURE_SET = new Set<string>(ADMIN_VIRTUAL_ACCOUNT_REFUND_FAILURES);
const ESCROW_DELIVERY_STATE_SET = new Set<string>(ADMIN_ESCROW_DELIVERY_STATES);
const ESCROW_STATUS_SET = new Set<string>(ADMIN_ESCROW_STATUSES);

/** 에스크로 작업 투영. 없으면 null, 모르는 값이면 undefined(직접 등록 필요 같은 신호를 조용히 접지 않는다). */
function parseAdminOrderEscrowJob(value: unknown): AdminOrderEscrowJob | null | undefined {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'object' || Array.isArray(value)) return undefined;
  const { deliveryState, escrowStatus, lastErrorCode } = value as Record<string, unknown>;
  if (typeof deliveryState !== 'string' || !ESCROW_DELIVERY_STATE_SET.has(deliveryState)
    || (escrowStatus !== null && escrowStatus !== undefined && (typeof escrowStatus !== 'string' || !ESCROW_STATUS_SET.has(escrowStatus)))
    || (lastErrorCode !== null && lastErrorCode !== undefined && (typeof lastErrorCode !== 'string' || !/^[A-Za-z0-9_.:-]{1,80}$/.test(lastErrorCode)))) {
    return undefined;
  }
  return {
    deliveryState: deliveryState as AdminEscrowDeliveryState,
    escrowStatus: typeof escrowStatus === 'string' ? escrowStatus as AdminEscrowStatus : null,
    lastErrorCode: typeof lastErrorCode === 'string' ? lastErrorCode : null,
  };
}

/** 환불 송금 감시 투영. 없으면 null, 모르는 값이면 undefined(송금 실패 신호를 조용히 접지 않는다). */
function parseAdminVirtualAccountRefundWatch(value: unknown): AdminVirtualAccountRefundWatch | null | undefined {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'object' || Array.isArray(value)) return undefined;
  const { state, failureCode, refundedAt, checkedAt, resolutionNote } = value as Record<string, unknown>;
  const time = (input: unknown) => typeof input === 'string' && Number.isFinite(Date.parse(input));
  if (typeof state !== 'string' || !VIRTUAL_ACCOUNT_REFUND_STATE_SET.has(state)
    || (failureCode !== null && failureCode !== undefined && (typeof failureCode !== 'string' || !VIRTUAL_ACCOUNT_REFUND_FAILURE_SET.has(failureCode)))
    || (state === 'failed' && typeof failureCode !== 'string')
    || !time(refundedAt)
    || (checkedAt !== null && checkedAt !== undefined && !time(checkedAt))
    || (resolutionNote !== null && resolutionNote !== undefined && typeof resolutionNote !== 'string')) {
    return undefined;
  }
  return {
    state: state as AdminVirtualAccountRefundState,
    failureCode: typeof failureCode === 'string' ? failureCode as AdminVirtualAccountRefundFailure : null,
    refundedAt: refundedAt as string,
    checkedAt: typeof checkedAt === 'string' ? checkedAt : null,
    resolutionNote: typeof resolutionNote === 'string' ? resolutionNote : null,
  };
}

/**
 * `admin_order_transfer_escrow` 응답을 읽는다. null(계좌이체 에스크로 작업이 없는 주문)은 null, 형태가 어긋나면 undefined.
 */
export function parseAdminOrderTransferEscrow(value: unknown): AdminOrderTransferEscrow | null | undefined {
  if (value === null) return null;
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const { useEscrow } = value as Record<string, unknown>;
  const job = parseAdminOrderEscrowJob(value);
  if (!job || (useEscrow !== null && useEscrow !== undefined && typeof useEscrow !== 'boolean')) return undefined;
  return { useEscrow: typeof useEscrow === 'boolean' ? useEscrow : null, job };
}

/**
 * `admin_order_virtual_account` 응답을 읽는다. null(가상계좌 결제가 아닌 주문)은 null, 형태가 어긋나면 undefined —
 * 호출자가 '불러오지 못했다'고 안내한다(가상계좌가 아니라고 잘못 말하지 않는다).
 */
export function parseAdminOrderVirtualAccount(value: unknown): AdminOrderVirtualAccount | null | undefined {
  if (value === null) return null;
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const row = value as Record<string, unknown>;
  const { bankCode, accountNumber, dueAt, amount, useEscrow, state } = row;
  const escrow = parseAdminOrderEscrowJob(row.escrow);
  if (escrow === undefined) return undefined;
  const refund = parseAdminVirtualAccountRefundWatch(row.refund);
  if (refund === undefined) return undefined;
  if (typeof bankCode !== 'string' || !/^[0-9]{2,3}$/.test(bankCode)
    || typeof accountNumber !== 'string' || !/^[0-9A-Za-z*-]{4,40}$/.test(accountNumber)
    || typeof dueAt !== 'string' || !Number.isFinite(Date.parse(dueAt))
    || typeof amount !== 'number' || !Number.isSafeInteger(amount) || amount < 0
    || (useEscrow !== null && useEscrow !== undefined && typeof useEscrow !== 'boolean')
    || typeof state !== 'string' || !VIRTUAL_ACCOUNT_STATE_SET.has(state)) {
    return undefined;
  }
  return {
    bankCode,
    accountNumber,
    dueAt,
    amount,
    useEscrow: typeof useEscrow === 'boolean' ? useEscrow : null,
    state: state as AdminVirtualAccountState,
    escrow,
    refund,
  };
}

const KORPAY_MANUAL_RECOVERY_STATE_SET = new Set<GoodsPaymentAttemptState>([
  'confirming',
  'approved',
  'unknown',
  'needs_review',
]);

export function isKorpayManualRecoveryState(state: GoodsPaymentAttemptState) {
  return KORPAY_MANUAL_RECOVERY_STATE_SET.has(state);
}

export const ORDER_CANCELLATION_REQUEST_STATUSES = [
  'requested',
  'processing',
  'needs_review',
  'completed',
  'rejected',
] as const;
export type OrderCancellationRequestStatus = (typeof ORDER_CANCELLATION_REQUEST_STATUSES)[number];

export interface AdminOrderFilters extends SalesListOptions {
  from: string | null;
  orderId: string | null;
  page: number;
  query: string;
  field: AdminOrderSearchField;
  status: AdminOrderStatusFilter;
  to: string | null;
  dateField?: SalesDateField;
  paymentMethod?: 'card' | 'bank_transfer';
}

export interface AdminOrderAddress {
  recipientName: string;
  phone: string;
  postalCode: string;
  address1: string;
  address2?: string;
  deliveryNote?: string;
}

export interface AdminOrderItemRecord {
  productOrderNumber?: string;
  variantId: string;
  variantName?: string | null;
  customInputs?: import('@/lib/goods-custom-inputs').GoodsCustomInputSelection | null;
  variantCode?: string | null;
  /**
   * 판매 방식(D5②). 'random'이면 고객이 고른 옵션이 아니라 주문 생성 때 DB가 재고 비례로 무작위 배정한 옵션이다.
   * variantId·variantName·variantCode는 배정된 옵션 그대로다. 주문 상세(admin_order_detail)만 싣는다.
   */
  optionSaleMode?: GoodsOptionSaleMode;
  id: string;
  name: string;
  qty: number;
  unitPrice: number;
}

export interface AdminOrderPaymentRecord {
  id: string;
  provider: string | null;
  amount: number;
  status: string;
  createdAt: string;
}

export interface AdminOrderRefundRecord {
  id: string;
  amount: number;
  status: string;
  createdAt: string;
}

export interface AdminGoodsManualRecoveryAttemptRecord {
  attemptId: string;
  requestId: string;
  providerOrderId: string;
  state: GoodsPaymentAttemptState;
  amount: number;
  currency: string;
  manualRecoveryAvailable: boolean;
}

export interface AdminOrderCancellationRequestRecord {
  id: string;
  status: OrderCancellationRequestStatus;
  /**
   * 클레임 유형과 절차 단계(#252).
   *
   * `status`는 레거시 투영이라 수거 중인 반품·입고까지 끝난 교환·보류 중인
   * 클레임이 전부 `requested`로 보인다. 주문 콘솔의 승인·거절 버튼은 그 값으로
   * 판단하면 안 된다 — DB가 `claim_requires_claim_console`로 막더라도, 버튼이
   * 그려져 있는 한 운영자는 누르고 실패 문구로 상황을 배우게 된다.
   */
  claimType: OrderClaimType;
  stage: OrderClaimStage;
  /** 구매자 사유 또는 운영자 전액 취소('staff', ADR-0018). */
  reasonType: OrderClaimReasonType;
  /** 운영자 전액 취소의 운영 사유. 구매자 요청은 null이다. */
  staffReasonCode: OrderStaffCancellationReasonCode | null;
  requestedAt: string;
  decidedAt: string | null;
  decisionNote: string | null;
  /**
   * 최근 정합화 오류 코드(order_cancellation_requests.last_error_code). 결제확인필요
   * 요청의 원인을 주문 패널에서 바로 보고 런북의 코드별 조치를 찾게 한다(QA-10).
   */
  lastErrorCode: string | null;
}

/** 레거시 주문 콘솔이 직접 처리할 수 있는 클레임. 나머지는 클레임 콘솔의 몫이다. */
export function isLegacyDecidableCancellation(
  request: AdminOrderCancellationRequestRecord | null,
) {
  return Boolean(request && request.claimType === 'cancel' && request.stage === 'requested');
}

/**
 * 반송비 부담 주체는 귀책에서 갈린다. 승인 화면에서 운영자가 함께 봐야 한다.
 * 표기는 배송정책 문서(`lib/legal/documents.ts` "반송비 부담")의 어휘를 따른다 —
 * 운영자가 화면에서 본 말로 정책 원문을 찾을 수 있어야 한다.
 */
export const ADMIN_WITHDRAWAL_RETURN_SHIPPING_LABELS: Record<OrderWithdrawalReasonType, string> = {
  change_of_mind: '반송비 이용자 부담',
  defect: '반송비 회사 부담',
};

export interface AdminOrderRecord {
  orderNumber?: string;
  isGift?: boolean;
  transaction?: import('@/lib/goods-transaction').GoodsTransactionDisplay;
  id: string;
  userId: string;
  buyerName: string;
  buyerEmail: string | null;
  status: AdminOrderStatus;
  total: number;
  address: AdminOrderAddress | null;
  addressNeedsReview?: boolean;
  createdAt: string;
  updatedAt: string;
  items: AdminOrderItemRecord[];
  payments: AdminOrderPaymentRecord[];
  refunds: AdminOrderRefundRecord[];
  cancellationRequest: AdminOrderCancellationRequestRecord | null;
  manualRecoveryAttempt: AdminGoodsManualRecoveryAttemptRecord | null;
  shipments: ShipmentRecord[];
  /** 출고 보류(테스트 결제·결제사 취소·입금 오류 되돌림·에스크로 취소 요청). 없거나 빈 배열이면 보류가 없다 — 판정·차단은 DB가 한다. */
  fulfillmentHolds?: import('./fulfillment-holds').OrderFulfillmentHold[];
  /**
   * 토스 가상계좌 입금 정보(ADR-0049). 화면 목록에서 열려 있는 주문 하나(처리 패널)만 읽는다 — 키가 없으면 읽지 않은 것이고,
   * null이면 가상계좌 결제가 아닌 주문이다.
   */
  virtualAccount?: AdminOrderVirtualAccount | null;
  /** 계좌이체 주문의 에스크로 작업(주문 처리 권한에만 읽는다). */
  transferEscrow?: AdminOrderTransferEscrow | null;
  /** 가상계좌 정보를 읽지 못했다(조회 실패·형식 어긋남). 가상계좌가 아니라고 말하지 않고 '불러오지 못했다'고 안내한다. */
  virtualAccountUnavailable?: true;
}

export interface AdminOrderConsoleData {
  items: AdminOrderRecord[];
  filters: AdminOrderFilters;
  pageSize: number;
  total: number;
  /**
   * 운송장 폼이 고를 수 있는 택배사(#251). 목록 응답에 함께 실어 보낸다 —
   * 콘솔은 클라이언트 컴포넌트라 DB 레지스트리를 직접 읽을 수 없고, 상수 목록을
   * 다시 두면 레지스트리와 갈라진다.
   */
  carriers: ShippingCarrierRegistry;
  counts?: Record<AdminOrderStatus, number>;
  /** 출고 보류 중인 주문(오래된 순 최대 20건과 전체 건수). 화면 목록만 읽는다(엑셀 출력은 읽지 않는다). */
  fulfillmentHoldList?: import('./fulfillment-holds').OrderFulfillmentHoldList;
}

export type AdminOrderFieldErrors = Record<string, string>;
export type AdminOrderFormResult<T> =
  | { ok: true; value: T }
  | { ok: false; errors: AdminOrderFieldErrors };

type SearchParamValue = string | string[] | undefined;
type AdminOrderSearchParams = Record<string, SearchParamValue>;

const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const ORDER_STATUS_SET = new Set<string>(ADMIN_ORDER_STATUSES);
const SEARCH_FIELDS = new Set<string>(ADMIN_ORDER_SEARCH_FIELDS.map((field) => field.value));
/**
 * 어드민 상태 폼이 직접 밀 수 있는 전이 대상(#250).
 *
 * `admin_update_order_status`가 받는 값과 같아야 한다 — `paid`는 결제 웹훅이,
 * `done`은 구매자 확정·자동 정책 경로가, `canceled`는 청약철회 경로가 각각 소유하므로
 * 운영자 폼이 손댈 수 있는 것은 사다리 중간 세 칸뿐이다.
 */
const SHIPPING_STATUS_SET = new Set<string>(['confirmed', 'shipping', 'delivered']);
export type AdminOrderFormStatus = 'confirmed' | 'shipping' | 'delivered';

function singleParam(value: SearchParamValue) {
  return typeof value === 'string' ? value : '';
}

function validCalendarDate(value: string) {
  const match = DATE_PATTERN.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year
    && date.getUTCMonth() === month - 1
    && date.getUTCDate() === day;
}

function normalizedDate(value: SearchParamValue) {
  const candidate = singleParam(value);
  return validCalendarDate(candidate) ? candidate : null;
}

function normalizedUuid(value: SearchParamValue) {
  const candidate = singleParam(value).trim();
  return isUuid(candidate) ? candidate.toLowerCase() : null;
}

function readFormString(formData: FormData, key: string) {
  const value = formData.get(key);
  return typeof value === 'string' ? value.trim() : '';
}

export function normalizeAdminOrderFilters(searchParams: AdminOrderSearchParams): AdminOrderFilters {
  let from = normalizedDate(searchParams.from);
  let to = normalizedDate(searchParams.to);
  if (from && to && from > to) {
    from = null;
    to = null;
  }

  const listOptions = normalizeSalesListOptions(searchParams);
  const page = salesPage(searchParams.page, listOptions.pageSize ?? 50);
  const rawQuery = singleParam(searchParams.query).trim();
  const query = rawQuery.length <= 100 ? rawQuery : '';
  const rawField = singleParam(searchParams.field);
  const rawStatus = singleParam(searchParams.status);
  const status = ORDER_STATUS_SET.has(rawStatus) ? rawStatus as AdminOrderStatus : 'all';

  return {
    ...listOptions,
    ...(salesDateField(searchParams) ? { dateField: salesDateField(searchParams) } : {}),
    ...(['card', 'bank_transfer'].includes(salesParam(searchParams, 'paymentMethod'))
      ? { paymentMethod: salesParam(searchParams, 'paymentMethod') as 'card' | 'bank_transfer' } : {}),
    field: SEARCH_FIELDS.has(rawField) ? rawField as AdminOrderSearchField : 'all',
    from,
    orderId: normalizedUuid(searchParams.order),
    page,
    query,
    status,
    to,
  };
}

interface TrackingInput {
  carrier: string;
  trackingNumber: string;
}

/**
 * 택배사·운송장번호를 함께 검증한다. 둘 중 하나만 남으면 DB 쌍 제약에 걸린다.
 *
 * 택배사 판정은 레지스트리를 받아서 한다(#251). **활성** 택배사만 통과시킨다 —
 * 등록만 되어 있고 계약이 끝난 코드로 새 운송장을 붙이면 DB 게이트에서 거절돼
 * 운영자는 이유를 알 수 없는 저장 실패를 본다.
 */
function readTrackingInput(
  formData: FormData,
  carriers: ShippingCarrierRegistry,
): AdminOrderFormResult<TrackingInput> {
  const carrier = readFormString(formData, 'carrier');
  const rawTrackingNumber = readFormString(formData, 'trackingNumber');
  const trackingNumber = normalizeTrackingNumber(rawTrackingNumber);
  const errors: AdminOrderFieldErrors = {};

  if (!isSelectableShippingCarrier(carriers, carrier)) errors.carrier = '택배사를 선택해주세요.';
  if (!trackingNumber) {
    errors.trackingNumber = '운송장번호를 입력해주세요.';
  } else if (!isTrackingNumber(trackingNumber)) {
    errors.trackingNumber = '운송장번호는 하이픈을 뺀 8~30자리 영숫자여야 합니다.';
  } else {
    // 택배사별 형식(레지스트리). 최종 판정은 DB 등록 판정이고 여기서는 칸 옆에 먼저 알린다.
    const selected = findShippingCarrier(carriers, carrier);
    const issue = selected ? carrierTrackingNumberIssue(selected, trackingNumber) : null;
    if (issue) errors.trackingNumber = issue;
  }
  if (Object.keys(errors).length) return { ok: false, errors };

  return { ok: true, value: { carrier, trackingNumber } };
}

export function normalizeAdminOrderStatusForm(
  formData: FormData,
  carriers: ShippingCarrierRegistry,
): AdminOrderFormResult<{
  orderId: string;
  status: AdminOrderFormStatus;
  carrier: string | null;
  trackingNumber: string | null;
}> {
  const orderId = readFormString(formData, 'orderId').toLowerCase();
  const status = readFormString(formData, 'status');
  const errors: AdminOrderFieldErrors = {};

  if (!isUuid(orderId)) errors.orderId = '주문을 찾을 수 없습니다.';
  if (!SHIPPING_STATUS_SET.has(status)) errors.status = '허용된 주문 상태를 선택해주세요.';
  if (Object.keys(errors).length) return { ok: false, errors };

  // 운송장을 받는 것은 발송처리(shipping)뿐이다. 발주확인·배송완료 전이에서 재입력을
  // 받으면 그 시점에 운송장이 조용히 바뀌는 경로가 생긴다 — 수정은 전용 폼에서만
  // 감사와 함께 한다. DB도 입력이 없으면 기존 운송장을 유지한다.
  if (status !== 'shipping') {
    return {
      ok: true,
      value: {
        orderId,
        status: status as Exclude<AdminOrderFormStatus, 'shipping'>,
        carrier: null,
        trackingNumber: null,
      },
    };
  }

  const tracking = readTrackingInput(formData, carriers);
  if (!tracking.ok) return tracking;

  return {
    ok: true,
    value: {
      orderId,
      status: 'shipping',
      carrier: tracking.value.carrier,
      trackingNumber: tracking.value.trackingNumber,
    },
  };
}

export function normalizeAdminOrderTrackingForm(
  formData: FormData,
  carriers: ShippingCarrierRegistry,
): AdminOrderFormResult<{ orderId: string; carrier: string; trackingNumber: string }> {
  const orderId = readFormString(formData, 'orderId').toLowerCase();
  const tracking = readTrackingInput(formData, carriers);
  const errors: AdminOrderFieldErrors = {
    ...(isUuid(orderId) ? {} : { orderId: '주문을 찾을 수 없습니다.' }),
    ...(tracking.ok ? {} : tracking.errors),
  };
  if (Object.keys(errors).length) return { ok: false, errors };
  if (!tracking.ok) return { ok: false, errors };

  return {
    ok: true,
    value: {
      orderId,
      carrier: tracking.value.carrier,
      trackingNumber: tracking.value.trackingNumber,
    },
  };
}

export function normalizeAdminCancellationDecisionForm(
  formData: FormData,
  decision: 'approve',
): AdminOrderFormResult<{ requestId: string }>;
export function normalizeAdminCancellationDecisionForm(
  formData: FormData,
  decision: 'reject',
): AdminOrderFormResult<{ requestId: string; reason: string }>;
export function normalizeAdminCancellationDecisionForm(
  formData: FormData,
  decision: 'approve' | 'reject',
): AdminOrderFormResult<{ requestId: string; reason?: string }> {
  const requestId = readFormString(formData, 'requestId').toLowerCase();
  const errors: AdminOrderFieldErrors = {};
  if (!isUuid(requestId)) errors.requestId = '청약철회 요청을 찾을 수 없습니다.';

  if (decision === 'reject') {
    const reason = readFormString(formData, 'reason');
    if (reason.length < 10 || reason.length > 200) {
      errors.reason = '거절 사유를 10자 이상 200자 이하로 입력해주세요.';
    }
    if (Object.keys(errors).length) return { ok: false, errors };
    return { ok: true, value: { requestId, reason } };
  }

  if (Object.keys(errors).length) return { ok: false, errors };
  return { ok: true, value: { requestId } };
}

/**
 * 주문 통합검색 주문 패널의 결제 취소 재확인 버튼 이름(ReconcileCancellationForm).
 *
 * 같은 재정합 액션이지만 요청 단계에 따라 이름이 다르다. 서버 액션의 재시도 안내는
 * 이 이름을 그대로 가리킨다 — 화면에 없는 버튼을 안내하지 않도록 한 곳에서 정한다.
 */
export const ADMIN_CANCELLATION_RECHECK_LABELS = {
  processing: '처리 상태 확인',
  needsReview: '상태 다시 확인',
  preparedKorpay: 'Korpay 만료·취소 처리',
} as const;

/**
 * 운영자 전액 취소 사유(ADR-0018). 값과 표기는 lib/orders/claims의 한 목록에서 온다 —
 * DB `admin_start_order_cancellation`의 허용 목록과 같아야 하고, 클레임 목록·상세·통계가
 * 같은 표기로 운영 사유를 보여준다.
 */
export const ADMIN_STAFF_CANCELLATION_REASONS = ORDER_STAFF_CANCELLATION_REASON_CODES.map((value) => ({
  value,
  label: ORDER_STAFF_CANCELLATION_REASON_LABELS[value],
}));
export type AdminStaffCancellationReason = OrderStaffCancellationReasonCode;
const STAFF_CANCELLATION_REASON_SET = new Set<string>(ADMIN_STAFF_CANCELLATION_REASONS.map((reason) => reason.value));
export const ADMIN_STAFF_CANCELLATION_NOTE_LIMIT = 500;

/**
 * 운영자 전액 취소를 시작할 수 있는 주문인가(ADR-0018).
 *
 * 화면에 버튼을 그릴지만 정한다. 판정의 진실원은 DB가 주문·배송 건 잠금 아래에서
 * 다시 하는 검사다(진행 중 결제 포함). 결제 조건은 DB `admin_start_order_cancellation`의
 * `staff_cancellation_toss_only`와 같게 맞춘다 — 실패가 아닌 결제가 하나 이상이고
 * 모두 취소 API가 있는 카드 결제사(토스·나이스페이)·결제완료일 때만 그린다. Korpay·무통장
 * 주문에 버튼을 그리면 누를 때마다
 * 거절되는 버튼이 된다. 출고지시 파일이 나간 배송 건이 있으면(requiresWarehouseStop) 양식이 창고 회신 기록
 * 상태를 함께 보인다 — 근거는 주문 상세의 창고 회신 기록이고 DB가 실행 때 판정한다(ADR-0046).
 */
export function adminStaffCancellationAvailability(
  order: AdminOrderRecord,
): { available: false } | { available: true; requiresWarehouseStop: boolean } {
  if (order.status !== 'paid' && order.status !== 'confirmed') return { available: false };
  const livePayments = order.payments.filter((payment) => payment.status !== 'failed');
  if (!livePayments.length) return { available: false };
  if (livePayments.some((payment) => !providerCancelsAutomatically(payment.provider) || payment.status !== 'paid')) {
    return { available: false };
  }
  const request = order.cancellationRequest;
  if (request && !['completed', 'rejected', 'withdrawn'].includes(request.stage)) return { available: false };
  if (order.shipments.some((shipment) => (
    (shipment.status !== 'ready' && shipment.status !== 'canceled')
    || Boolean(shipment.shippedAt)
    || Boolean(shipment.deliveredAt)
  ))) {
    return { available: false };
  }
  return {
    available: true,
    requiresWarehouseStop: order.shipments.some((shipment) => shipment.status === 'ready' && Boolean(shipment.exportedAt)),
  };
}

export function normalizeAdminStaffCancellationForm(
  formData: FormData,
): AdminOrderFormResult<{
  orderId: string;
  reasonCode: AdminStaffCancellationReason;
  note: string | null;
  warehouseStopConfirmed: boolean;
}> {
  const orderId = readFormString(formData, 'orderId').toLowerCase();
  const reasonCode = readFormString(formData, 'reasonCode');
  const note = readFormString(formData, 'note');
  const errors: AdminOrderFieldErrors = {};
  if (!isUuid(orderId)) errors.orderId = '주문을 찾을 수 없습니다.';
  if (!STAFF_CANCELLATION_REASON_SET.has(reasonCode)) errors.reasonCode = '취소 사유를 선택해주세요.';
  if (note.length > ADMIN_STAFF_CANCELLATION_NOTE_LIMIT) {
    errors.note = `메모는 ${ADMIN_STAFF_CANCELLATION_NOTE_LIMIT}자 이내로 입력해주세요.`;
  } else if (reasonCode === 'other' && note.length < 5) {
    errors.note = '기타 사유는 메모를 5자 이상 입력해주세요.';
  }
  if (Object.keys(errors).length) return { ok: false, errors };
  return {
    ok: true,
    value: {
      orderId,
      reasonCode: reasonCode as AdminStaffCancellationReason,
      note: note.length ? note : null,
      warehouseStopConfirmed: formData.get('warehouseStopConfirmed') === 'confirmed',
    },
  };
}

export function normalizeAdminGoodsManualRecoveryForm(
  formData: FormData,
): AdminOrderFormResult<{
  operation: 'provider_cancel_confirmed';
  attemptId: string;
  requestId: string;
  operatorAttested: true;
}> {
  const attemptId = readFormString(formData, 'attemptId').toLowerCase();
  const requestId = readFormString(formData, 'requestId').toLowerCase();
  const attestation = readFormString(formData, 'operatorAttestation');
  const errors: AdminOrderFieldErrors = {};

  if (!isUuid(attemptId)) {
    errors.attemptId = '결제 시도를 찾을 수 없습니다.';
  }
  if (!isUuid(requestId)) {
    errors.requestId = '청약철회 요청을 찾을 수 없습니다.';
  }
  if (attestation !== 'provider_cancel_confirmed') {
    errors.operatorAttestation = '결제사 원장에서 전액 취소를 확인해야 합니다.';
  }
  if (Object.keys(errors).length) return { ok: false, errors };

  return {
    ok: true,
    value: {
      operation: 'provider_cancel_confirmed',
      attemptId,
      requestId,
      operatorAttested: true,
    },
  };
}

/**
 * 주문 목록 링크. 필터는 쿼리로 남고 화면은 라우트가 정한다 —
 * 섹션 전환이 `?section=`이던 시절의 파라미터는 더 이상 붙이지 않는다.
 */
export function adminOrdersHref(
  filters: AdminOrderFilters,
  overrides: Partial<AdminOrderFilters> = {},
) {
  const next = { ...filters, ...overrides };
  const params = new URLSearchParams();
  appendSalesListOptions(params, next);
  if (next.dateField) params.set('dateField', next.dateField);
  if (next.paymentMethod) params.set('paymentMethod', next.paymentMethod);
  if (next.status !== 'all') params.set('status', next.status);
  if (next.from) params.set('from', next.from);
  if (next.to) params.set('to', next.to);
  if (next.query) {
    params.set('query', next.query);
    if (next.field !== 'all') params.set('field', next.field);
  }
  params.set('page', String(next.page));
  if (next.orderId) params.set('order', next.orderId);
  return `/admin/sales/orders?${params.toString()}`;
}

/** 목록 문맥을 함께 들고 여는 전용 주문 상세 링크. */
/** 액션의 복귀 문맥일 뿐이며 주문 접근 권한은 기존 RPC/RLS에서 검사한다. */
export function adminOrderActionHref(orderId: unknown) {
  return isUuid(orderId) ? adminOrderDetailHref(orderId) : '/admin/sales/orders';
}

export function adminOrderDetailHref(orderId: string, filters?: AdminOrderFilters) {
  const base = `/admin/sales/orders/${orderId}`;
  if (!filters) return base;
  return `${base}?back=${encodeURIComponent(adminOrdersHref(filters))}`;
}

/**
 * 주문 통합검색에서 한 주문의 주문 패널을 여는 링크. 취소 재확인([처리 상태 확인]·
 * [상태 다시 확인])과 운영자 전액 취소는 이 패널에만 있다("상세 열기" 새 탭 화면에는 없다).
 */
export function adminOrderSearchHref(orderId: string) {
  return `/admin/sales/orders?query=${encodeURIComponent(orderId)}`;
}

/** 거래확정 목록처럼 주문 콘솔이 아닌 화면에서도 같은 상세 링크를 쓴다. */
export function adminOrderDetailHrefFromBack(orderId: string, backHref?: string) {
  const base = `/admin/sales/orders/${orderId}`;
  return backHref ? `${base}?back=${encodeURIComponent(backHref)}` : base;
}

const ORDER_DETAIL_BACK_FIELDS = ['status', 'from', 'to', 'query', 'field', 'page', 'order', 'dateField', 'paymentMethod', 'sort', 'pageSize'] as const;
const SETTLED_DETAIL_BACK_FIELDS = ['from', 'to', 'query', 'field', 'page', 'dateField', 'sort', 'pageSize'] as const;
const SHIPMENT_DETAIL_BACK_FIELDS = ['tab', 'originId', 'from', 'to', 'query', 'page', 'field', 'dateField', 'method', 'paymentMethod', 'sort', 'pageSize', 'delayNotice'] as const;
const ADMIN_BACK_ORIGIN = 'https://icons-admin.invalid';

/**
 * 상세 URL의 `back`은 외부 입력이다. 허용된 목록 경로와 필터만 다시 만들고,
 * 외부 origin·임의 파라미터는 버려서 상세 화면이 임의 URL redirector가 되지 않게 한다.
 */
export function adminOrderBackHref(back: unknown) {
  if (typeof back !== 'string' || !back.trim()) return '/admin/sales/orders';

  let source: URL;
  try {
    source = new URL(back, ADMIN_BACK_ORIGIN);
  } catch {
    return '/admin/sales/orders';
  }
  if (source.origin !== ADMIN_BACK_ORIGIN) return '/admin/sales/orders';

  if (source.pathname === '/admin/sales/orders') {
    const known: Record<string, string> = {};
    for (const key of ORDER_DETAIL_BACK_FIELDS) {
      const value = source.searchParams.get(key);
      if (value) known[key] = value;
    }
    const normalized = adminOrdersHref(normalizeAdminOrderFilters(known));
    if (source.searchParams.get('view') === 'items') {
      const items = new URL(normalized, ADMIN_BACK_ORIGIN);
      items.searchParams.set('view', 'items');
      items.searchParams.delete('order');
      if (known.field === 'item') items.searchParams.set('field', 'item');
      return items.pathname + items.search;
    }
    return normalized;
  }

  if (source.pathname === '/admin/sales/settled') {
    const known: Record<string, string> = {};
    for (const key of SETTLED_DETAIL_BACK_FIELDS) {
      const value = source.searchParams.get(key);
      if (value) known[key] = value;
    }
    return adminSettledHref(normalizeAdminSettledFilters(known));
  }

  for (const surface of ['dispatch', 'shipping'] as const) {
    if (source.pathname !== `/admin/sales/${surface}`) continue;
    const known: Record<string, string> = {};
    for (const key of SHIPMENT_DETAIL_BACK_FIELDS) {
      const value = source.searchParams.get(key);
      if (value) known[key] = value;
    }
    return shipmentConsoleHref(surface, normalizeShipmentFilters(known, surface));
  }

  return '/admin/sales/orders';
}
