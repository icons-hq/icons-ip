import { formatOrderDateTime } from '@/lib/orders';
import { orderPartialCancellationSummary, type OrderPartialCancellationRecord } from '@/lib/orders/partial-cancellation';

function status(record: OrderPartialCancellationRecord) {
  if (record.provider === 'bank_transfer') return record.state === 'completed' ? '환불계좌로 송금 완료' : '등록하신 환불계좌로 송금 예정';
  return '결제사 부분 취소 완료 · 카드사 처리에 영업일 기준 3~4일이 걸릴 수 있어요';
}

function RecordList({ records }: { records: readonly OrderPartialCancellationRecord[] }) {
  return (
    <ol>
      {records.map((record) => (
        <li data-order-partial-cancellation={record.state} key={record.id}>
          <strong>{orderPartialCancellationSummary(record)}</strong>
          <span> · {status(record)}</span>
          {(() => {
            /* '송금 완료'는 송금한 시각을, 나머지는 부분 취소를 적용한 시각을 말한다(QA2: 송금 완료 옆에 적용 시각이 나왔다). */
            const at = record.provider === 'bank_transfer' && record.state === 'completed' ? record.transferredAt ?? record.completedAt ?? record.appliedAt : record.appliedAt;
            return at ? <> · <time dateTime={at}>{formatOrderDateTime(at)}</time></> : null;
          })()}
        </li>
      ))}
    </ol>
  );
}

/**
 * 구매자 주문 상세의 재고 부족 부분 취소 표시(QNA-020, ADR-0032)와 부분 반품 환불 표시(ADR-0047). 같은 부분 환불 원장이고 적용된 건만
 * 서버가 돌려준다 — 없으면(스위치 OFF 포함) 아무것도 그리지 않아 주문 상세는 지금 그대로다.
 */
export function OrderPartialCancellations({ records }: { records: readonly OrderPartialCancellationRecord[] }) {
  const stockout = records.filter((record) => record.reasonCode !== 'return');
  const returns = records.filter((record) => record.reasonCode === 'return');
  if (!records.length) return null;
  return (
    <>
      {stockout.length ? (
        <section aria-labelledby="order-partial-cancellation-heading" className="order-claim-type-history" data-order-partial-cancellations={stockout.length}>
          <h3 id="order-partial-cancellation-heading">일부 취소</h3>
          <p>재고가 부족해 고객님과 확인한 대로 일부 상품을 취소했어요. 나머지 상품은 그대로 보내드려요.</p>
          <RecordList records={stockout} />
        </section>
      ) : null}
      {returns.length ? (
        <section aria-labelledby="order-partial-return-heading" className="order-claim-type-history" data-order-partial-returns={returns.length}>
          <h3 id="order-partial-return-heading">일부 반품</h3>
          <p>반품하신 상품의 확인을 마치고 그 몫을 환불했어요. 나머지 상품은 그대로 유지돼요.</p>
          <RecordList records={returns} />
        </section>
      ) : null}
    </>
  );
}
