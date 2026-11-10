import { transactionExactKeys, transactionInstant, transactionInteger, transactionRecord } from '@/lib/goods-transaction-values';
import { isUuid } from '@/lib/uuid';

export interface OrderReshipmentItem {
  orderItemId: string;
  goodId: string;
  name: string;
  variantId: string;
  variantName: string;
  variantCode: string;
  qty: number;
}
export interface OrderReshipmentReceipt {
  claimId: string;
  reshippedAt: string;
  items: OrderReshipmentItem[];
}

const label = (value: unknown, max: number): value is string => typeof value === 'string'
  && value.length > 0 && value.length <= max && !/[\u0000-\u001f\u007f]/.test(value);

/** Actual shipment snapshots; never substitute current catalog or purchase labels. */
export function parseOrderReshipmentHistory(value: unknown): OrderReshipmentReceipt[] | null {
  if (!Array.isArray(value) || value.length > 1000) return null;
  const claims = new Set<string>();
  for (const receipt of value) {
    if (!transactionRecord(receipt) || !transactionExactKeys(receipt, ['claimId', 'reshippedAt', 'items'])
      || !isUuid(receipt.claimId) || claims.has(receipt.claimId) || !transactionInstant(receipt.reshippedAt)
      || !Array.isArray(receipt.items) || !receipt.items.length || receipt.items.length > 1000) return null;
    claims.add(receipt.claimId);
    const items = new Set<string>();
    for (const item of receipt.items) {
      if (!transactionRecord(item) || !transactionExactKeys(item, ['orderItemId', 'goodId', 'name', 'variantId', 'variantName', 'variantCode', 'qty'])
        || !isUuid(item.orderItemId) || items.has(item.orderItemId) || !isUuid(item.variantId)
        || !label(item.goodId, 200) || !label(item.name, 200) || !label(item.variantName, 200) || !label(item.variantCode, 120)
        || !transactionInteger(item.qty) || item.qty < 1 || item.qty > 2147483647) return null;
      items.add(item.orderItemId);
    }
  }
  return value as OrderReshipmentReceipt[];
}
