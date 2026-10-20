import { beforeEach, expect, it, vi } from 'vitest';
import { transactionDisplay, transactionOrder, transactionQuoteId } from '@/test/fixtures/cart-transaction';
import { loadAdminOrderTransactions, loadServiceOrderTransaction } from './order-transactions.server';
const mocks = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock('./supabase/server', () => ({ createClient: async () => ({ rpc: mocks.rpc }) }));
vi.mock('./supabase/service', () => ({ createServiceClient: () => ({ rpc: mocks.rpc }) }));
const receipt = { orderId: transactionOrder, quoteId: transactionQuoteId, display: transactionDisplay };
beforeEach(() => { mocks.rpc.mockReset(); });
it('reads strict original receipts and fails closed for missing, mismatched and extra fields', async () => {
  mocks.rpc.mockResolvedValue({ data: [{ orderId: transactionOrder, receipt }], error: null });
  expect((await loadAdminOrderTransactions([transactionOrder])).get(transactionOrder)).toEqual(receipt);
  for (const rows of [[], [{ orderId: transactionOrder, receipt: { ...receipt, address: 'private' } }], [{ orderId: transactionQuoteId, receipt }]]) {
    mocks.rpc.mockResolvedValue({ data: rows, error: null });
    await expect(loadAdminOrderTransactions([transactionOrder])).rejects.toThrow('order_transaction_receipts_');
  }
});
it('batches 1001 distinct orders and preserves explicit legacy null receipts', async () => {
  const ids = Array.from({ length: 1001 }, (_, i) => `82000000-0000-4000-8000-${String(i).padStart(12, '0')}`);
  mocks.rpc.mockImplementation(async (_name, args) => ({ data: args.p_order_ids.map((orderId: string) => ({ orderId, receipt: null })), error: null }));
  const rows = await loadAdminOrderTransactions(ids);
  expect(rows.size).toBe(1001); expect(mocks.rpc.mock.calls.map(call => call[1].p_order_ids.length)).toEqual([1000, 1]);
});
it('service receipt rejects another order and lookup errors', async () => {
  mocks.rpc.mockResolvedValue({ data: receipt, error: null });
  expect(await loadServiceOrderTransaction(transactionOrder)).toEqual(receipt);
  await expect(loadServiceOrderTransaction(transactionQuoteId)).rejects.toThrow('invalid');
  mocks.rpc.mockResolvedValue({ data: null, error: { message: 'unavailable' } });
  await expect(loadServiceOrderTransaction(transactionOrder)).rejects.toThrow('unavailable');
});
