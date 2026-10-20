import { purchaseMessageLabel, type PurchaseMessage } from '@/lib/product-detail-experiences';
export function ProductPurchaseMessages({ messages }: { messages: PurchaseMessage[] }) {
  if (!messages.length) return null;
  return <ul className="wc-pdp-purchase-messages" aria-label="굿즈 구매 실적">{messages.map(message => <li key={message.kind}>{purchaseMessageLabel(message)}</li>)}</ul>;
}
