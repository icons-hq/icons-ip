/**
 * 클레임 도메인(#252) — 취소·반품 요청·교환.
 *
 * DB의 `order_cancellation_requests.claim_type`·`stage`와 같은 값을 쓴다. 한쪽만
 * 바꾸면 화면이 모르는 단계를 만나 빈 칸을 그리거나, DB가 CHECK로 막는다.
 *
 * 절차 상태기계는 `stage`다. `status`는 그 기계의 레거시 투영이며 앱은 읽기
 * 전용으로만 다룬다(마이그레이션 20260818120000 헤더 참조).
 */

export const ORDER_CLAIM_TYPES = ['cancel', 'return', 'exchange'] as const;
export type OrderClaimType = (typeof ORDER_CLAIM_TYPES)[number];

export const ORDER_CLAIM_STAGES = [
  'requested',
  'in_review',
  'collecting',
  'collected',
  'on_hold',
  'processing',
  'needs_review',
  'completed',
  'rejected',
  'withdrawn',
] as const;
export type OrderClaimStage = (typeof ORDER_CLAIM_STAGES)[number];

export const ORDER_CLAIM_REFUND_METHODS = ['pg_cancel', 'bank_transfer'] as const;
export type OrderClaimRefundMethod = (typeof ORDER_CLAIM_REFUND_METHODS)[number];

/**
 * 클레임 사유 구분 — DB `order_cancellation_requests.reason_type` check 제약 전체.
 *
 * 구매자 청약철회 사유(`lib/orders` ORDER_WITHDRAWAL_REASON_TYPES: 단순 변심·하자)에
 * 운영자 전액 취소(`staff`, ADR-0018)를 더한 값이다. `staff`는 기한·반송비 부담을
 * 가르는 구매자 사유가 아니다 — 운영 화면은 운영 사유(staff_reason_code)를 함께 보여준다
 * (2026-10-12 브라우저 QA QA-4). 구매자 신청은 계속 구매자 사유 두 값만 받는다.
 */
export const ORDER_CLAIM_REASON_TYPES = ['change_of_mind', 'defect', 'staff'] as const;
export type OrderClaimReasonType = (typeof ORDER_CLAIM_REASON_TYPES)[number];

/**
 * 유형별로 새로 받을 수 있는 구매자 사유(10/27 회의 R7).
 *
 * 하자·오배송은 굿즈를 받은 뒤에야 알 수 있으므로 취소(발주확인 전)에는 받지 않고 반품·교환으로
 * 받는다. 고객 화면은 원래 취소에 단순 변심만 보냈고, 판매자 대리 접수·고객 취소 API·목록 필터가
 * 이 표를 따른다. 이미 저장된 요청의 사유는 바꾸지 않고 그대로 표시한다.
 */
export const ORDER_CLAIM_BUYER_REASON_TYPES: Record<OrderClaimType, readonly Exclude<OrderClaimReasonType, 'staff'>[]> = {
  cancel: ['change_of_mind'],
  return: ['change_of_mind', 'defect'],
  exchange: ['change_of_mind', 'defect'],
};

/**
 * 운영자 전액 취소 사유(ADR-0018). DB `admin_start_order_cancellation`의 허용 목록·
 * `order_cancellation_requests_staff_origin_shape` 제약과 같아야 한다 — 한쪽만 늘리면
 * 고를 수 있는데 항상 거절되는 선택지가 생긴다.
 */
export const ORDER_STAFF_CANCELLATION_REASON_CODES = [
  'out_of_stock',
  'customer_request',
  'test_payment_cleanup',
  'other',
] as const;
export type OrderStaffCancellationReasonCode = (typeof ORDER_STAFF_CANCELLATION_REASON_CODES)[number];

export const ORDER_STAFF_CANCELLATION_REASON_LABELS: Record<OrderStaffCancellationReasonCode, string> = {
  out_of_stock: '품절·출고 불가',
  customer_request: '고객 요청(CS 접수)',
  test_payment_cleanup: '테스트 결제 정리',
  other: '기타',
};

/** 운영자 전액 취소의 사유 구분 표기. 운영 사유는 뒤에 붙는다. */
export const ORDER_STAFF_CLAIM_REASON_LABEL = '운영자 전액 취소';

export function isOrderClaimReasonType(value: unknown): value is OrderClaimReasonType {
  return typeof value === 'string' && (ORDER_CLAIM_REASON_TYPES as readonly string[]).includes(value);
}

export function isOrderStaffCancellationReasonCode(value: unknown): value is OrderStaffCancellationReasonCode {
  return typeof value === 'string'
    && (ORDER_STAFF_CANCELLATION_REASON_CODES as readonly string[]).includes(value);
}

/** 운영자 전액 취소 표기. 사유 코드를 모르면 구분만 적는다. */
export function orderStaffClaimReasonLabel(staffReasonCode: OrderStaffCancellationReasonCode | null) {
  return staffReasonCode
    ? `${ORDER_STAFF_CLAIM_REASON_LABEL} · ${ORDER_STAFF_CANCELLATION_REASON_LABELS[staffReasonCode]}`
    : ORDER_STAFF_CLAIM_REASON_LABEL;
}

export const ORDER_CLAIM_TYPE_LABELS: Record<OrderClaimType, string> = {
  cancel: '취소',
  return: '반품',
  exchange: '교환',
};

/** 콘솔 라우트 세그먼트. `/admin/sales/claims/{cancels,returns,exchanges}`. */
export const ORDER_CLAIM_TYPE_SLUGS: Record<OrderClaimType, string> = {
  cancel: 'cancels',
  return: 'returns',
  exchange: 'exchanges',
};

const SLUG_TO_TYPE: Record<string, OrderClaimType> = {
  cancels: 'cancel',
  returns: 'return',
  exchanges: 'exchange',
};

export const ORDER_CLAIM_STAGE_LABELS: Record<OrderClaimStage, string> = {
  requested: '접수',
  in_review: '검토중',
  collecting: '수거중',
  collected: '입고완료',
  /* 운영 보류다. provider 정합화 실패(needs_review)와 다른 개념이라 문구도 섞지 않는다. */
  on_hold: '보류',
  processing: '처리중',
  needs_review: '결제확인필요',
  completed: '처리완료',
  rejected: '거부',
  withdrawn: '요청 철회',
};

export const ORDER_CLAIM_REFUND_METHOD_LABELS: Record<OrderClaimRefundMethod, string> = {
  pg_cancel: '결제사 취소',
  bank_transfer: '계좌 송금',
};

/** 아직 처리가 끝나지 않은 단계. 목록 기본 필터와 배지가 이 집합을 쓴다. */
const OPEN_STAGES = new Set<OrderClaimStage>([
  'requested',
  'in_review',
  'collecting',
  'collected',
  'on_hold',
  'processing',
  'needs_review',
]);

export function isOrderClaimType(value: unknown): value is OrderClaimType {
  return typeof value === 'string' && (ORDER_CLAIM_TYPES as readonly string[]).includes(value);
}

export function isOrderClaimStage(value: unknown): value is OrderClaimStage {
  return typeof value === 'string' && (ORDER_CLAIM_STAGES as readonly string[]).includes(value);
}

export function isOrderClaimRefundMethod(value: unknown): value is OrderClaimRefundMethod {
  return typeof value === 'string'
    && (ORDER_CLAIM_REFUND_METHODS as readonly string[]).includes(value);
}

/**
 * 결제 provider가 정하는 환불 수단. null이면 운영자가 고른다(Korpay·결제 없음).
 *
 * 토스 결제는 '환불 완료 확정'이 토스 전액 취소를 발행하므로 결제사 취소뿐이다 —
 * 계좌 송금을 고를 수 있게 두면 취소가 나간 뒤 송금까지 해서 이중 환불이 된다
 * (2026-10-12 점검 REF-8·REF-3). 무통장 입금 결제는 계좌 송금으로만 돌려준다.
 */
export function orderClaimRefundMethodForProvider(
  provider: string | null,
): OrderClaimRefundMethod | null {
  if (provider === 'toss') return 'pg_cancel';
  if (provider === 'bank_transfer') return 'bank_transfer';
  return null;
}

export function orderClaimTypeForSlug(slug: unknown): OrderClaimType | null {
  return typeof slug === 'string' ? SLUG_TO_TYPE[slug] ?? null : null;
}

export function isOpenOrderClaimStage(stage: OrderClaimStage) {
  return OPEN_STAGES.has(stage);
}

/** 클레임번호. 주문번호와 달리 전화로 부르는 값이라 짧은 정수를 그대로 쓴다. */
export function orderClaimReferenceLabel(reference: number) {
  return `C${String(reference).padStart(5, '0')}`;
}

/**
 * 유형별로 다음에 가능한 단계.
 *
 * 이 표는 화면이 어떤 버튼을 그릴지 정하는 안내이지 게이트가 아니다. 폼을 조작해
 * 없는 전이를 부르면 막는 것은 DB RPC의 stage 전제조건이고, 서버 액션은 입력의
 * 형태만 좁힌다. 그래서 이 표가 DB 규칙과 갈라지면 "눌러도 항상 실패하는 버튼"이나
 * "DB는 허용하는데 화면에서 사라진 처리"가 생긴다 — 규칙을 바꿀 때 둘을 함께 본다.
 */
const NEXT_STAGES: Record<OrderClaimType, Partial<Record<OrderClaimStage, OrderClaimStage[]>>> = {
  cancel: {
    requested: ['in_review', 'processing', 'rejected', 'on_hold'],
    in_review: ['processing', 'rejected', 'on_hold'],
    processing: ['completed', 'on_hold'],
    needs_review: ['completed', 'on_hold'],
    on_hold: ['requested', 'in_review', 'processing'],
  },
  return: {
    requested: ['in_review', 'collecting', 'rejected', 'on_hold'],
    in_review: ['collecting', 'rejected', 'on_hold'],
    collecting: ['collected', 'rejected', 'on_hold'],
    collected: ['processing', 'rejected', 'on_hold'],
    processing: ['completed', 'on_hold'],
    needs_review: ['completed', 'on_hold'],
    on_hold: ['requested', 'in_review', 'collecting', 'collected', 'processing'],
  },
  exchange: {
    requested: ['in_review', 'collecting', 'rejected', 'on_hold'],
    in_review: ['collecting', 'rejected', 'on_hold'],
    collecting: ['collected', 'rejected', 'on_hold'],
    /* 교환의 종결은 재출고다. 환불 단계가 없다. */
    collected: ['completed', 'rejected', 'on_hold'],
    on_hold: ['requested', 'in_review', 'collecting', 'collected'],
  },
};

export function orderClaimNextStages(
  claimType: OrderClaimType,
  stage: OrderClaimStage,
): OrderClaimStage[] {
  return NEXT_STAGES[claimType][stage] ?? [];
}

/**
 * 보류를 벗긴 실질 단계.
 *
 * `on_hold`는 절차의 단계가 아니라 그 위에 덮인 표시다. 판정에 stage만 쓰면
 * `processing`에서 건 보류가 "아직 착수 전"으로 보인다. DB의
 * `admin_decide_order_claim`이 같은 식을 쓴다.
 */
export function orderClaimEffectiveStage(
  stage: OrderClaimStage,
  heldFrom: OrderClaimStage | null,
): OrderClaimStage {
  return stage === 'on_hold' ? heldFrom ?? 'requested' : stage;
}

/**
 * 거부 가능 여부.
 *
 * 환불 원장과 durable claim이 열리기 전까지만 거부할 수 있다. `processing`·
 * `needs_review`를 거부하면 주문이 "취소 진행 중"인 채로 남아 완료도 취소도
 * 되지 않는다 — DB가 `claim_not_rejectable`로 막는 것과 같은 규칙이다.
 */
const REJECTABLE_STAGES = new Set<OrderClaimStage>([
  'requested',
  'in_review',
  'collecting',
  'collected',
]);

export function canRejectOrderClaim(
  stage: OrderClaimStage,
  heldFrom: OrderClaimStage | null,
) {
  return REJECTABLE_STAGES.has(orderClaimEffectiveStage(stage, heldFrom));
}

/**
 * 환급 SLA — 약관 제16조 "굿즈를 반환받은 날부터 3영업일".
 *
 * 기산점은 입고 확인(`collectedAt`)이다. 접수일이 아니다 — 물건이 돌아오기 전에는
 * 환급 의무가 시작하지 않는다. 취소처럼 회수가 없는 유형은 승인 시점이 없으므로
 * 기산점 자체가 없고, 화면은 남은 시간을 지어내지 않는다.
 *
 * 영업일은 주말만 제외한다. 공휴일 달력은 앱에 없고, 있는 척하면 실제보다 빠른
 * 기한을 약속하게 된다.
 */
const REFUND_SLA_BUSINESS_DAYS = 3;
const DAY_MS = 24 * 60 * 60 * 1000;

export function addBusinessDays(from: Date, days: number) {
  const result = new Date(from.getTime());
  let remaining = days;
  while (remaining > 0) {
    result.setTime(result.getTime() + DAY_MS);
    const weekday = result.getUTCDay();
    if (weekday !== 0 && weekday !== 6) remaining -= 1;
  }
  return result;
}

export interface OrderClaimSlaState {
  label: string;
  tone: 'muted' | 'ok' | 'warning' | 'danger';
  dueAt: string | null;
}

export function orderClaimSlaState(
  input: {
    claimType: OrderClaimType;
    stage: OrderClaimStage;
    collectedAt: string | null;
    completedAt: string | null;
  },
  now: Date,
): OrderClaimSlaState {
  if (!isOpenOrderClaimStage(input.stage)) {
    return { label: '종료', tone: 'muted', dueAt: null };
  }
  if (input.claimType === 'exchange') {
    return { label: '재출고 대기', tone: 'muted', dueAt: null };
  }
  if (!input.collectedAt) {
    return {
      label: input.claimType === 'cancel' ? '회수 없음' : '입고 전',
      tone: 'muted',
      dueAt: null,
    };
  }

  const collected = new Date(input.collectedAt);
  if (Number.isNaN(collected.getTime())) {
    return { label: '입고 전', tone: 'muted', dueAt: null };
  }

  const due = addBusinessDays(collected, REFUND_SLA_BUSINESS_DAYS);
  const remaining = due.getTime() - now.getTime();
  if (remaining <= 0) {
    return { label: '기한 초과', tone: 'danger', dueAt: due.toISOString() };
  }

  const hours = Math.ceil(remaining / (60 * 60 * 1000));
  if (hours <= 24) return { label: `${hours}시간 남음`, tone: 'warning', dueAt: due.toISOString() };
  return {
    label: `${Math.ceil(hours / 24)}일 남음`,
    tone: 'ok',
    dueAt: due.toISOString(),
  };
}

/* ---------------------------------------------------------------------------
 * 환불계좌
 * ------------------------------------------------------------------------- */

/**
 * 접수 폼이 받는 환불계좌.
 *
 * 무통장 환불의 유일한 경로이고 카드 접수가 막혔을 때의 fallback이다. 세 칸이
 * 모두 있어야 저장한다 — 반쪽 계좌는 송금에 쓸 수 없다. 저장·보관 규칙은
 * #208의 답이 오면 좁힌다(마이그레이션 헤더의 안전 기본값).
 */
export interface RefundAccountInput {
  bankName: string;
  accountNumber: string;
  accountHolder: string;
}

const ACCOUNT_NUMBER_PATTERN = /^[0-9-]{8,30}$/;

export type RefundAccountValidation =
  | { ok: true; value: RefundAccountInput | null }
  | { ok: false; error: string };

export function normalizeRefundAccount(input: {
  bankName?: string | null;
  accountNumber?: string | null;
  accountHolder?: string | null;
}): RefundAccountValidation {
  const bankName = (input.bankName ?? '').trim();
  const accountNumber = (input.accountNumber ?? '').trim();
  const accountHolder = (input.accountHolder ?? '').trim();

  if (!bankName && !accountNumber && !accountHolder) return { ok: true, value: null };
  if (!bankName || !accountNumber || !accountHolder) {
    return { ok: false, error: '은행, 계좌번호, 예금주를 모두 입력해주세요.' };
  }
  if (bankName.length > 40 || accountHolder.length > 40) {
    return { ok: false, error: '은행과 예금주는 40자 이내로 입력해주세요.' };
  }
  if (!ACCOUNT_NUMBER_PATTERN.test(accountNumber)) {
    return { ok: false, error: '계좌번호는 숫자와 하이픈만 8~30자로 입력해주세요.' };
  }

  return { ok: true, value: { bankName, accountNumber, accountHolder } };
}

/* ---------------------------------------------------------------------------
 * 코페이 취소 접수 양식
 * ------------------------------------------------------------------------- */

/**
 * 코페이 어댑터의 `refund()`는 API를 호출하지 않고 전건 `needs_review`로 떨어진다 —
 * 수동 접수가 예외가 아니라 설계된 경로다. 실제 접수 채널은 이메일이므로 콘솔이
 * 붙여넣을 양식을 만든다. 운영자가 매번 여섯 칸을 손으로 옮겨 적으면 금액이나
 * 주문번호가 한 번은 틀린다.
 *
 * 승인번호(approvalReference)는 결제사 원장에서만 확인되는 값이라 없을 수 있다.
 * 지어내지 않고 "확인 필요"로 남겨 운영자가 채우게 한다.
 */
export interface KorpayCancellationFormInput {
  merchantName: string;
  orderId: string;
  orderReference: string;
  amount: number;
  paidAt: string | null;
  approvalReference?: string | null;
  cardIssuer?: string | null;
  reason: string;
}

const UNKNOWN_FIELD = '확인 필요';

function formatKstDate(value: string | null) {
  if (!value) return UNKNOWN_FIELD;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return UNKNOWN_FIELD;
  return new Intl.DateTimeFormat('ko-KR', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date).replaceAll(' ', '');
}

export function buildKorpayCancellationForm(input: KorpayCancellationFormInput): string {
  return [
    '[결제 취소 요청]',
    `상호명: ${input.merchantName}`,
    `결제일자: ${formatKstDate(input.paidAt)}`,
    `주문번호: ${input.orderReference} (${input.orderId})`,
    `취소금액: ${input.amount.toLocaleString('ko-KR')}원 (전액)`,
    `승인번호: ${input.approvalReference?.trim() || UNKNOWN_FIELD}`,
    `카드사: ${input.cardIssuer?.trim() || UNKNOWN_FIELD}`,
    `취소사유: ${input.reason}`,
  ].join('\n');
}

/* ---------------------------------------------------------------------------
 * 접수 가능 여부 (구매자 화면)
 * ------------------------------------------------------------------------- */

export interface OrderClaimAvailability {
  claimType: OrderClaimType;
  available: boolean;
  /** 못 하는 이유. 버튼을 감추는 대신 이유를 적는다. */
  blockedReason: string | null;
}

/**
 * 구매자가 지금 접수할 수 있는 클레임 유형.
 *
 * 취소는 발주확인 전, 반품·교환은 실제 발송된 배송 중 주문부터 전체 수량을 대상으로 연다.
 * DB의 `request_order_claim`이 잠금 안에서 다시 판정하므로 여기 값은 안내용이다.
 */
/** 소유자/직원 전용 RPC의 발주확인 이력·실제 배송 수량 판정. 접수 시 DB가 다시 검증한다. */
export interface OrderClaimEligibility {
  cancel: boolean;
  return: boolean;
  exchange: boolean;
}

export function orderClaimAvailability(input: {
  orderStatus: string;
  hasActiveClaim: boolean;
  eligibility?: OrderClaimEligibility | null;
}): OrderClaimAvailability[] {
  const claimableStage = ['shipping', 'delivered', 'done'].includes(input.orderStatus);
  const cancelable = ['pending', 'paid', 'confirmed', 'shipping', 'delivered', 'done'].includes(input.orderStatus);

  return ORDER_CLAIM_TYPES.map((claimType) => {
    if (input.hasActiveClaim) {
      return {
        claimType,
        available: false,
        blockedReason: '이미 처리 중인 클레임이 있습니다.',
      };
    }
    if (!input.eligibility) {
      return { claimType, available: false, blockedReason: '신청 가능 여부를 확인할 수 없습니다. 주문을 새로고침하거나 1:1 문의로 알려주세요.' };
    }
    if (claimType === 'cancel') {
      const available = cancelable && input.eligibility.cancel;
      return {
        claimType,
        available,
        blockedReason: available ? null : '현재 주문의 제작·배송·파일 제공 상태에서는 직접 취소를 신청할 수 없습니다.',
      };
    }
    const available = claimableStage && input.eligibility[claimType];
    return {
      claimType,
      available,
      blockedReason: available ? null : '배송 중 또는 배송완료 주문의 전체 수량을 확인한 뒤 신청할 수 있습니다.',
    };
  });
}

/** 유형별 접수 안내. 부분 환불을 약속하지 않는 문구를 한 곳에 모아 둔다. */
export const ORDER_CLAIM_INTAKE_NOTICES: Record<OrderClaimType, string> = {
  cancel: '일반 배송 상품은 발주확인 전에 직접 취소할 수 있습니다. 주문제작·배송없음·디지털 상품은 현재 이행 상태에 따라 주문 전체 취소 검토를 요청합니다. 일부 굿즈나 수량만 취소하는 처리는 제공하지 않습니다. 승인되면 최초 배송비를 포함한 결제금액 전액이 취소되고, 지급된 카드팩 중 개봉하지 않은 것은 회수됩니다.',
  return: '배송 중부터 주문 전체 반품을 직접 신청할 수 있습니다. 일부 굿즈만 반품하는 처리는 제공하지 않습니다. 실물 상품은 안내된 출고지별 반송지에서 전체 회수를 확인하며, 디지털 상품은 제공 이력과 요청 사유를 검토합니다. 승인된 환불은 최초 선결제 배송비를 포함한 결제금액 전액으로 처리합니다. 환급 기한은 반환받은 날부터 영업일 기준 3일 이내이며 담당자의 확인이 늦어져도 연장되지 않습니다.',
  exchange: '배송 중부터 주문 전체 교환을 직접 신청할 수 있습니다. 안내된 출고지별 반송지에서 모든 굿즈의 회수를 확인한 뒤 같은 굿즈를 다시 보내드립니다. 결제는 유지되고 카드팩도 회수하지 않습니다.',
};
