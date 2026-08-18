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
] as const;
export type OrderClaimStage = (typeof ORDER_CLAIM_STAGES)[number];

export const ORDER_CLAIM_REFUND_METHODS = ['pg_cancel', 'bank_transfer'] as const;
export type OrderClaimRefundMethod = (typeof ORDER_CLAIM_REFUND_METHODS)[number];

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
 * 화면이 액션 버튼을 고를 때와 서버 액션이 입력을 좁힐 때 같은 표를 본다 —
 * 화면에만 두면 버튼이 없는 전이를 폼 조작으로 부를 수 있다.
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
  if (input.stage === 'completed' || input.stage === 'rejected') {
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
 * 반품·교환은 `delivered` 이후에만 연다 — 그 전에는 회수할 물건이 고객에게 없다.
 * DB의 `request_order_claim`이 같은 판정을 다시 하므로 여기 값은 안내용이다.
 */
export function orderClaimAvailability(input: {
  orderStatus: string;
  hasActiveClaim: boolean;
}): OrderClaimAvailability[] {
  const delivered = input.orderStatus === 'delivered' || input.orderStatus === 'done';
  const cancelable = ['pending', 'paid', 'confirmed', 'shipping', 'delivered', 'done']
    .includes(input.orderStatus);

  return ORDER_CLAIM_TYPES.map((claimType) => {
    if (input.hasActiveClaim) {
      return {
        claimType,
        available: false,
        blockedReason: '이미 처리 중인 클레임이 있습니다.',
      };
    }
    if (claimType === 'cancel') {
      return {
        claimType,
        available: cancelable,
        blockedReason: cancelable ? null : '취소할 수 없는 주문입니다.',
      };
    }
    return {
      claimType,
      available: delivered,
      blockedReason: delivered ? null : '배송이 완료된 뒤에 신청할 수 있습니다.',
    };
  });
}

/** 유형별 접수 안내. 부분 환불을 약속하지 않는 문구를 한 곳에 모아 둔다. */
export const ORDER_CLAIM_INTAKE_NOTICES: Record<OrderClaimType, string> = {
  cancel: '취소는 주문 단위로 처리됩니다. 승인되면 그 주문의 결제금액 전액이 취소되고, 지급된 카드팩 중 개봉하지 않은 것은 회수됩니다.',
  return: '반품은 주문 단위로 처리됩니다. 한 주문의 굿즈 중 일부만 반품하고 나머지 대금을 그대로 두는 처리는 제공하지 않습니다. 반송된 굿즈가 입고 확인되면 영업일 기준 3일 이내에 환급합니다.',
  exchange: '교환은 굿즈를 회수한 뒤 같은 굿즈를 다시 보내드립니다. 환불이 아니므로 결제는 유지되고 카드팩도 회수하지 않습니다.',
};
