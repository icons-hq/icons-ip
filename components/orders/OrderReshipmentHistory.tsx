import { formatOrderDateTime } from '@/lib/orders';
import type { OrderReshipmentReceipt } from '@/lib/orders/reshipment-items';

export function OrderReshipmentHistory({ receipts }: { receipts: readonly OrderReshipmentReceipt[] }) {
  if (!receipts.length) return null;
  return <section className="order-claim-type-history" aria-label="교환 출고 굿즈 이력">
    <h3>교환으로 받은 굿즈</h3>
    <ol>{receipts.map(receipt => <li key={receipt.claimId}>
      <time dateTime={receipt.reshippedAt}>{formatOrderDateTime(receipt.reshippedAt)}</time>
      {receipt.items.map(item => <p key={item.orderItemId}>{item.name} · {item.variantName} · {item.qty}개</p>)}
    </li>)}</ol>
  </section>;
}
