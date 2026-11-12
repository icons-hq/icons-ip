import { myOrderRefundDeductionCopy, type MyOrderRefundDeduction } from '@/lib/claims/return-fee-deduction';
import { krw } from '@/lib/format';

/**
 * 구매자 주문 상세의 반품배송비 차감 표시(QNA-033, ADR-0031). 환불 접수 때 정한 결정이 있을 때만 그린다 —
 * 결정이 없으면(스위치 OFF·하자 반품·취소) 아무것도 그리지 않아 주문 상세는 지금 그대로다.
 */
export function OrderRefundDeduction({ deduction }: { deduction: MyOrderRefundDeduction | null }) {
  if (!deduction) return null;
  const copy = myOrderRefundDeductionCopy(deduction);
  return (
    <section aria-labelledby="order-refund-deduction-heading" className="order-claim-type-history" data-order-refund-deduction={deduction.state}>
      <h3 id="order-refund-deduction-heading">{copy.title}</h3>
      <p>{copy.body}</p>
      {deduction.state !== 'not_applied' ? (
        <dl aria-label="환불 금액" className="order-refund-summary">
          <div>
            <dt>결제 금액</dt>
            <dd className="mono">{krw(deduction.paymentAmount)}</dd>
          </div>
          <div>
            <dt>반품배송비 차감</dt>
            <dd className="mono">−{krw(deduction.deductionAmount)}</dd>
          </div>
          <div>
            <dt>환불 금액</dt>
            <dd className="mono">{krw(deduction.refundAmount)}</dd>
          </div>
        </dl>
      ) : null}
    </section>
  );
}
