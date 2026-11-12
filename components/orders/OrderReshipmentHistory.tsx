import { formatOrderDateTime } from '@/lib/orders';
import type { OrderReshipmentParcelView, OrderReshipmentReceipt } from '@/lib/orders/reshipment-items';

/*
 * 교환으로 다시 보낸 굿즈(TKT-166·QNA-039).
 *
 * 교환 재출고는 배송 묶음마다 따로 나가 송장이 여러 개일 수 있다. 소포 목록(parcels)이 있으면 소포마다 택배사·운송장·
 * 배송조회와 도착 확인을 보이고, 교환이 끝나기 전에 먼저 보낸 소포도 바로 보인다. 회수 없이 다시 보낸 소포는 그렇게 안내한다.
 * 소포 목록을 받지 못하는 화면(선물함)은 예전처럼 교환으로 받은 굿즈만 보인다.
 */
export function OrderReshipmentHistory({ receipts, parcels }: { receipts: readonly OrderReshipmentReceipt[]; parcels?: readonly OrderReshipmentParcelView[] }) {
  if (parcels?.length) {
    return <section className="order-claim-type-history" aria-label="교환 배송" data-order-reshipment-parcels="">
      <h3>교환 배송{parcels.length > 1 ? ` ${parcels.length}건` : ''}</h3>
      <ol>{parcels.map((parcel, index) => <li key={`${parcel.claimId}:${parcel.reshipmentId ?? 'claim'}`}>
        <p>
          <strong>{parcels.length > 1 ? `교환 배송 ${index + 1} · ` : ''}{parcel.carrierLabel} </strong>
          <span className="mono">{parcel.trackingNumber}</span>
          {parcel.trackingUrl ? <>{' '}<a className="btn btn-ghost order-tracking-link" href={parcel.trackingUrl} rel="noreferrer" target="_blank">배송조회</a></> : null}
        </p>
        <p>
          <time dateTime={parcel.reshippedAt}>{formatOrderDateTime(parcel.reshippedAt)}</time> 발송
          {parcel.deliveredAt ? <> · <time dateTime={parcel.deliveredAt}>{formatOrderDateTime(parcel.deliveredAt)}</time> 도착 확인</> : ' · 배송 중'}
        </p>
        {parcel.collectionWaived ? <p>회수 없이 다시 보내드려요.</p> : null}
        {parcel.items.map(item => <p key={item.orderItemId}>{item.name} · {item.variantName} · {item.qty}개</p>)}
      </li>)}</ol>
    </section>;
  }
  if (!receipts.length) return null;
  return <section className="order-claim-type-history" aria-label="교환 출고 굿즈 이력">
    <h3>교환으로 받은 굿즈</h3>
    <ol>{receipts.map(receipt => <li key={receipt.claimId}>
      <time dateTime={receipt.reshippedAt}>{formatOrderDateTime(receipt.reshippedAt)}</time>
      {receipt.items.map(item => <p key={item.orderItemId}>{item.name} · {item.variantName} · {item.qty}개</p>)}
    </li>)}</ol>
  </section>;
}
