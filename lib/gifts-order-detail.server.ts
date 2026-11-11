import 'server-only';
import { createClient } from './supabase/server';
import { loadGifts } from './gifts.server';
import type { GiftCheckoutOrderResult } from './gifts-order.server';
import { isOrderCancellationRequestStatus, isOrderDetailStatus, summarizeOrderItems, type OrderCancellationRequestSummary, type OrderDetail, type OrderListItem } from './orders';
import { isOrderClaimStage, isOrderClaimType } from './orders/claims';
import { transactionExactKeys, transactionInstant, transactionInteger, transactionRecord } from './goods-transaction-values';
import { isUuid } from './uuid';

function parseSafeClaim(value: unknown): OrderCancellationRequestSummary | null {
  if (value === null) return null;
  if (!transactionRecord(value) || !transactionExactKeys(value, ['id', 'status', 'claimType', 'stage', 'reference', 'requestedAt', 'decidedAt', 'decisionNote', 'reshipCarrier', 'reshipTrackingNumber', 'reshipDeliveredAt'])
    || typeof value.id !== 'string' || !isUuid(value.id) || !isOrderCancellationRequestStatus(String(value.status)) || !isOrderClaimType(value.claimType) || !isOrderClaimStage(value.stage)
    || !transactionInteger(value.reference) || !transactionInstant(value.requestedAt) || !(value.decidedAt === null || transactionInstant(value.decidedAt))
    || !(value.reshipDeliveredAt === null || transactionInstant(value.reshipDeliveredAt))
    || value.decisionNote !== null || value.reshipCarrier !== null || value.reshipTrackingNumber !== null) throw new Error('gift_claim_projection_invalid');
  return { id: value.id, status: value.status as OrderCancellationRequestSummary['status'], claimType: value.claimType, stage: value.stage, reference: value.reference,
    requestedAt: value.requestedAt, decidedAt: value.decidedAt, decisionNote: null, reshipCarrier: null, reshipTrackingNumber: null, reshipDeliveredAt: value.reshipDeliveredAt };
}

export async function loadGiftOrderList(includePending: boolean): Promise<OrderListItem[]> {
  const orders: OrderListItem[] = []; let cursor: { createdAt: string; id: string } | undefined;
  for (;;) {
    const page = await loadGifts('sender', cursor);
    for (const gift of page.items) {
      const order = gift.order; if (!order || !isOrderDetailStatus(order.status) || order.total === null || !order.paymentMethod) continue;
      // Gift pending orders remain visible as an obligation after acceptance.
      if (!includePending && order.status === 'pending') continue;
      const summary = summarizeOrderItems(gift.items);
      orders.push({ id: order.id, ...(order.orderNumber ? { orderNumber: order.orderNumber } : {}), giftId: gift.id, status: order.status, total: order.total, createdAt: order.createdAt, itemLabel: summary.label, itemCount: summary.itemCount, paymentMethod: order.paymentMethod });
    }
    if (!page.hasMore) return withGiftClaims(orders);
    const last = page.items.at(-1);
    if (!last || last.id === cursor?.id) throw new Error('gift_history_cursor_invalid');
    cursor = { createdAt: last.createdAt, id: last.id };
  }
}

/* 선물 주문도 목록 배지를 상세와 같은 규칙으로 보인다(10/14 회의 S20). 선물 클레임은 직접 SELECT가
   아니라 보낸 사람 전용 투영 get_my_gift_latest_claim으로만 읽는다 — 상세와 같은 RPC·같은 파서다. */
async function withGiftClaims(orders: OrderListItem[]): Promise<OrderListItem[]> {
  if (!orders.length) return orders;
  const client = await createClient();
  const claims = await Promise.all(orders.map((order) => client.rpc('get_my_gift_latest_claim', { p_order_id: order.id })));
  return orders.map((order, index) => {
    const { data, error } = claims[index];
    if (error) throw new Error('gift_claim_history_failed');
    const claim = parseSafeClaim(data);
    return { ...order, claim: claim ? { claimType: claim.claimType, stage: claim.stage } : null };
  });
}

export async function loadGiftOrderDetail(userId: string, result: Extract<GiftCheckoutOrderResult, { kind: 'gift' }>): Promise<OrderDetail> {
  const { order } = result; if (!isOrderDetailStatus(order.status)) throw new Error('gift_order_status_invalid');
  const client = await createClient();
  const [payments, tickets, claims, eligibility] = await Promise.all([
    client.from('payment_summaries').select('id,amount,status,created_at').eq('user_id', userId).eq('purpose', 'order').eq('ref_id', order.id).order('created_at', { ascending: false }).order('id', { ascending: false }),
    client.from('draw_tickets').select('consumed_at,revoked_at').eq('user_id', userId).eq('source', 'order_paid').eq('source_id', order.id),
    client.rpc('get_my_gift_latest_claim', { p_order_id: order.id }), client.rpc('order_claim_eligibility', { p_order_id: order.id }),
  ]);
  if (payments.error || tickets.error || claims.error) throw new Error('gift_order_history_failed');
  const paymentRows = payments.data ?? [], ticketRows = tickets.data ?? [], payment = paymentRows[0];
  const claimEligibility = transactionRecord(eligibility.data) && !eligibility.error && ['cancel', 'return', 'exchange'].every(key => typeof eligibility.data[key] === 'boolean')
    ? { cancel: eligibility.data.cancel as boolean, return: eligibility.data.return as boolean, exchange: eligibility.data.exchange as boolean } : null;
  let refund: OrderDetail['refund'] = null;
  if (paymentRows.length) {
    const refunds = await client.from('refunds').select('status,created_at').in('payment_id', paymentRows.map(row => row.id)).order('created_at', { ascending: false }).limit(1).maybeSingle();
    if (refunds.error) throw new Error('gift_refund_history_failed');
    if (refunds.data) refund = { status: refunds.data.status, createdAt: refunds.data.created_at };
  }
  return { ...order, status: order.status, deliveredAt: order.deliveredAt, claimEligibility,
    payment: payment ? { amount: payment.amount, status: payment.status, createdAt: payment.created_at } : null,
    refund, cancellationRequest: parseSafeClaim(claims.data), cardPacks: { issuedCount: ticketRows.length, availableCount: ticketRows.filter(row => row.consumed_at === null && row.revoked_at === null).length } };
}
