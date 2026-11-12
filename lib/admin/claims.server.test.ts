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

/* QA2 B1: 부분 취소된 버전 2 주문. 영수증 줄(수량 2)을 상세 품목의 살아 있는 수량과 '2 − 부분 취소 수량'으로 맞춘다. */
it('loads a partially canceled claim against the receipt (original qty minus applied partial cancels)', async () => {
  const value = payload();
  mocks.rpc.mockResolvedValue({ data: { ...value, order: { ...value.order, items: [{ ...value.order.items[0], qty: 1 }],
    partialCancels: [{ orderItemId: transactionLineId, canceledQty: 1 }] } }, error: null });
  expect((await loadAdminClaimDetail(transactionQuoteId))?.order?.items[0].qty).toBe(1);
  /* 모두 취소된 품목은 상세에서 빠지고 부분 취소 수량으로만 남는다. */
  mocks.rpc.mockResolvedValue({ data: { ...value, order: { ...value.order, items: [], partialCancels: [{ orderItemId: transactionLineId, canceledQty: 2 }] } }, error: null });
  expect((await loadAdminClaimDetail(transactionQuoteId))?.order?.items).toEqual([]);
});

it('keeps blocking a real receipt mismatch with a typed reason', async () => {
  const value = payload();
  mocks.rpc.mockResolvedValue({ data: { ...value, order: { ...value.order, items: [{ ...value.order.items[0], qty: 1 }] } }, error: null });
  await expect(loadAdminClaimDetail(transactionQuoteId)).rejects.toMatchObject({ code: 'transaction_snapshot_mismatch' });
  mocks.rpc.mockResolvedValue({ data: { ...value, order: { ...value.order, items: [{ ...value.order.items[0], qty: 1 }],
    partialCancels: [{ orderItemId: transactionLineId, canceledQty: 2 }] } }, error: null });
  await expect(loadAdminClaimDetail(transactionQuoteId)).rejects.toMatchObject({ code: 'transaction_snapshot_mismatch' });
  mocks.rpc.mockResolvedValue({ data: { ...value, order: { ...value.order, partialCancels: 'broken' } }, error: null });
  await expect(loadAdminClaimDetail(transactionQuoteId)).rejects.toMatchObject({ code: 'transaction_snapshot_mismatch' });
  mocks.rpc.mockResolvedValue({ data: value, error: null });
  mocks.transactions.mockRejectedValue(new Error('order_transaction_receipts_unavailable'));
  await expect(loadAdminClaimDetail(transactionQuoteId)).rejects.toMatchObject({ code: 'transaction_receipt_unavailable' });
  mocks.rpc.mockResolvedValue({ data: null, error: { message: 'operator_capability_required', code: '42501' } });
  await expect(loadAdminClaimDetail(transactionQuoteId)).rejects.toMatchObject({ code: 'claim_access_denied' });
});

it('does not reconcile version 1 orders without a receipt (T12c partial cancels stay readable)', async () => {
  const value = payload();
  mocks.transactions.mockResolvedValue(new Map([[transactionOrder, null]]));
  mocks.rpc.mockResolvedValue({ data: { ...value, order: { ...value.order, items: [{ ...value.order.items[0], qty: 1 }],
    partialCancels: [{ orderItemId: transactionLineId, canceledQty: 1 }] } }, error: null });
  expect((await loadAdminClaimDetail(transactionQuoteId))?.order?.transaction).toBeUndefined();
});
