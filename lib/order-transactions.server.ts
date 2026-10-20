import 'server-only';
import { createClient } from './supabase/server';
import { createServiceClient } from './supabase/service';
import { parseCheckoutTransactionReceipt, type CheckoutTransactionReceipt } from './checkout-transaction';
import { transactionExactKeys, transactionRecord } from './goods-transaction-values';
import { isUuid } from './uuid';

export async function loadAdminOrderTransactions(orderIds: readonly string[]): Promise<Map<string, CheckoutTransactionReceipt | null>> {
  const ids = [...new Set(orderIds)], receipts = new Map<string, CheckoutTransactionReceipt | null>();
  if (!ids.length) return receipts;
  if (ids.some(id => !isUuid(id))) throw new Error('invalid_order_transaction_ids');
  const client = await createClient();
  for (let offset = 0; offset < ids.length; offset += 1000) {
    const batch = ids.slice(offset, offset + 1000), { data, error } = await client.rpc('admin_get_order_transaction_receipts', { p_order_ids: batch });
    if (error || !Array.isArray(data)) throw new Error('order_transaction_receipts_unavailable');
    for (const row of data) {
      if (!transactionRecord(row) || !transactionExactKeys(row, ['orderId', 'receipt']) || typeof row.orderId !== 'string'
        || !batch.includes(row.orderId) || receipts.has(row.orderId)) throw new Error('order_transaction_receipts_invalid');
      const receipt = row.receipt === null ? null : parseCheckoutTransactionReceipt(row.receipt);
      if (row.receipt !== null && (!receipt || receipt.orderId !== row.orderId)) throw new Error('order_transaction_receipts_invalid');
      receipts.set(row.orderId, receipt);
    }
    if (batch.some(id => !receipts.has(id))) throw new Error('order_transaction_receipts_incomplete');
  }
  return receipts;
}

export async function loadServiceOrderTransaction(orderId: string): Promise<CheckoutTransactionReceipt | null> {
  if (!isUuid(orderId)) throw new Error('invalid_order_transaction_id');
  const { data, error } = await createServiceClient().rpc('service_get_order_transaction_receipt', { p_order_id: orderId });
  if (error) throw new Error('order_transaction_receipt_unavailable');
  if (data === null) return null;
  const receipt = parseCheckoutTransactionReceipt(data);
  if (!receipt || receipt.orderId !== orderId) throw new Error('order_transaction_receipt_invalid');
  return receipt;
}
