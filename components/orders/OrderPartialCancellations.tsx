import { formatOrderDateTime } from '@/lib/orders';
import { orderPartialCancellationSummary, type OrderPartialCancellationRecord } from '@/lib/orders/partial-cancellation';

function status(record: OrderPartialCancellationRecord) {
  if (record.provider === 'bank_transfer') return record.state === 'completed' ? '환불계좌로 송금 완료' : '등록하신 환불계좌로 송금 예정';
  return '결제사 부분 취소 완료 · 카드사 처리에 영업일 기준 3~4일이 걸릴 수 있어요';
}

/**
 * 구매자 주문 상세의 재고 부족 부분 취소 표시(QNA-020, ADR-0032). 적용된 부분 취소가 있을 때만 그린다 — 없으면(스위치 OFF 포함)
 * 아무것도 그리지 않아 주문 상세는 지금 그대로다.
 */
export function OrderPartialCancellations({ records }: { records: readonly OrderPartialCancellationRecord[] }) {
  if (!records.length) return null;
  return (
    <section aria-labelledby="order-partial-cancellation-heading" className="order-claim-type-history" data-order-partial-cancellations={records.length}>
      <h3 id="order-partial-cancellation-heading">일부 취소</h3>
      <p>재고가 부족해 고객님과 확인한 대로 일부 굿즈를 취소했어요. 나머지 굿즈는 그대로 보내드려요.</p>
      <ol>
        {records.map((record) => (
          <li data-order-partial-cancellation={record.state} key={record.id}>
            <strong>{orderPartialCancellationSummary(record)}</strong>
            <span> · {status(record)}</span>
            {record.appliedAt ? <> · <time dateTime={record.appliedAt}>{formatOrderDateTime(record.appliedAt)}</time></> : null}
          </li>
        ))}
      </ol>
    </section>
  );
}
