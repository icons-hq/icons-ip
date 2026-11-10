import { beforeEach, expect, it, vi } from 'vitest';
import { loadAdminClaimDetail } from './claims.server';
import { transactionDisplay, transactionLineId, transactionOrder, transactionQuoteId } from '@/test/fixtures/cart-transaction';
const mocks = vi.hoisted(() => ({ rpc: vi.fn(), transactions: vi.fn() }));
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({ rpc: mocks.rpc }) }));
vi.mock('@/lib/order-transactions.server', () => ({ loadAdminOrderTransactions: mocks.transactions }));
const line = transactionDisplay.lines[0];
function payload() { return { claim: { id: transactionQuoteId, orderId: transactionOrder },
  gift: { giftId: transactionOrder, requesterRole: 'recipient', requesterName: '받는분 별명' },
  order: { id: transactionOrder, total: 16000, items: [{ id: transactionLineId, variantId: line.variantId, name: '상품', qty: line.qty, unitPrice: line.unitPrice }] } }; }
beforeEach(() => { mocks.rpc.mockReset(); mocks.transactions.mockReset(); mocks.transactions.mockResolvedValue(new Map([[transactionOrder, { orderId: transactionOrder, quoteId: transactionQuoteId, display: transactionDisplay }]])); });
it('binds actual requester and original receipt by immutable item identity', async () => {
  mocks.rpc.mockResolvedValue({ data: payload(), error: null });
  const result = await loadAdminClaimDetail(transactionQuoteId);
  expect(result?.gift).toEqual(payload().gift); expect(result?.order?.transaction?.totals.collectShippingTotal).toBe(3000);
});
it('rejects extra private requester fields and mismatched financial rows', async () => {
  const value = payload();
  mocks.rpc.mockResolvedValue({ data: { ...value, gift: { ...value.gift, recipientEmail: 'private@example.test' } }, error: null });
  await expect(loadAdminClaimDetail(transactionQuoteId)).rejects.toThrow('requester');
  mocks.rpc.mockResolvedValue({ data: { ...value, order: { ...value.order, total: 19000 } }, error: null });
  await expect(loadAdminClaimDetail(transactionQuoteId)).rejects.toThrow('transaction snapshot');
});

it('preserves distinct purchased, currently allocated and actually shipped product names', async () => {
  const value = payload();
  mocks.rpc.mockResolvedValue({ data: { ...value,
    claim: { ...value.claim, reshippedItems: [{ orderItemId: transactionLineId, goodId: 'replacement', originalGoodId: 'original', name: '교환 실물', variantId: line.variantId, variantName: '기본', variantCode: 'NEW', qty: 2 }] },
    order: { ...value.order, items: [{ ...value.order.items[0], goodId: 'original', currentGoodId: 'replacement', currentVariantId: line.variantId,
      options: [{ id: line.variantId, goodId: 'replacement', goodName: '교환 실물', name: '기본', code: 'NEW', stockQty: 0 }] }] },
  }, error: null });
  const result = await loadAdminClaimDetail(transactionQuoteId);
  expect(result?.order?.items[0]).toMatchObject({ goodId: 'original', currentGoodId: 'replacement', name: '상품', options: [{ goodId: 'replacement', goodName: '교환 실물' }] });
  expect(result?.claim.reshippedItems?.[0]).toMatchObject({ goodId: 'replacement', originalGoodId: 'original', name: '교환 실물' });
});
