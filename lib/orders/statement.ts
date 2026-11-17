import { krw } from '../format';
import { businessInfoRows, type BusinessInfo } from '../legal/business-info';
import { formatOrderDateTime, orderReferenceLabel, type OrderDetail, type OrderDetailStatus } from '../orders';
import { partialCancellationRefundTotal, type OrderPartialCancellationRecord } from './partial-cancellation';
import { orderReceiptAvailable, orderStatementAvailable } from './receipt';

/**
 * 거래명세서(MD-0038)의 순수 모델. 주문 한 건의 공급자·품목·금액을 확인·인쇄용으로 보여 준다. 세금계산서·현금영수증이
 * 아니므로 부가세 분리(공급가액·세액)는 계산하지 않고 '부가세 포함'만 적는다. 금액의 진실원은 서버 영수증
 * (`order.transaction`)이고 이 모듈은 화면용으로 줄 세울 뿐 새로 계산해 확정하지 않는다.
 */

export const STATEMENT_TITLE = '거래명세서';
export const STATEMENT_NOTICE_VAT = '모든 금액은 부가가치세가 포함된 금액입니다.';
export const STATEMENT_NOTICE_SCOPE = '이 거래명세서는 거래 내용 확인용이며 세금계산서·현금영수증을 대신하지 않습니다.';
export const STATEMENT_NOTICE_CARD_RECEIPT = '카드 매출전표는 주문 상세의 ‘결제 영수증’에서 확인할 수 있어요.';
export const STATEMENT_PENDING_MESSAGE = '결제가 완료된 주문만 거래명세서를 발급해요.';
export const STATEMENT_CANCELED_MESSAGE = '취소된 주문은 거래명세서를 발급하지 않아요.';
/** 옵션이 없거나 기본 옵션인 품목 줄의 옵션 칸. */
export const STATEMENT_NO_OPTION = '—';

const DEFAULT_OPTION_NAME = '기본 옵션';

/** 발급할 수 없는 주문 상태의 본문 안내. 발급할 수 있으면 null이다. */
export function statementUnavailableMessage(status: OrderDetailStatus): string | null {
  if (orderStatementAvailable(status)) return null;
  return status === 'canceled' ? STATEMENT_CANCELED_MESSAGE : STATEMENT_PENDING_MESSAGE;
}

export interface StatementInfoRow {
  label: string;
  value: string;
}

export interface StatementItemRow {
  key: string;
  name: string;
  /** 옵션명. 없음·기본 옵션은 '—', 랜덤 판매는 서버가 내려준 '랜덤'이다. */
  option: string;
  /** 주문 당시 수량(부분 취소가 있어도 원 수량 — 환불은 합계 표의 '부분 취소 환불'로 보인다). */
  qty: number;
  unitPrice: number;
  amount: number;
}

export interface StatementTotalRow {
  key: 'goods' | 'volume' | 'coupon' | 'credit' | 'shipping' | 'total' | 'partial_refund' | 'final';
  label: string;
  /** 항상 0 이상의 크기다. 부호는 `kind`가 정한다(`deduction`은 '−'를 붙여 그린다). */
  amount: number;
  kind: 'plain' | 'deduction' | 'total';
}

export interface OrderStatementModel {
  orderId: string;
  /** 발행일(KST) `2026년 11월 17일`. */
  issuedOn: string;
  orderNumber: string;
  /** 거래일시 = 주문일시. */
  tradedAt: string;
  paymentLabel: string;
  /** 공급자. 빈 값 행은 없다. */
  supplier: StatementInfoRow[];
  /** 공급받는자(주문자) 이름·이메일. */
  buyer: StatementInfoRow[];
  items: StatementItemRow[];
  totals: StatementTotalRow[];
  /** 착불 배송비가 있으면 받을 때 따로 결제한다는 한 줄. 없으면 null. */
  collectNotice: string | null;
  notices: string[];
}

export interface BuildOrderStatementInput {
  order: OrderDetail;
  partialCancellations: readonly Pick<OrderPartialCancellationRecord, 'refundAmount'>[];
  business: BusinessInfo;
  orderer: { name: string; email: string | null };
  paymentLabel: string;
  issuedAt: Date;
}

const formatIssuedOn = (date: Date) => new Intl.DateTimeFormat('ko-KR', {
  timeZone: 'Asia/Seoul',
  year: 'numeric',
  month: 'long',
  day: 'numeric',
}).format(date);

function optionLabel(value: string | null | undefined): string {
  const name = value?.trim();
  return !name || name === DEFAULT_OPTION_NAME ? STATEMENT_NO_OPTION : name;
}

/** 품목 줄. v2 주문은 서버 영수증 줄(lineId = order_items.id)의 단가를, 없으면 주문 품목의 단가를 쓴다. */
function itemRows(order: OrderDetail): StatementItemRow[] {
  const lines = new Map((order.transaction?.lines ?? []).map((line) => [line.lineId, line]));
  return order.items.map((item) => {
    const unitPrice = lines.get(item.id)?.unitPrice ?? item.unitPrice;
    return { key: item.id, name: item.name, option: optionLabel(item.variantName), qty: item.qty, unitPrice, amount: unitPrice * item.qty };
  });
}

interface StatementAmounts {
  goods: number;
  volume: number;
  coupon: number;
  credit: number;
  shipping: number;
  collect: number;
  total: number;
}

/**
 * 합계 표의 금액. v2는 서버 영수증 합계를 그대로 쓴다 — 배송비 쿠폰은 쿠폰 할인에 합치고 배송비는 쿠폰 차감 전 금액으로
 * 보여 표의 줄이 총 결제 금액과 산술로 맞는다(굿즈 합계 − 복수구매 − 쿠폰 − 적립금 + 배송비 = 총 결제 금액).
 * v1은 주문 스냅샷에서 굿즈 금액을 되돌려 복원한다(주문 상세와 같은 식).
 */
function statementAmounts(order: OrderDetail): StatementAmounts {
  const totals = order.transaction?.totals;
  if (totals) {
    const shippingCoupon = totals.shippingCouponDiscountTotal ?? 0;
    return {
      goods: totals.subtotal,
      volume: totals.volumeDiscountTotal,
      coupon: totals.couponDiscountTotal + shippingCoupon,
      credit: totals.storeCreditTotal,
      shipping: totals.prepaidShippingTotal + shippingCoupon,
      collect: totals.collectShippingTotal,
      total: totals.onlineTotal,
    };
  }
  return {
    goods: order.total - order.shippingFee + order.discountTotal + order.storeCreditTotal,
    volume: 0,
    coupon: order.discountTotal,
    credit: order.storeCreditTotal,
    shipping: order.shippingFee,
    collect: 0,
    total: order.total,
  };
}

/** 선결제 배송비 합에 섞인 설치비. 주문 영수증의 배송 묶음 구성요소 설치비 합이다(v1은 설치비가 없다). */
function installationFeeTotal(order: OrderDetail): number {
  return (order.transaction?.shipping ?? []).reduce((sum, group) => sum + group.components.reduce((inner, component) => inner + (component.installationFee ?? 0), 0), 0);
}

export function buildOrderStatement(input: BuildOrderStatementInput): OrderStatementModel {
  const { order, orderer } = input;
  const amounts = statementAmounts(order);
  const partialRefund = partialCancellationRefundTotal(input.partialCancellations);

  const totals: StatementTotalRow[] = [{ key: 'goods', label: '굿즈 합계', amount: amounts.goods, kind: 'plain' }];
  if (amounts.volume > 0) totals.push({ key: 'volume', label: '복수구매 할인', amount: amounts.volume, kind: 'deduction' });
  if (amounts.coupon > 0) totals.push({ key: 'coupon', label: '쿠폰 할인', amount: amounts.coupon, kind: 'deduction' });
  if (amounts.credit > 0) totals.push({ key: 'credit', label: '적립금 사용', amount: amounts.credit, kind: 'deduction' });
  /* 선결제 배송비에 설치비가 섞여 있으면 행 이름이 그것을 말한다 — 금액·합계 산술은 그대로다(주문 상세의 '선결제 배송·설치비'와 같은 말). */
  totals.push({ key: 'shipping', label: installationFeeTotal(order) > 0 ? '배송·설치비' : '배송비', amount: amounts.shipping, kind: 'plain' });
  totals.push({ key: 'total', label: '총 결제 금액', amount: amounts.total, kind: 'total' });
  if (partialRefund > 0) {
    totals.push({ key: 'partial_refund', label: '부분 취소 환불', amount: partialRefund, kind: 'deduction' });
    totals.push({ key: 'final', label: '최종 결제 금액', amount: Math.max(0, amounts.total - partialRefund), kind: 'total' });
  }

  /* 카드 매출전표 안내는 주문 상세의 '결제 영수증' 버튼이 실제로 있을 때만 말한다(같은 판정). */
  const receiptButton = orderReceiptAvailable({ paymentMethod: order.paymentMethod, payment: order.payment });

  return {
    orderId: order.id,
    issuedOn: formatIssuedOn(input.issuedAt),
    orderNumber: orderReferenceLabel(order.id, order.orderNumber),
    tradedAt: formatOrderDateTime(order.createdAt),
    paymentLabel: input.paymentLabel,
    supplier: businessInfoRows(input.business)
      .filter((row) => row.key !== 'hostingProvider')
      .map(({ label, value }) => ({ label, value })),
    buyer: [
      { label: '주문자', value: orderer.name },
      ...(orderer.email ? [{ label: '이메일', value: orderer.email }] : []),
    ],
    items: itemRows(order),
    totals,
    collectNotice: amounts.collect > 0 ? `착불 배송비 ${krw(amounts.collect)}은 받을 때 따로 결제해요.` : null,
    notices: [STATEMENT_NOTICE_VAT, STATEMENT_NOTICE_SCOPE, ...(receiptButton ? [STATEMENT_NOTICE_CARD_RECEIPT] : [])],
  };
}
