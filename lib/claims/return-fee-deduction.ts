import { krwAmountWords } from '@/lib/format';

/*
 * 반품배송비 차감(QNA-033, ADR-0031) — 화면이 읽는 판정·결정과 문구.
 *
 * 금액은 DB가 정한다(private.return_fee_deduction_plan·claim_refund_deductions). 여기서는 계산하지 않고 모양을 좁히고
 * 문구만 만든다. 스위치가 꺼져 있고 결정이 없으면 DB가 필드를 싣지 않으므로 parse 결과가 null이고, 화면은 지금 그대로다.
 */

export const RETURN_FEE_DEDUCTION_STATES = ['planned', 'provider_confirmed', 'applied', 'not_applied'] as const;
export type ReturnFeeDeductionState = (typeof RETURN_FEE_DEDUCTION_STATES)[number];

/** 차감할 수 없는 이유. 앞의 넷은 접수 전 판정, partial_cancel_unavailable은 결제사 조회 뒤 전액 환불로 돌린 결정이다. */
export const RETURN_FEE_DEDUCTION_REASONS = [
  'payment_unavailable',
  'gift_order',
  'partial_cancel_unsupported',
  'claim_fee_invoiced',
  'fee_exceeds_payment',
  'partial_cancel_unavailable',
] as const;
export type ReturnFeeDeductionReason = (typeof RETURN_FEE_DEDUCTION_REASONS)[number];

export interface ReturnFeeDeduction {
  /** plan = 환불 접수 전 판정(아직 결정 아님), decision = 접수 때 정한 결정. */
  source: 'plan' | 'decision';
  state: ReturnFeeDeductionState | null;
  applicable: boolean;
  reason: ReturnFeeDeductionReason | null;
  oneWayAmount: number;
  basis: 'one_way' | 'round_trip';
  deductionAmount: number;
  paymentAmount: number | null;
  /** 돌려줄 금액. 차감하지 않으면 결제 금액이다. */
  refundAmount: number | null;
  provider: string | null;
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function amount(value: unknown, minimum = 0): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= minimum ? value : null;
}

/** DB 문서의 refundDeduction을 좁힌다. 없으면 null, 모양이 어긋나도 null — 화면에 지어낸 금액을 보이지 않는다. */
export function parseReturnFeeDeduction(value: unknown): ReturnFeeDeduction | null {
  if (!record(value)) return null;
  const source = value.source === 'plan' || value.source === 'decision' ? value.source : null;
  const state = typeof value.state === 'string' && (RETURN_FEE_DEDUCTION_STATES as readonly string[]).includes(value.state)
    ? value.state as ReturnFeeDeductionState
    : null;
  const reason = typeof value.reason === 'string' && (RETURN_FEE_DEDUCTION_REASONS as readonly string[]).includes(value.reason)
    ? value.reason as ReturnFeeDeductionReason
    : null;
  const oneWayAmount = amount(value.oneWayAmount, 1);
  const deductionAmount = amount(value.deductionAmount, 1);
  const paymentAmount = value.paymentAmount === null ? null : amount(value.paymentAmount);
  const refundAmount = value.refundAmount === null ? null : amount(value.refundAmount);
  const basis = value.basis === 'one_way' || value.basis === 'round_trip' ? value.basis : null;
  if (
    !source || typeof value.applicable !== 'boolean' || oneWayAmount === null || deductionAmount === null || !basis
    || (source === 'decision' && state === null)
    || (value.applicable && (paymentAmount === null || refundAmount === null || refundAmount + deductionAmount !== paymentAmount))
    || (!value.applicable && reason === null)
  ) {
    return null;
  }
  return {
    source,
    state,
    applicable: value.applicable,
    reason,
    oneWayAmount,
    basis,
    deductionAmount,
    paymentAmount,
    refundAmount,
    provider: typeof value.provider === 'string' ? value.provider : null,
  };
}

/** 차감 근거 한 줄. 예: '편도 3,000원' · '최초 무료배송이라 왕복(편도 3,000원 × 2)'. */
export function returnFeeDeductionBasisLabel(deduction: Pick<ReturnFeeDeduction, 'basis' | 'oneWayAmount'>) {
  return deduction.basis === 'round_trip'
    ? `최초 무료배송이라 왕복(편도 ${krwAmountWords(deduction.oneWayAmount)} × 2)`
    : `편도 ${krwAmountWords(deduction.oneWayAmount)}`;
}

/** 운영 화면 환불 단계의 머리 문구. 예: '반품배송비 3,000원 차감, 환불 27,000원'. 차감하지 않으면 null. */
export function returnFeeDeductionHeadline(deduction: ReturnFeeDeduction | null): string | null {
  if (!deduction?.applicable || deduction.refundAmount === null) return null;
  return `반품배송비 ${krwAmountWords(deduction.deductionAmount)} 차감, 환불 ${krwAmountWords(deduction.refundAmount)}`;
}

const REASON_COPY: Record<ReturnFeeDeductionReason, string> = {
  payment_unavailable: '결제 내역을 하나로 확인할 수 없어 차감하지 않고 결제 금액 전액을 환불합니다.',
  gift_order: '선물 주문은 결제한 분과 요청한 분이 다를 수 있어 차감하지 않고 결제 금액 전액을 환불합니다.',
  partial_cancel_unsupported: '이 결제는 결제사 부분 취소를 쓸 수 없어 차감하지 않고 결제 금액 전액을 환불합니다.',
  claim_fee_invoiced: '이 요청에 배송비 청구가 이미 있어 환불금에서 다시 차감하지 않습니다.',
  fee_exceeds_payment: '반품배송비가 결제 금액 이상이라 차감하지 않고 결제 금액 전액을 환불합니다.',
  partial_cancel_unavailable: '결제사가 이 결제의 부분 취소를 받지 않아 차감하지 않고 결제 금액 전액을 환불했습니다.',
};

/**
 * 차감하지 않는 단순 변심 반품의 운영 안내. 반품배송비는 기존 배송비 청구 원장으로 따로 받는다(이중 청구가 아니면).
 * 차감하는 건이면 null.
 */
export function returnFeeDeductionSkippedNotice(deduction: ReturnFeeDeduction | null): string | null {
  if (!deduction || deduction.applicable || !deduction.reason) return null;
  const base = REASON_COPY[deduction.reason];
  if (deduction.reason === 'claim_fee_invoiced') return base;
  return `${base} 반품배송비 ${krwAmountWords(deduction.deductionAmount)}(${returnFeeDeductionBasisLabel(deduction)})는 필요하면 배송비 청구로 따로 받으세요.`;
}

/** 일괄 환불 확인창의 행 꼬리. 예: '반품배송비 3,000원 차감'. */
export function returnFeeDeductionRowNote(deductionAmount: number | null | undefined) {
  return deductionAmount ? `반품배송비 ${krwAmountWords(deductionAmount)} 차감` : null;
}

/* ---- 구매자 ------------------------------------------------------------------------------------------------- */

export interface MyOrderRefundDeduction {
  state: ReturnFeeDeductionState;
  paymentAmount: number;
  deductionAmount: number;
  refundAmount: number;
  basis: 'one_way' | 'round_trip';
  oneWayAmount: number;
  /** 결제수단(toss·bank_transfer). 옛 응답에는 없을 수 있다 — 없으면 카드 문구를 쓴다. */
  provider: string | null;
}

/** get_my_order_claim_refund_deduction 응답. 결정이 없거나 모양이 어긋나면 null. */
export function parseMyOrderRefundDeduction(value: unknown): MyOrderRefundDeduction | null {
  if (!record(value)) return null;
  const state = typeof value.state === 'string' && (RETURN_FEE_DEDUCTION_STATES as readonly string[]).includes(value.state)
    ? value.state as ReturnFeeDeductionState : null;
  const paymentAmount = amount(value.paymentAmount, 1);
  const deductionAmount = amount(value.deductionAmount, 1);
  const refundAmount = amount(value.refundAmount, 1);
  const oneWayAmount = amount(value.oneWayAmount, 1);
  const basis = value.basis === 'one_way' || value.basis === 'round_trip' ? value.basis : null;
  if (!state || paymentAmount === null || deductionAmount === null || refundAmount === null || oneWayAmount === null || !basis) return null;
  if (state !== 'not_applied' && refundAmount + deductionAmount !== paymentAmount) return null;
  if (state === 'not_applied' && refundAmount !== paymentAmount) return null;
  return { state, paymentAmount, deductionAmount, refundAmount, basis, oneWayAmount, provider: typeof value.provider === 'string' ? value.provider : null };
}

/** 구매자 주문 상세 문구. 차감을 정한 뒤부터 보인다. */
export function myOrderRefundDeductionCopy(deduction: MyOrderRefundDeduction): { title: string; body: string } {
  const basis = deduction.basis === 'round_trip'
    ? `최초 무료배송 주문이라 왕복 반품배송비(편도 ${krwAmountWords(deduction.oneWayAmount)} × 2)`
    : `반품배송비(편도 ${krwAmountWords(deduction.oneWayAmount)})`;
  if (deduction.state === 'not_applied') {
    return {
      title: `결제 금액 ${krwAmountWords(deduction.refundAmount)} 전액 환불`,
      body: '결제 수단이 부분 취소를 지원하지 않아 반품배송비를 빼지 않고 결제 금액 전액을 환불했습니다.',
    };
  }
  const done = deduction.state === 'applied';
  const tail = deduction.provider === 'bank_transfer'
    ? '환불은 등록하신 환불계좌로 송금해 드립니다.'
    : '카드 부분 취소는 카드사 처리에 영업일 기준 3~4일이 걸릴 수 있습니다.';
  return {
    title: `반품배송비 ${krwAmountWords(deduction.deductionAmount)} 차감, 환불 ${krwAmountWords(deduction.refundAmount)}`,
    body: `단순 변심 반품이라 결제 금액 ${krwAmountWords(deduction.paymentAmount)}에서 ${basis}를 뺀 금액을 ${done ? '환불했습니다' : '환불합니다'}. ${tail}`,
  };
}

/* ---- 공개 정책(접수 안내) ------------------------------------------------------------------------------------ */

export interface ReturnFeeDeductionPolicy {
  enabled: boolean;
  oneWayAmount: number | null;
}

/** get_return_fee_deduction_policy 응답. 모양이 어긋나면 꺼진 것으로 읽는다 — 약속하지 않은 차감을 안내하지 않는다. */
export function parseReturnFeeDeductionPolicy(value: unknown): ReturnFeeDeductionPolicy {
  if (!record(value) || value.enabled !== true) return { enabled: false, oneWayAmount: null };
  const oneWayAmount = amount(value.oneWayAmount, 1);
  return oneWayAmount === null ? { enabled: false, oneWayAmount: null } : { enabled: true, oneWayAmount };
}
