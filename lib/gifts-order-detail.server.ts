import 'server-only';
import { createClient } from './supabase/server';
import { loadGifts } from './gifts.server';
import type { GiftCheckoutOrderResult } from './gifts-order.server';
import { isOrderCancellationRequestStatus, isOrderDetailStatus, summarizeOrderItems, type OrderCancellationRequestSummary, type OrderDetail, type OrderListItem } from './orders';
import { isOrderClaimStage, isOrderClaimType } from './orders/claims';
import { loadOrderLineViews, type OrderLineOrderInput } from './orders/order-lines.server';
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

export async function loadGiftOrderList(includePending: boolean, { withLines = false }: { withLines?: boolean } = {}): Promise<OrderListItem[]> {
  const orders: OrderListItem[] = []; let cursor: { createdAt: string; id: string } | undefined;
  /* 선물 목록 RPC는 품목 id·가격을 주지 않는다 — 품목 줄 입력은 선물 품목 스냅샷(굿즈·옵션 키)으로 만든다. */
  const lineInputs: OrderLineOrderInput[] = [];
  for (;;) {
    const page = await loadGifts('sender', cursor);
    for (const gift of page.items) {
      const order = gift.order; if (!order || !isOrderDetailStatus(order.status) || order.total === null || !order.paymentMethod) continue;
      // Gift pending orders remain visible as an obligation after acceptance.
      if (!includePending && order.status === 'pending') continue;
      const summary = summarizeOrderItems(gift.items);
      orders.push({ id: order.id, ...(order.orderNumber ? { orderNumber: order.orderNumber } : {}), giftId: gift.id, status: order.status, total: order.total, createdAt: order.createdAt, itemLabel: summary.label, itemCount: summary.itemCount, paymentMethod: order.paymentMethod });
      if (withLines) lineInputs.push({ orderId: order.id, tryReceipt: true, items: gift.items.map(item => ({ key: `${item.goodId}:${item.variantId}`, goodId: item.goodId, variantId: item.variantId, name: item.name, optionName: item.variantName, qty: item.qty, unitPrice: null, imagePath: item.imagePath })) });
    }
    if (!page.hasMore) return withGiftLines(await withGiftClaims(orders), lineInputs);
    const last = page.items.at(-1);
    if (!last || last.id === cursor?.id) throw new Error('gift_history_cursor_invalid');
    cursor = { createdAt: last.createdAt, id: last.id };
  }
}

/* 선물 주문의 품목 줄(MD-0036). 보강은 실패해도 던지지 않아(스냅샷 줄로 남는다) 선물 목록 전체를 막지 않는다. */
async function withGiftLines(orders: OrderListItem[], inputs: readonly OrderLineOrderInput[]): Promise<OrderListItem[]> {
  if (!inputs.length) return orders;
  const lines = await loadOrderLineViews(await createClient(), inputs);
  return orders.map(order => lines.has(order.id) ? { ...order, lines: lines.get(order.id) } : order);
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
    client.from('payment_summaries').select('id,amount,status,created_at,provider').eq('user_id', userId).eq('purpose', 'order').eq('ref_id', order.id).order('created_at', { ascending: false }).order('id', { ascending: false }),
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
  /* 품목 줄(MD-0036·0037): 선물 주문 응답이 이미 거래 영수증(order.transaction)을 가지고 있어 영수증을 다시 읽지 않는다. */
  const lines = (await loadOrderLineViews(client, [{ orderId: order.id, tryReceipt: false, receipt: order.transaction,
    items: order.items.map(item => ({ key: item.id, lineId: item.id, goodId: item.goodId, variantId: item.variantId, name: item.name, optionName: item.variantName ?? null, qty: item.qty, unitPrice: item.unitPrice })) }])).get(order.id);
  return { ...order, ...(lines ? { lines } : {}), status: order.status, deliveredAt: order.deliveredAt, claimEligibility,
    payment: payment ? { amount: payment.amount, status: payment.status, createdAt: payment.created_at, provider: payment.provider ?? null } : null,
    refund, cancellationRequest: parseSafeClaim(claims.data), cardPacks: { issuedCount: ticketRows.length, availableCount: ticketRows.filter(row => row.consumed_at === null && row.revoked_at === null).length } };
}
