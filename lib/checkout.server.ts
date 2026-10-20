import 'server-only';
import { readCompleteIdPages } from '@/lib/supabase/complete-id-pages';
import { readGoodsCustomInputSnapshot } from '@/lib/goods-custom-inputs';
import type { ShipmentRecord } from './orders/shipments';
import { loadOrderShipments } from './orders/shipments.server';
import { getShippingCarrierRegistry } from './orders/shipment.server';
import { loadGiftCheckoutOrder } from './gifts-order.server';
import { parseCheckoutTransactionReceipt } from './checkout-transaction';
import type { GoodsTransactionDisplay } from './goods-transaction';

import {
  normalizeCheckoutAddress,
  normalizeCheckoutPaymentMethod,
  type CheckoutAddress,
  type CheckoutPaymentMethod,
} from './checkout';
import { createClient } from './supabase/server';
import { createServiceClient } from './supabase/service';

interface OrderRow {
  id: string;
  user_id: string;
  status: string;
  total: number;
  shipping_fee: number | null;
  discount_total: number | null;
  store_credit_total: number | null;
  address: unknown;
  expires_at: string | null;
  created_at: string;
  payment_method: string | null;
  calculation_version?: number;
  volume_discount_total?: number;
  shipping_collect_total?: number;
}

interface OrderItemRow {
  id: string;
  good_id: string;
  qty: number;
  unit_price: number;
  good_name_snapshot: string;
  good_type_snapshot: string;
  variant_id: string;
  variant_name_snapshot?: string | null;
  custom_inputs_snapshot?: unknown;
  variant_code_snapshot?: string | null;
  supply_source?: 'stock' | 'preorder';
  preorder_expected_ship_date?: string | null;
}

export interface CheckoutOrderItem {
  id: string;
  variantId: string;
  variantName?: string | null;
  customInputs?: import('@/lib/goods-custom-inputs').GoodsCustomInputSelection | null;
  variantCode?: string | null;
  goodId: string;
  name: string;
  type: string;
  qty: number;
  unitPrice: number;
  supplySource?: 'stock' | 'preorder';
  preorderExpectedShipDate?: string | null;
}

export interface CheckoutOrderSnapshot {
  giftId?: string;
  transaction?: GoodsTransactionDisplay;
  shipments: ShipmentRecord[];
  id: string;
  status: string;
  total: number;
  /** 주문 시점 배송비 스냅샷. total에 이미 포함되어 있다. */
  shippingFee: number;
  /** 주문 시점 쿠폰 할인 스냅샷. total에서 이미 빠져 있다(S7). */
  discountTotal: number;
  /** 주문 시 사용한 적립금. 쿠폰과 구별하며 total에서 이미 빠져 있다. */
  storeCreditTotal: number;
  address: CheckoutAddress | null;
  expiresAt: string | null;
  createdAt: string;
  paymentStatus: string | null;
  /** 주문 생성 시점에 고정된 결제수단 (#256). */
  paymentMethod: CheckoutPaymentMethod;
  items: CheckoutOrderItem[];
}

export async function loadLatestCheckoutAddress(userId: string): Promise<CheckoutAddress | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('orders')
    .select('address')
    .eq('user_id', userId)
    .not('address', 'is', null)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle<{ address: unknown }>();

  return error ? null : normalizeCheckoutAddress(data?.address);
}

export async function loadLatestPendingCheckoutOrderId(userId: string): Promise<string | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('orders')
    .select('id')
    .eq('user_id', userId)
    .eq('status', 'pending')
    .not('checkout_key', 'is', null)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle<{ id: string }>();

  return error ? null : data?.id ?? null;
}

export async function loadCheckoutOrder(
  userId: string,
  orderId: string,
): Promise<CheckoutOrderSnapshot | null> {
  try {
    const gift = await loadGiftCheckoutOrder(userId, orderId);
    if (gift.kind === 'gift') return gift.order;
    if (gift.kind !== 'ordinary') return null;
  } catch { return null; }
  const supabase = await createClient();
  const { data: orderData, error: orderError } = await supabase
    .from('orders')
    .select('id,user_id,status,total,shipping_fee,discount_total,store_credit_total,address,expires_at,created_at,payment_method,calculation_version,volume_discount_total,shipping_collect_total')
    .eq('id', orderId)
    .eq('user_id', userId)
    .maybeSingle<OrderRow>();
  if (orderError || !orderData) return null;
  const paymentLedger = createServiceClient();

  const [
    { data: itemData, error: itemError },
    { data: paymentData, error: paymentError },
    { data: attemptData, error: attemptError },
    receiptResult,
  ] = await Promise.all([
    readCompleteIdPages<OrderItemRow>((afterId,pageSize)=>{
      let query=supabase.from('order_items')
        .select('id,good_id,qty,unit_price,good_name_snapshot,good_type_snapshot,variant_id,variant_name_snapshot,variant_code_snapshot,custom_inputs_snapshot,supply_source,preorder_expected_ship_date',{count:'exact'})
        .eq('order_id',orderId).order('id',{ascending:true}).limit(pageSize);
      if(afterId)query=query.gt('id',afterId);
      return query;
    }),
    supabase
      .from('payment_summaries')
      .select('status')
      .eq('purpose', 'order')
      .eq('ref_id', orderId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle<{ status: string }>(),
    paymentLedger
      .from('payment_attempts')
      .select('state')
      .eq('user_id', userId)
      .eq('purpose', 'order')
      .eq('ref_id', orderId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle<{ state: string }>(),
    orderData.calculation_version === 2 ? supabase.rpc('get_my_goods_transaction_receipt', { p_order_id: orderId }) : Promise.resolve({ data: null, error: null }),
  ]);
  if (itemError || paymentError || attemptError) return null;

  const itemRows = (itemData ?? []) as OrderItemRow[];
  const receipt = orderData.calculation_version === 2 ? parseCheckoutTransactionReceipt(receiptResult.data) : null;
  if (orderData.calculation_version === 2 && (receiptResult.error || !receipt || receipt.orderId !== orderId
    || receipt.display.totals.onlineTotal !== orderData.total || receipt.display.totals.prepaidShippingTotal !== (orderData.shipping_fee ?? 0)
    || receipt.display.totals.volumeDiscountTotal !== orderData.volume_discount_total || receipt.display.totals.collectShippingTotal !== orderData.shipping_collect_total
    || receipt.display.totals.couponDiscountTotal !== (orderData.discount_total ?? 0) || receipt.display.totals.storeCreditTotal !== (orderData.store_credit_total ?? 0)
    || receipt.display.lines.length !== itemRows.length || receipt.display.lines.some(line => !itemRows.some(item => item.id === line.lineId && item.variant_id === line.variantId && item.qty === line.qty && item.unit_price === line.unitPrice)))) return null;

  return {
    ...(receipt ? { transaction: receipt.display } : {}),
    id: orderData.id,
    status: orderData.status,
    total: orderData.total,
    shippingFee: orderData.shipping_fee ?? 0,
    discountTotal: orderData.discount_total ?? 0,
    storeCreditTotal: orderData.store_credit_total ?? 0,
    address: normalizeCheckoutAddress(orderData.address),
    expiresAt: orderData.expires_at,
    createdAt: orderData.created_at,
    paymentStatus: (
      attemptData?.state === 'confirming'
      || attemptData?.state === 'unknown'
      || attemptData?.state === 'needs_review'
    ) ? 'pending' : paymentData?.status ?? null,
    paymentMethod: normalizeCheckoutPaymentMethod(orderData.payment_method) ?? 'card',
    shipments: await loadOrderShipments(supabase, [orderId], await getShippingCarrierRegistry()),
    items: itemRows.map((item) => ({
      id: item.id,
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
  };
}
