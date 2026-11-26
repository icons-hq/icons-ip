import type { AdminConfirmRequest } from './confirm';
import type { AdminOrderRecord } from './orders';
import { objectParticle } from '@/lib/korean-particle';
import { orderReferenceLabel } from '@/lib/orders';
import { automatedCancelProviderLabel, providerCancelsAutomatically } from '@/lib/payments/provider-capabilities';

/*
 * 주문 처리 확인창의 문구(주문통합검색·상품주문별 조회·발송관리가 같은 말을 쓴다).
 *
 * 돈·재고·출고가 움직이는 버튼은 누르기 전에 "어느 주문인지(번호·구매자)"와 "얼마인지"를 말한다. 주문 처리 패널이 목록 위에 떠 있어
 * 다른 주문을 누를 수 있기 때문이다. 확인창의 금액은 화면이 이미 받은 값이고, 처리 쪽 계산(DB의 환불 금액)은 바꾸지 않는다.
 * 취소하는 쪽 버튼 이름은 하는 일을 말하고, 닫는 버튼은 '돌아가기'다(docs/admin-copy-guide.md).
 */

/** 확인창의 닫는 버튼. */
export const ADMIN_CONFIRM_BACK = '돌아가기';

/** 발주확인 뒤의 일. 자동 발주확인 설정 화면의 안내와 같은 사실이다(발주확인 전까지만 고객이 직접 취소한다). */
export const ADMIN_ORDER_CONFIRM_CONSEQUENCE = '발주확인 뒤에는 고객이 직접 취소할 수 없습니다.';

/**
 * 결제 전액 취소의 금액은 결제 금액에서 재고 부족 부분 취소로 이미 돌려준 금액을 뺀 값이다(DB가 계산한다).
 * 목록은 부분 취소 금액을 받지 않으므로, 확인창이 이 사실을 말해 금액이 더 적을 수 있다는 것을 알린다.
 */
export const ADMIN_PARTIAL_REFUND_NOTE = '재고 부족 부분 취소로 이미 환불한 금액이 있으면 그만큼 뺀 나머지만 취소합니다.';

/** 가상계좌 결제의 환불은 고객의 환불 계좌로 나간다. 계좌가 아직 없으면 결제 취소가 멈추고 고객에게 계좌를 묻는 알림이 간다. */
export const ADMIN_VIRTUAL_ACCOUNT_REFUND_NOTE = '가상계좌 결제는 고객의 환불 계좌로 환불합니다. 환불 계좌가 아직 없으면 취소가 멈추고 고객에게 계좌를 묻는 알림이 갑니다.';

const money = (value: number) => `₩${Math.trunc(Number.isFinite(value) ? value : 0).toLocaleString('ko-KR')}`;

type OrderIdentity = Pick<AdminOrderRecord, 'id' | 'orderNumber' | 'buyerName' | 'total'>;

/** `주문 번호 · 구매자 · 금액` — 확인창 맨 윗줄. */
export function adminOrderIdentityLine(order: OrderIdentity, amount: number = order.total): string {
  return `주문 ${orderReferenceLabel(order.id, order.orderNumber)} · ${order.buyerName} · ${money(amount)}`;
}

/**
 * 결제사에서 취소할 금액의 기준: 결제완료(paid) 결제의 합. 결제완료 결제가 없으면 주문 금액이다.
 * 재고 부족 부분 취소로 이미 돌려준 금액은 목록이 모르므로 빼지 않는다(그 사실은 확인창이 따로 말한다).
 */
export function adminOrderCancelAmount(order: Pick<AdminOrderRecord, 'total' | 'payments'>): number {
  const paid = order.payments.filter((payment) => payment.status === 'paid');
  return paid.length ? paid.reduce((sum, payment) => sum + payment.amount, 0) : order.total;
}

/** 취소하는 결제사 이름. 결제완료 결제가 하나의 취소 가능한 결제사뿐일 때만 이름을 말하고, 아니면 null이다. */
export function adminOrderCancelProviderLabel(order: Pick<AdminOrderRecord, 'payments'>): string | null {
  const providers = [...new Set(order.payments.filter((payment) => payment.status === 'paid').map((payment) => payment.provider))];
  const [only] = providers;
  return providers.length === 1 && providerCancelsAutomatically(only) ? automatedCancelProviderLabel(only) : null;
}

/**
 * 취소하는 결제를 가리키는 이름: 결제사와, 알 수 있을 때 결제수단(가상계좌·계좌이체). 주문의 결제수단 값은 card·bank_transfer 둘뿐이라
 * 목록은 카드·가상계좌·계좌이체를 구분해 받지 않는다 — 가상계좌·계좌이체 정보가 같이 실려 온 주문(처리 패널의 주문)만 구분해 말하고,
 * 그 밖에는 결제사 이름만 말한다. 결제사도 정할 수 없으면 null이다.
 */
export function adminOrderCancelPaymentLabel(order: Pick<AdminOrderRecord, 'payments' | 'virtualAccount' | 'transferEscrow'>): string | null {
  const provider = adminOrderCancelProviderLabel(order);
  if (!provider) return null;
  const method = order.virtualAccount ? '가상계좌' : order.transferEscrow ? '계좌이체' : '';
  return method ? `${provider} ${method}` : provider;
}

/** 운영자 전액 취소. */
export function adminStaffCancelRequest(order: Pick<AdminOrderRecord, 'id' | 'orderNumber' | 'buyerName' | 'total' | 'payments' | 'virtualAccount' | 'transferEscrow'>): AdminConfirmRequest {
  const payment = adminOrderCancelPaymentLabel(order);
  return {
    title: '이 주문을 전액 취소할까요?',
    message: [
      adminOrderIdentityLine(order, adminOrderCancelAmount(order)),
      `${payment ? `${payment} ` : ''}결제를 전액 취소합니다. 되돌릴 수 없고, 재고·쿠폰·적립금이 돌아가며 구매자에게 취소 알림이 갑니다.`,
      ADMIN_PARTIAL_REFUND_NOTE,
      /* 가상계좌는 입금 뒤 환불이 고객 환불 계좌로만 나간다 — 계좌가 없으면 취소가 멈춰 그대로 되지 않는다(결제 취소 확정 실패 안내와 같은 사실). */
      ...(order.virtualAccount ? [ADMIN_VIRTUAL_ACCOUNT_REFUND_NOTE] : []),
    ].join('\n'),
    confirmLabel: '전액 취소',
    cancelLabel: ADMIN_CONFIRM_BACK,
    destructive: true,
  };
}

/** 구매자의 취소 요청 승인. 승인하면 결제 취소가 시작된다. */
export function adminCancelApproveRequest(order: Pick<AdminOrderRecord, 'id' | 'orderNumber' | 'buyerName' | 'total' | 'payments'>): AdminConfirmRequest {
  return {
    title: '취소 요청을 승인할까요?',
    message: [
      adminOrderIdentityLine(order, adminOrderCancelAmount(order)),
      '승인하면 결제 취소를 시작합니다. 결제 취소가 확인되면 주문이 취소되고 재고가 돌아갑니다.',
      ADMIN_PARTIAL_REFUND_NOTE,
    ].join('\n'),
    confirmLabel: '취소 승인',
    cancelLabel: ADMIN_CONFIRM_BACK,
    destructive: true,
  };
}

/** 구매자의 취소 요청 거부. 입력한 사유는 구매자의 취소 요청 화면에 그대로 보인다(components/orders/OrderCancellation). */
export function adminCancelRejectRequest(order: OrderIdentity): AdminConfirmRequest {
  return {
    title: '취소 요청을 거부할까요?',
    message: [
      adminOrderIdentityLine(order),
      '구매자의 취소 요청을 거부합니다. 입력한 사유가 구매자 화면에 그대로 보입니다.',
    ].join('\n'),
    confirmLabel: '취소 거부',
    cancelLabel: ADMIN_CONFIRM_BACK,
  };
}

/** 한 주문 발주확인. */
export function adminOrderConfirmRequest(order: OrderIdentity): AdminConfirmRequest {
  return {
    title: '이 주문을 발주확인할까요?',
    message: [adminOrderIdentityLine(order), ADMIN_ORDER_CONFIRM_CONSEQUENCE].join('\n'),
    confirmLabel: '발주확인',
    cancelLabel: ADMIN_CONFIRM_BACK,
  };
}

/** 선택한 주문 일괄 발주확인(건수). `extra`는 화면마다 덧붙이는 한 문장(상품주문별 조회: 같은 주문의 다른 품목도 함께 처리됨). */
export function adminBulkOrderConfirmRequest(count: number, extra?: string): AdminConfirmRequest {
  const n = count.toLocaleString('ko-KR');
  return {
    title: `신규주문 ${n}건을 발주확인할까요?`,
    message: [extra, ADMIN_ORDER_CONFIRM_CONSEQUENCE].filter(Boolean).join(' '),
    confirmLabel: `${n}건 발주확인`,
    cancelLabel: ADMIN_CONFIRM_BACK,
  };
}

/** 결제 취소 상태 다시 확인([상태 다시 확인]·[처리 상태 확인]). 결제사에서 취소가 확인되면 주문 취소와 재고 복원이 끝난다. */
export function adminCancelRecheckRequest(order: OrderIdentity, buttonLabel: string): AdminConfirmRequest {
  return {
    title: '결제 취소 상태를 다시 확인할까요?',
    message: [
      adminOrderIdentityLine(order),
      '결제사에서 취소가 끝났는지 다시 확인합니다. 취소가 확인되면 주문 취소와 재고 복원이 끝납니다.',
    ].join('\n'),
    confirmLabel: buttonLabel,
    cancelLabel: ADMIN_CONFIRM_BACK,
  };
}

/**
 * Korpay 전액 취소 반영. 확인란 대신 이 확인창이 "결제사 원장에서 직접 확인했는가"를 묻는다 — 서버 액션은 확인 값(`operatorAttestation`)을
 * 그대로 요구하므로 화면이 이 확인창을 통과했을 때만 그 값을 보낸다.
 */
export function adminKorpayRecoveryRequest(attempt: { providerOrderId: string; amount: number; currency: string }): AdminConfirmRequest {
  return {
    title: '코페이 원장에서 전액 취소를 확인하셨나요?',
    message: [
      `코페이 주문 ${attempt.providerOrderId} · ${money(attempt.amount)} ${attempt.currency}`,
      '이 결제가 코페이 원장에서 전액 취소된 것을 직접 확인한 경우에만 반영합니다. 반영하면 확인된 결제에는 환불 원장을 남기고, 주문 취소와 재고 복원을 바로 끝냅니다.',
    ].join('\n'),
    confirmLabel: '전액 취소 반영',
    cancelLabel: ADMIN_CONFIRM_BACK,
    destructive: true,
  };
}

/* ---------------------------------------------------------------------------
 * 운송장 확인창. 고객 주문 상세의 배송조회가 바뀌므로 어느 배송 건의 어느 번호가 어떻게 바뀌는지를 말한다.
 * ------------------------------------------------------------------------- */

/** 배송 건의 대표 운송장 수정. */
export function adminTrackingEditRequest(reference: string): AdminConfirmRequest {
  return {
    title: '운송장을 수정할까요?',
    message: `배송 건 ${reference}의 운송장을 바꿉니다. 고객 주문 상세의 배송조회가 바뀐 번호로 열리고, 바꾼 내용이 감사 기록에 남습니다.`,
    confirmLabel: '운송장 수정',
    cancelLabel: ADMIN_CONFIRM_BACK,
  };
}

/** 두 배송 건의 대표 운송장을 서로 바꾼다. */
export function adminTrackingSwapRequest(input: { reference: string; trackingNumber: string; otherReference: string; otherTrackingNumber: string }): AdminConfirmRequest {
  return {
    title: '운송장을 맞바꿀까요?',
    message: [
      '두 배송 건의 운송장을 서로 바꿉니다.',
      `이 배송 건 ${input.reference}: ${input.trackingNumber} → ${input.otherTrackingNumber}`,
      `상대 배송 건 ${input.otherReference}: ${input.otherTrackingNumber} → ${input.trackingNumber}`,
      '고객 주문 상세의 배송조회가 바뀐 번호로 열리고, 두 배송 건 모두 감사 기록에 사유가 남습니다.',
    ].join('\n'),
    confirmLabel: '맞바꾸기',
    cancelLabel: ADMIN_CONFIRM_BACK,
  };
}

/** 다른 주문이 쓰는 번호를 창고에서 같은 상자로 확인해 등록한다. */
export function adminTrackingDuplicateRequest(input: { reference: string; carrierLabel: string; trackingNumber: string }): AdminConfirmRequest {
  const number = `${input.carrierLabel} ${input.trackingNumber}`;
  return {
    title: '다른 주문과 같은 운송장으로 등록할까요?',
    message: [
      `배송 건 ${input.reference}에 ${number}${objectParticle(input.trackingNumber)} 등록합니다.`,
      '이 번호는 다른 주문의 배송 건에 이미 등록돼 있어, 두 주문의 고객이 같은 배송조회를 보게 되고 택배 추적의 배송완료도 함께 따라갑니다.',
      '창고에 같은 상자로 확인한 경우에만 진행하세요. 사유가 감사 기록에 남습니다.',
    ].join('\n'),
    confirmLabel: '중복 확인 후 등록',
    cancelLabel: ADMIN_CONFIRM_BACK,
  };
}

/** 추가 운송장 한 개 지우기. 지우면 고객 주문 상세에서도 그 번호가 빠진다. */
export function adminExtraTrackingRemoveRequest(input: { reference: string; label: string }): AdminConfirmRequest {
  return {
    title: '추가 운송장을 지울까요?',
    message: [
      `배송 건 ${input.reference}의 추가 운송장 ${input.label}${objectParticle(input.label)} 지웁니다.`,
      '고객 주문 상세에서도 이 번호가 빠지고, 지운 사유가 감사 기록에 남습니다.',
    ].join('\n'),
    confirmLabel: '추가 운송장 지우기',
    cancelLabel: ADMIN_CONFIRM_BACK,
    destructive: true,
  };
}
