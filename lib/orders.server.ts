import 'server-only';
import { parseOrderReshipmentHistory } from './orders/reshipment-items';
import { readCompleteIdPages } from '@/lib/supabase/complete-id-pages';
import { readGoodsCustomInputSnapshot } from '@/lib/goods-custom-inputs';
import { loadGiftCheckoutOrder } from './gifts-order.server';
import { loadGiftOrderDetail, loadGiftOrderList } from './gifts-order-detail.server';
import { parseCheckoutTransactionReceipt } from './checkout-transaction';

import { normalizeCheckoutPaymentMethod } from './checkout';

import { normalizeCheckoutAddress } from './checkout';
import {
  isOrderDetailStatus,
  isOrderCancellationRequestStatus,
  ORDER_DETAIL_STATUSES,
  summarizeOrderItems,
  type OrderDetail,
  type OrderCancellationRequestStatus,
  type OrderListItem,
} from './orders';
import { isOrderClaimStage, isOrderClaimType } from './orders/claims';
import { loadOrderShipments } from './orders/shipments.server';
import { getShippingCarrierRegistry } from './orders/shipment.server';
import { createClient } from '@/lib/supabase/server';

interface OrderListRow {
  order_number?: string;
  id: string;
  user_id: string;
  status: string;
  total: number;
  created_at: string;
  payment_method: string | null;
}

interface OrderDetailRow extends OrderListRow {
  calculation_version?: number;
  volume_discount_total?: number;
  shipping_collect_total?: number;
  shipping_fee: number | null;
  discount_total: number | null;
  store_credit_total: number | null;
  address: unknown;
  delivered_at: string | null;
  expires_at: string | null;
}

interface OrderListItemRow {
  order_id: string;
  qty: number;
  good_name_snapshot: string;
}

interface CancellationRequestOrderRow {
  order_id: string;
  claim_type: string;
  stage: string;
}

interface OrderDetailItemRow extends OrderListItemRow {
  product_order_number?: string;
  id: string;
  good_id: string;
  unit_price: number;
  good_type_snapshot: string;
  variant_id: string;
  variant_name_snapshot?: string | null;
  custom_inputs_snapshot?: unknown;
  variant_code_snapshot?: string | null;
  supply_source?: 'stock' | 'preorder';
  preorder_expected_ship_date?: string | null;
}

interface PaymentRow {
  id: string;
  amount: number;
  status: string;
  created_at: string;
}

interface DrawTicketRow {
  consumed_at: string | null;
  revoked_at: string | null;
}

interface RefundRow {
  status: string;
  created_at: string;
}

interface CancellationRequestRow {
  id: string;
  status: string;
  claim_type: string;
  stage: string;
  reference: number;
  requested_at: string;
  decided_at: string | null;
  decision_note: string | null;
  reship_carrier: string | null;
  reship_tracking_number: string | null;
  reship_delivered_at: string | null;
}

function requireDetailStatus(status: string) {
  if (!isOrderDetailStatus(status)) {
    throw new Error(`Failed to load order detail: unsupported status ${status}`);
  }
  return status;
}

export async function loadOrders(userId: string, {includePending=false}:{includePending?:boolean}={}): Promise<OrderListItem[]> {
  const supabase = await createClient();
  const [orderResult, giftOrders] = await Promise.all([
    supabase
      .from('orders')
      .select('id,order_number,user_id,status,total,created_at,payment_method')
      .eq('user_id', userId)
      .in('status', [...ORDER_DETAIL_STATUSES])
      .order('created_at', { ascending: false })
      .order('id', { ascending: false }),
    loadGiftOrderList(includePending),
  ]);

  if (orderResult.error) {
    throw new Error(`Failed to load orders: ${orderResult.error.message}`);
  }

  const userOrderRows = (orderResult.data ?? []) as OrderListRow[];
  /* 클레임은 이 회원의 주문 id로만 읽는다. 운영자 계정은 RLS로 전체 클레임을 읽을 수 있어서, 조건 없이
     읽으면 자기 /orders에서 남의 클레임까지 받아 온다. 요청자(requested_by)로는 거르지 않는다 —
     운영자 전액 취소처럼 운영자가 접수한 클레임도 고객 목록에 보여야 한다. */
  const latestClaimByOrderId = new Map<string, NonNullable<OrderListItem['claim']>>();
  const requestedOrderIds = new Set<string>();
  if (userOrderRows.length) {
    /* 주문마다 가장 최근 클레임 하나가 목록 배지가 된다 — 상세와 같은 기준(requested_at 최신). */
    const { data: requestData, error: requestError } = await supabase
      .from('order_cancellation_requests')
      .select('order_id,claim_type,stage')
      .in('order_id', userOrderRows.map((order) => order.id))
      .order('requested_at', { ascending: false })
      .order('id', { ascending: false });
    if (requestError) {
      throw new Error(`Failed to load order cancellation requests: ${requestError.message}`);
    }
    for (const request of (requestData ?? []) as CancellationRequestOrderRow[]) {
      requestedOrderIds.add(request.order_id);
      if (latestClaimByOrderId.has(request.order_id)) continue;
      /* 모르는 값은 배지를 만들지 않는다 — 상세가 판정을 보여준다. */
      if (isOrderClaimType(request.claim_type) && isOrderClaimStage(request.stage)) {
        latestClaimByOrderId.set(request.order_id, { claimType: request.claim_type, stage: request.stage });
      }
    }
  }

  /* 결제 대기 카드 주문은 복구 목록(includePending)이 아니면 취소 요청이 남아 있는 것만 보인다.
     무통장 입금 대기는 접수 = 주문 완료(ADR-0026)라 기본 목록에 '입금 대기'로 보인다. */
  const orderRows = userOrderRows.filter((order) => (
    includePending || order.status !== 'pending' || order.payment_method === 'bank_transfer' || requestedOrderIds.has(order.id)
  ));

  orderRows.sort((left, right) => (
    right.created_at.localeCompare(left.created_at) || right.id.localeCompare(left.id)
  ));

  if (orderRows.length === 0) return giftOrders.sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id));

  const orderIds = orderRows.map((order) => order.id);
  const { data: itemData, error: itemError } = await readCompleteIdPages<OrderListItemRow&{id:string}>((afterId,pageSize)=>{
    let query=supabase.from('order_items').select('id,order_id,qty,good_name_snapshot',{count:'exact'})
      .in('order_id',orderIds).order('id',{ascending:true}).limit(pageSize);
    if(afterId)query=query.gt('id',afterId);
    return query;
  });

  if (itemError) {
    throw new Error(`Failed to load order items: ${itemError.message}`);
  }

  const itemsByOrderId = new Map<string, OrderListItemRow[]>();
  for (const item of (itemData ?? []) as OrderListItemRow[]) {
    const items = itemsByOrderId.get(item.order_id) ?? [];
    items.push(item);
    itemsByOrderId.set(item.order_id, items);
  }

  return [...giftOrders, ...orderRows.map((order) => {
    const status = requireDetailStatus(order.status);
    const summary = summarizeOrderItems(
      (itemsByOrderId.get(order.id) ?? []).map((item) => ({
        name: item.good_name_snapshot,
        qty: item.qty,
      })),
    );

    return {
      id: order.id,
      ...(order.order_number ? { orderNumber: order.order_number } : {}),
      status,
      total: order.total,
      createdAt: order.created_at,
      itemLabel: summary.label,
      itemCount: summary.itemCount,
      paymentMethod: normalizeCheckoutPaymentMethod(order.payment_method) ?? 'card',
      claim: latestClaimByOrderId.get(order.id) ?? null,
    };
  })].sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id));
}

export async function loadOrderDetail(userId: string, orderId: string): Promise<OrderDetail | null> {
  const gift = await loadGiftCheckoutOrder(userId, orderId);
  if (gift.kind === 'unavailable') return null;
  if (gift.kind === 'gift') return loadGiftOrderDetail(userId, gift);
  const supabase = await createClient();
  const { data: orderData, error: orderError } = await supabase
    .from('orders')
    // delivered_at은 청약철회 기한의 기산점이다(#189). 이 값이 없으면 주문
    // 상세가 남은 기간을 말할 근거가 없다.
    .select('id,order_number,user_id,status,total,shipping_fee,discount_total,store_credit_total,address,created_at,delivered_at,payment_method,expires_at,calculation_version,volume_discount_total,shipping_collect_total')
    .eq('id', orderId)
    .eq('user_id', userId)
    .in('status', [...ORDER_DETAIL_STATUSES])
    .maybeSingle<OrderDetailRow>();

  if (orderError) {
    throw new Error(`Failed to load order detail: ${orderError.message}`);
  }
  if (!orderData) return null;
  let transaction: OrderDetail['transaction'];
  if (orderData.calculation_version === 2) {
    const result = await supabase.rpc('get_my_goods_transaction_receipt', { p_order_id: orderId });
    const receipt = result.error ? null : parseCheckoutTransactionReceipt(result.data);
    if (!receipt || receipt.orderId !== orderId || receipt.display.totals.onlineTotal !== orderData.total
      || receipt.display.totals.volumeDiscountTotal !== orderData.volume_discount_total || receipt.display.totals.collectShippingTotal !== orderData.shipping_collect_total
      || receipt.display.totals.prepaidShippingTotal !== orderData.shipping_fee || receipt.display.totals.couponDiscountTotal !== orderData.discount_total
      || receipt.display.totals.storeCreditTotal !== orderData.store_credit_total) throw new Error('order_transaction_receipt_invalid');
    transaction = receipt.display;
  }

  const status = requireDetailStatus(orderData.status);
  const [itemsResult, paymentResult, ticketsResult, cancellationRequestResult, eligibilityResult, reshipmentResult] = await Promise.all([
    readCompleteIdPages<OrderDetailItemRow>((afterId,pageSize)=>{
      let query=supabase.from('order_items')
        .select('id,order_id,product_order_number,good_id,qty,unit_price,good_name_snapshot,good_type_snapshot,variant_id,variant_name_snapshot,variant_code_snapshot,custom_inputs_snapshot,supply_source,preorder_expected_ship_date',{count:'exact'})
        .eq('order_id',orderId).order('id',{ascending:true}).limit(pageSize);
      if(afterId)query=query.gt('id',afterId);
      return query;
    }),
    supabase
      .from('payment_summaries')
      .select('id,amount,status,created_at')
      .eq('user_id', userId)
      .eq('purpose', 'order')
      .eq('ref_id', orderId)
      .order('created_at', { ascending: false })
      .order('id', { ascending: false }),
    supabase
      .from('draw_tickets')
      .select('consumed_at,revoked_at')
      .eq('user_id', userId)
      .eq('source', 'order_paid')
      .eq('source_id', orderId),
    supabase
      .from('order_cancellation_requests')
      .select(
        'id,status,claim_type,stage,reference,requested_at,decided_at,decision_note,'
        + 'reship_carrier,reship_tracking_number,reship_delivered_at',
      )
      .eq('order_id', orderId)
      .order('requested_at', { ascending: false })
      .limit(1)
      .maybeSingle<CancellationRequestRow>(),
    supabase.rpc('order_claim_eligibility', { p_order_id: orderId }),
    supabase.rpc('get_my_order_claim_reshipment_items', { p_order_id: orderId }),
  ]);

  const reshipmentHistory = reshipmentResult.error ? null : parseOrderReshipmentHistory(reshipmentResult.data);
  if (!reshipmentHistory) throw new Error('order_reshipment_history_invalid');

  if (itemsResult.error) {
    throw new Error(`Failed to load order items: ${itemsResult.error.message}`);
  }
  if (paymentResult.error) {
    throw new Error(`Failed to load order payment: ${paymentResult.error.message}`);
  }
  if (ticketsResult.error) {
    throw new Error(`Failed to load order card packs: ${ticketsResult.error.message}`);
  }
  if (cancellationRequestResult.error) {
    throw new Error(`Failed to load order cancellation request: ${cancellationRequestResult.error.message}`);
  }

  const ticketRows = (ticketsResult.data ?? []) as DrawTicketRow[];
  const paymentRows = (paymentResult.data ?? []) as PaymentRow[];
  const payment = paymentRows[0] ?? null;
  const eligibility = eligibilityResult.error ? null : eligibilityResult.data;
  const claimEligibility = eligibility && typeof eligibility === 'object'
    && typeof eligibility.cancel === 'boolean' && typeof eligibility.return === 'boolean'
    && typeof eligibility.exchange === 'boolean'
    ? { cancel: eligibility.cancel, return: eligibility.return, exchange: eligibility.exchange }
    : null;
  let refund: RefundRow | null = null;
  const cancellationRequestRow = cancellationRequestResult.data;
  let cancellationRequestStatus: OrderCancellationRequestStatus | null = null;
  if (cancellationRequestRow) {
    if (!isOrderCancellationRequestStatus(cancellationRequestRow.status)) {
      throw new Error('Failed to load order cancellation request: unsupported status');
    }
    cancellationRequestStatus = cancellationRequestRow.status;
  }

  if (paymentRows.length > 0) {
    const { data: refundData, error: refundError } = await supabase
      .from('refunds')
      .select('status,created_at')
      .in('payment_id', paymentRows.map((row) => row.id))
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle<RefundRow>();

    if (refundError) {
      throw new Error(`Failed to load order refund: ${refundError.message}`);
    }
    refund = refundData;
  }

  return {
    ...(transaction ? { transaction } : {}),
    id: orderData.id,
    ...(orderData.order_number ? { orderNumber: orderData.order_number } : {}),
    status,
    total: orderData.total,
    shippingFee: orderData.shipping_fee ?? 0,
    discountTotal: orderData.discount_total ?? 0,
    storeCreditTotal: orderData.store_credit_total ?? 0,
    address: normalizeCheckoutAddress(orderData.address),
    createdAt: orderData.created_at,
    deliveredAt: orderData.delivered_at,
    claimEligibility,
    paymentMethod: normalizeCheckoutPaymentMethod(orderData.payment_method) ?? 'card',
    expiresAt: orderData.expires_at,
    items: ((itemsResult.data ?? []) as OrderDetailItemRow[]).map((item) => ({
      id: item.id,
      ...(item.product_order_number ? { productOrderNumber: item.product_order_number } : {}),
      goodId: item.good_id,
      name: item.good_name_snapshot,
      ...(item.custom_inputs_snapshot == null ? {} : {customInputs:readGoodsCustomInputSnapshot(item.custom_inputs_snapshot)}),
      variantId: item.variant_id, variantName: item.variant_name_snapshot ?? null, variantCode: item.variant_code_snapshot ?? null,
      type: item.good_type_snapshot,
      qty: item.qty,
      unitPrice: item.unit_price,
      supplySource: item.supply_source ?? 'stock',
      preorderExpectedShipDate: item.preorder_expected_ship_date ?? null,
    })),
    payment: payment
      ? {
          amount: payment.amount,
          status: payment.status,
          createdAt: payment.created_at,
        }
      : null,
    refund: refund
      ? {
          status: refund.status,
          createdAt: refund.created_at,
        }
      : null,
    reshipmentHistory,
    cancellationRequest: cancellationRequestRow && cancellationRequestStatus
      ? {
          id: cancellationRequestRow.id,
          status: cancellationRequestStatus,
          /* 모르는 값은 가장 좁은 쪽으로 접는다 — 취소·접수는 어떤 유형에서도
             거짓말이 되지 않는 안내다. */
          claimType: isOrderClaimType(cancellationRequestRow.claim_type)
            ? cancellationRequestRow.claim_type
            : 'cancel',
          stage: isOrderClaimStage(cancellationRequestRow.stage)
            ? cancellationRequestRow.stage
            : 'requested',
          reference: Number(cancellationRequestRow.reference ?? 0),
          requestedAt: cancellationRequestRow.requested_at,
          decidedAt: cancellationRequestRow.decided_at,
          decisionNote: cancellationRequestRow.decision_note,
          reshipCarrier: cancellationRequestRow.reship_carrier,
          reshipTrackingNumber: cancellationRequestRow.reship_tracking_number,
          reshipDeliveredAt: cancellationRequestRow.reship_delivered_at ?? null,
        }
      : null,
    shipments: await loadOrderShipments(supabase, [orderId], await getShippingCarrierRegistry()),
    cardPacks: {
      issuedCount: ticketRows.length,
      availableCount: ticketRows.filter((ticket) => (
        ticket.consumed_at === null && ticket.revoked_at === null
      )).length,
    },
  };
}
