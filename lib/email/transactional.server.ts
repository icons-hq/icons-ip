import 'server-only';
import { emailSiteUrl as siteUrl } from './site-url';

import type { CheckoutAddress } from '../checkout';
import type { GoodsTransactionDisplay } from '../goods-transaction';
import { loadOrderDeliveryForService } from '../order-delivery.server';
import { loadServiceOrderTransaction } from '../order-transactions.server';
import { readCompleteIdPages } from '../supabase/complete-id-pages';
import type { ShipmentRecord } from '../orders/shipments';
import { loadOrderShipments } from '../orders/shipments.server';
import { loadShippingCarrierRegistry } from '../orders/shipment.server';
import { createServiceClient, getServiceRoleConfig } from '../supabase/service';
import {
  inquiryEmailDedupeKey,
  orderEmailDedupeKey,
  shipmentEmailDedupeKey,
  restockAlertEmailDedupeKey,
  type EmailTemplateName,
  type OrderEmailTemplateName,
  type OrderEmailAudience,
} from './dedupe';
import { sendTransactionalEmail } from './provider.server';
import {
  renderInquiryAnsweredEmail,
  renderOrderConfirmationEmail,
  renderOrderShippedEmail,
  renderGiftRecipientEmail,
  renderRestockAlertEmail,
  type OrderEmailItem,
  type RenderedEmail,
} from './templates';

/* 트랜잭션 이메일 발송 훅(#180).
 *
 * 어느 진입점에서 불러도 절대 throw하지 않는다. 확인 메일은 토스 웹훅 경로에서 불리는데,
 * 여기서 던지면 웹훅이 500으로 떨어지고 토스가 결제 확정을 재전송한다 — 메일 문제로
 * 주문 상태를 흔드는 셈이다. 결제는 검증된 provider 증거와 DB finalizer가 확정하고 메일은 그 뒤의 부수효과다.
 *
 * 멱등은 email_deliveries 클레임이 담당한다(claim_email_delivery). 웹훅이 7번 재전송돼도
 * 확인 메일은 1통이다.
 *
 * 배송비와 할인은 주문 당시 스냅샷을 읽고, 발송 메일의 품목·운송장은 배송 건에서 읽는다.
 *
 * 보내지 못한 사실은 반드시 관측 가능해야 한다. 결과를 버리는 호출자가 하나라도 있으면
 * 미발송이 흔적 없이 사라지므로, 로그는 호출부가 아니라 이 훅이 직접 남긴다. */


/* 메일 본문이 지금도 사실인 주문 상태.
 *
 * 발송은 더 이상 웹훅 확정 직후로 한정되지 않는다. 어드민 재발송은 임의 시점이고,
 * 그 사이 주문이 청약철회로 canceled가 될 수 있다. 그때 "결제가 확인됐고 배송 준비를
 * 시작합니다"를 보내면 취소된 주문에 대한 거짓 고지가 된다.
 *
 * DB 게이트(admin_request_email_resend)도 같은 집합을 본다. 웹훅 경로는 그 게이트를
 * 지나지 않으므로 실제 안전장치는 이쪽이다 — 양쪽을 함께 바꾼다. */
// 사다리가 늘면 이 집합도 함께 넓힌다(#250). 빠뜨리면 발주확인·배송완료된 주문의
// 확인 메일이 order_status_mismatch로 조용히 건너뛰어져 재발송조차 되지 않는다.
const ACCURATE_ORDER_STATUSES: Record<OrderEmailTemplateName, readonly string[]> = {
  order_confirmation: ['paid', 'confirmed', 'shipping', 'delivered', 'done'],
  order_shipped: ['shipping', 'delivered', 'done'],
};

/* 멱등이 정상 동작한 결과다. 매 웹훅 재전송마다 로그를 남길 이유가 없다.
 *
 * 재입고 훅은 재고를 건드릴 때마다 조건 없이 불린다(전이 판정은 DB 트리거 몫). 신청자가
 * 없는 굿즈가 절대다수라 no_notified_alerts 를 이상으로 찍으면 정상 운영이 에러 로그로
 * 뒤덮여 진짜 미발송이 묻힌다. */
const EXPECTED_SKIP_REASONS: readonly string[] = ['already_delivered', 'no_notified_alerts'];

export type TransactionalEmailResult =
  | { status: 'sent' }
  | { status: 'skipped'; reason: string }
  | { status: 'failed'; error: string };

interface OrderRow {
  calculation_version: number;
  volume_discount_total: number | null;
  shipping_collect_total: number | null;
  shipping_fee: number | null;
  discount_total: number | null;
  store_credit_total: number | null;
  id: string;
  user_id: string;
  status: string;
  total: number;
  created_at: string;
}

interface OrderItemRow {
  id: string;
  variant_id: string;
  good_name_snapshot: string;
  variant_name_snapshot?: string | null;
  qty: number;
  unit_price: number;
}

interface OrderEmailContext {
  recipient: string | null;
  giftRecipient: string | null;
  giftDelivery: boolean;
  transaction?: GoodsTransactionDisplay;
  orderId: string;
  orderStatus: string;
  orderedAt: string;
  items: (OrderEmailItem & {id:string})[];
  itemsSubtotal: number;
  shippingFee: number;
  discountTotal: number;
  storeCreditTotal: number;
  total: number;
  address: CheckoutAddress | null;
  shipments: ShipmentRecord[];
  orderUrl: string;
}


type ServiceClient = ReturnType<typeof createServiceClient>;

async function loadOrderEmailContext(
  service: ServiceClient,
  orderId: string,
): Promise<OrderEmailContext | { skipped: string }> {
  const { data: orderData, error: orderError } = await service
    .from('orders')
    .select('id,user_id,status,total,shipping_fee,discount_total,store_credit_total,volume_discount_total,shipping_collect_total,calculation_version,created_at')
    .eq('id', orderId)
    .maybeSingle();
  if (orderError) throw new Error('order_email_load_failed');
  const order = orderData as OrderRow | null;
  if (!order) return { skipped: 'order_missing' };

  const { data: itemData, error: itemError } = await readCompleteIdPages<OrderItemRow>((after, size) => {
    let query = service.from('order_items')
      .select('id,variant_id,good_name_snapshot,variant_name_snapshot,qty,unit_price', { count: 'exact' })
      .eq('order_id', orderId).order('id', { ascending: true }).limit(size);
    if (after) query = query.gt('id', after);
    return query;
  });
  if (itemError) throw new Error('order_email_items_load_failed');
  const [delivery, receipt] = await Promise.all([
    loadOrderDeliveryForService(orderId), loadServiceOrderTransaction(orderId),
  ]);
  if (!delivery || delivery.senderId !== order.user_id) throw new Error('order_email_delivery_context_invalid');
  if ((order.calculation_version === 2) !== Boolean(receipt)) throw new Error('order_email_transaction_missing');
  if (receipt) {
    const totals = receipt.display.totals;
    if (totals.onlineTotal !== order.total || totals.prepaidShippingTotal !== order.shipping_fee
      || totals.collectShippingTotal !== order.shipping_collect_total || totals.volumeDiscountTotal !== order.volume_discount_total
      || totals.couponDiscountTotal !== order.discount_total || totals.storeCreditTotal !== order.store_credit_total
      || receipt.display.lines.length !== itemData?.length
      || itemData?.some(row => !receipt.display.lines.some(line => line.lineId === row.id
        && line.variantId === row.variant_id && line.qty === row.qty && line.unitPrice === row.unit_price))) {
      throw new Error('order_email_transaction_mismatch');
    }
  }
  async function emailFor(userId: string): Promise<string | null> {
    const { data, error } = await service.from('profiles').select('email').eq('id', userId).maybeSingle();
    if (error) throw new Error('order_email_recipient_load_failed');
    const email = (data as { email?: unknown } | null)?.email;
    return typeof email === 'string' && email.includes('@') ? email : null;
  }
  const [recipient, giftRecipient] = await Promise.all([
    emailFor(order.user_id), delivery.isGift ? emailFor(delivery.recipientId) : Promise.resolve(null),
  ]);
  /* 웹훅 경로라 쿠키 클라이언트를 만들 수 없다. 레지스트리는 공개 읽기 테이블이므로
     이미 들고 있는 service 클라이언트로 그대로 읽는다(#251). */
  const carriers = await loadShippingCarrierRegistry(service);

  const items = ((itemData ?? []) as OrderItemRow[]).map((row) => ({
    id: row.id,
    name: row.good_name_snapshot,
    ...(row.variant_name_snapshot ? { variantName: row.variant_name_snapshot } : {}),
    qty: row.qty,
    unitPrice: row.unit_price,
  }));
  const itemsSubtotal = items.reduce((sum, item) => sum + item.qty * item.unitPrice, 0);

  return {
    recipient, giftRecipient, giftDelivery: delivery.isGift,
    ...(receipt ? { transaction: receipt.display } : {}),
    orderId: order.id,
    orderStatus: order.status,
    orderedAt: order.created_at,
    items,
    itemsSubtotal,
    shippingFee: order.shipping_fee ?? 0,
    discountTotal: order.discount_total ?? 0,
    // orders.total = 굿즈 합계 + 배송비 − (쿠폰 할인 + 적립금). 서면 교부 메일의 금액 합이
    // 맞으려면 적립금 사용액도 실어야 한다.
    storeCreditTotal: order.store_credit_total ?? 0,
    total: order.total,
    address: delivery.address,
    shipments: await loadOrderShipments(service, [orderId], carriers),
    orderUrl: `${siteUrl()}/orders/${order.id}`,
  };
}

/**
 * 발송 직전 컨텍스트.
 *
 * 주문을 읽는 것과 "이 메일이 지금도 사실인가"를 판정하는 것을 한 곳에 묶는다.
 * 두 발송 함수가 각자 판정하면 한쪽만 고쳐졌을 때 거짓 고지가 다시 열린다.
 */
async function prepareOrderEmail(
  service: ServiceClient,
  template: OrderEmailTemplateName,
  orderId: string,
): Promise<OrderEmailContext | { skipped: string }> {
  const context = await loadOrderEmailContext(service, orderId);
  if ('skipped' in context) return context;

  if (!ACCURATE_ORDER_STATUSES[template].includes(context.orderStatus)) {
    return { skipped: `order_status_mismatch:${context.orderStatus}` };
  }
  return context;
}

async function deliver(
  service: ServiceClient,
  input: {
    dedupeKey: string;
    template: EmailTemplateName;
    recipient: string;
    rendered: RenderedEmail;
  },
): Promise<TransactionalEmailResult> {
  const { data: claimed, error: claimError } = await service.rpc('claim_email_delivery', {
    target_dedupe_key: input.dedupeKey,
    target_template: input.template,
    target_recipient: input.recipient,
    target_subject: input.rendered.subject,
  });
  if (claimError) throw new Error('order_email_claim_failed');
  if (claimed !== true) {
    const { data, error } = await service.from('email_deliveries').select('status')
      .eq('dedupe_key', input.dedupeKey).maybeSingle();
    if (!error && data?.status === 'sent') return { status: 'skipped', reason: 'already_delivered' };
    if (!error && data?.status === 'pending') return { status: 'skipped', reason: 'delivery_in_progress' };
    return { status: 'failed', error: 'delivery_outcome_unknown' };
  }

  const outcome = await sendTransactionalEmail({
    to: input.recipient,
    subject: input.rendered.subject,
    text: input.rendered.text,
    html: input.rendered.html,
  });
  const rawFailure = outcome.status === 'sent'
    ? null
    : outcome.status === 'failed' ? outcome.error : outcome.reason;
  const failure = rawFailure === null
    ? null
    : /^(?:provider_http_[1-5][0-9]{2}|provider_network_error|provider_not_configured)$/.test(rawFailure)
      ? rawFailure
      : 'provider_failure';

  const { error: completeError } = await service.rpc('complete_email_delivery', {
    target_dedupe_key: input.dedupeKey,
    target_status: failure ? 'failed' : 'sent',
    target_error: failure,
  });
  if (completeError) {
    console.error('[email] delivery_record_failed');
    return { status: 'failed', error: 'delivery_record_failed' };
  }

  return failure ? { status: 'failed', error: failure } : { status: 'sent' };
}

/**
 * service role이 없으면 손댈 수 있는 게 아무것도 없다 — 주문도 못 읽고 이력도 못 남긴다.
 * 유일하게 남길 수 있는 흔적이 로그이므로 여기서 끊는다.
 *
 * provider 키 없음은 여기서 막지 않는다. 그 상태로도 클레임과 결과 기록은 가능하고,
 * 기록해 두면 나중에 키를 채운 운영자가 발송 이력에서 그대로 다시 보낼 수 있다.
 * 앞에서 끊으면 확인 메일 0통·이력 0행·로그 0줄이 되어 복구할 대상 자체가 사라진다.
 */
function guardedEnvironment(): TransactionalEmailResult | null {
  if (!getServiceRoleConfig().isConfigured) {
    return { status: 'skipped', reason: 'service_role_not_configured' };
  }
  return null;
}

/**
 * 훅의 바깥 껍질. throw를 삼키고, 보내지 못한 사실을 반드시 로그로 남긴다.
 *
 * 호출부가 결과를 버려도 미발송은 관측 가능해야 한다 — 운영자가 나중에 발송 이력을
 * 열었을 때 "다시 보낼 메일이 없습니다"만 보고 아무 일도 없었다고 믿게 두면 안 된다.
 */
async function safely(
  label: string,
  reference: string,
  run: () => Promise<TransactionalEmailResult>,
): Promise<TransactionalEmailResult> {
  try {
    const result = await run();
    if (result.status === 'failed') {
      console.error(`[email] ${label} failed (${reference}): ${result.error}`);
    } else if (result.status === 'skipped' && !EXPECTED_SKIP_REASONS.includes(result.reason)) {
      console.error(`[email] ${label} not sent (${reference}): ${result.reason}`);
    }
    return result;
  } catch {
    console.error(`[email] ${label} failed (${reference}): unexpected_email_failure`);
    return { status: 'failed', error: 'unexpected_email_failure' };
  }
}

/** A retry targets only the failed audience; ordinary hooks attempt both gift parties. */
async function deliverOrderAudiences(
  context: OrderEmailContext,
  audience: OrderEmailAudience | undefined,
  send: (audience: OrderEmailAudience, email: string) => Promise<TransactionalEmailResult>,
): Promise<TransactionalEmailResult> {
  const targets: OrderEmailAudience[] = audience ? [audience] : context.giftDelivery ? ['payer', 'recipient'] : ['payer'];
  const results: TransactionalEmailResult[] = [];
  // Sequential delivery preserves the worker's five-provider-call concurrency bound.
  for (const target of targets) {
    const email = target === 'payer' ? context.recipient : context.giftRecipient;
    results.push(!email ? { status: 'skipped', reason: 'recipient_missing' }
      : await safely(`order ${target}`, `order:${context.orderId}`, () => send(target, email)));
  }
  const failures = results.filter((r): r is Extract<TransactionalEmailResult, { status: 'failed' }> => r.status === 'failed');
  // Uncertain acceptance must outrank a known retryable rejection on the other audience.
  const unknown = failures.find(r => !/^(?:provider_http_(?:429|5[0-9]{2})|provider_not_configured)$/.test(r.error));
  if (unknown || failures[0]) return unknown ?? failures[0];
  const blocked = results.find(r => r.status === 'skipped' && r.reason !== 'already_delivered');
  if (blocked) return blocked;
  return results.some(r => r.status === 'sent') ? { status: 'sent' } : { status: 'skipped', reason: 'already_delivered' };
}

/** Confirmed payment sends the payer the contractual receipt and a separate recipient notice. */
export function sendOrderConfirmationEmail(orderId: string, audience?: OrderEmailAudience): Promise<TransactionalEmailResult> {
  return safely('order confirmation', `order:${orderId}`, async () => {
    const blocked = guardedEnvironment();
    if (blocked) return blocked;
    const service = createServiceClient();
    const context = await prepareOrderEmail(service, 'order_confirmation', orderId);
    if ('skipped' in context) return { status: 'skipped', reason: context.skipped };
    return deliverOrderAudiences(context, audience, (target, email) => deliver(service, {
      dedupeKey: orderEmailDedupeKey('order_confirmation', orderId, target),
      template: 'order_confirmation', recipient: email,
      rendered: target === 'payer' ? renderOrderConfirmationEmail({ ...context, address: context.giftDelivery ? null : context.address })
        : renderGiftRecipientEmail({ orderId, stage: 'confirmation', items: context.items.map(({ name, variantName, qty }) => ({ name, variantName, qty })),
          address: context.address!, giftUrl: `${siteUrl()}/gifts` }),
    }));
  });
}

/** Shipment ID chooses both the frozen items and the per-audience dedupe key. */
export function sendOrderShippedEmail(input: {
  orderId: string;
  /** Only legacy resends may omit this, and only for a single shipment order. */
  shipmentId?: string;
  audience?: OrderEmailAudience;
}): Promise<TransactionalEmailResult> {
  return safely('order shipped', `order:${input.orderId}`, async () => {
    const blocked = guardedEnvironment();
    if (blocked) return blocked;
    const service = createServiceClient();
    const context = await prepareOrderEmail(service, 'order_shipped', input.orderId);
    if ('skipped' in context) return { status: 'skipped', reason: context.skipped };
    const shipment = input.shipmentId
      ? context.shipments.find(item => item.id === input.shipmentId)
      : context.shipments.length === 1 ? context.shipments[0] : undefined;
    if (!shipment) return { status: 'skipped', reason: 'shipment_reference_required' };
    if (!['shipping','delivered'].includes(shipment.status)) return { status: 'skipped', reason: 'shipment_status_mismatch' };
    const items = context.items.filter(item => shipment.orderItemIds.includes(item.id));
    if (!items.length) return { status: 'skipped', reason: 'shipment_items_missing' };
    return deliverOrderAudiences(context, input.audience, (target, email) => deliver(service, {
      dedupeKey: shipmentEmailDedupeKey(input.orderId, shipment.id, target),
      template: 'order_shipped', recipient: email,
      rendered: target === 'payer' ? renderOrderShippedEmail({
        orderId: context.orderId, shipmentId: shipment.id, originName: shipment.originName, giftDelivery: context.giftDelivery,
        items, address: context.giftDelivery ? null : context.address,
        carrierName: context.giftDelivery ? null : shipment.carrierLabel,
        trackingNumber: context.giftDelivery ? null : shipment.trackingNumber,
        trackingUrl: context.giftDelivery ? null : shipment.trackingUrl, orderUrl: context.orderUrl,
      }) : renderGiftRecipientEmail({ orderId: context.orderId, stage: 'shipped',
        items: items.map(({ name, variantName, qty }) => ({ name, variantName, qty })),
        address: context.address!, giftUrl: `${siteUrl()}/gifts`, carrierName: shipment.carrierLabel,
        trackingNumber: shipment.trackingNumber, trackingUrl: shipment.trackingUrl }),
    }));
  });
}

interface RestockAlertRow {
  id: string;
  notified_at: string | null;
  /** 옵션 단위 신청의 옵션(PD-11). null 은 굿즈 단위(모든 옵션) 신청이다. */
  variant_id?: string | null;
  profiles: { email: string | null } | { email: string | null }[] | null;
}

function rowVariantId(row: RestockAlertRow): string | null {
  return typeof row.variant_id === 'string' && row.variant_id ? row.variant_id : null;
}

/* 옵션 신청이 가리키는 옵션 이름. service role 은 goods_variants 를 직접 읽지 못해 봉인된 RPC 로만 받는다. */
async function restockOptionNames(service: ReturnType<typeof createServiceClient>, goodId: string): Promise<Map<string, string>> {
  const { data, error } = await service.rpc('service_restock_alert_option_names', { target_good_id: goodId });
  if (error || !Array.isArray(data)) throw new Error('restock_email_option_names_load_failed');
  const names = new Map<string, string>();
  for (const row of data as { variant_id?: unknown; option_name?: unknown }[]) {
    if (typeof row.variant_id === 'string' && typeof row.option_name === 'string' && row.option_name.trim()) {
      names.set(row.variant_id, row.option_name.trim());
    }
  }
  return names;
}

/**
 * 재입고 메일이 notified 신청을 다시 읽는 기간(전이 뒤 7일).
 *
 * 신청 행은 지우지 않고(이력 보존) 사이클마다 같은 행이 다시 notified 가 되며, 옵션 키로 굿즈당 행이
 * "사용자 × (옵션 수 + 1)"까지 는다. 기간 없이 다시 읽으면 지난 사이클이 끝없이 쌓여 매 접점이 그만큼
 * 클레임을 다시 돌고, 범위 없이 읽으면 PostgREST max_rows(1000)에서 행이 조용히 잘린다. 기간 안은
 * id 커서로 끝까지 읽는다. 7일이 지난 사이클은 알림함이 전이 순간에 이미 받았고, 그만큼 늦은
 * "다시 판매를 시작했어요"는 사실이 아닐 수 있어 메일로 보내지 않는다.
 */
export const RESTOCK_EMAIL_LOOKBACK_MS = 7 * 24 * 60 * 60 * 1000;

/* 기간 안의 notified 신청을 빠짐없이 읽는다. 읽는 사이 행이 바뀌어 스냅샷이 어긋나면 일부만 보내지 않고
   실패로 접는다(readCompleteIdPages — 클레임 전이라 다음 재고 접점에서 다시 읽는다). */
async function loadNotifiedRestockAlerts(service: ReturnType<typeof createServiceClient>, goodId: string): Promise<RestockAlertRow[]> {
  const since = new Date(Date.now() - RESTOCK_EMAIL_LOOKBACK_MS).toISOString();
  const { data, error } = await readCompleteIdPages<RestockAlertRow>((after, size) => {
    let query = service.from('restock_alerts')
      .select('id,notified_at,variant_id,profiles(email)', { count: 'exact' })
      .eq('good_id', goodId)
      .eq('status', 'notified')
      .gte('notified_at', since)
      .order('id', { ascending: true })
      .limit(size);
    if (after) query = query.gt('id', after);
    return query;
  });
  if (error || !data) throw new Error('restock_email_alerts_load_failed');
  return data;
}

function rowRecipient(value: RestockAlertRow['profiles']): string | null {
  const profile = Array.isArray(value) ? value[0] : value;
  const email = profile?.email?.trim();
  return email && email.includes('@') ? email : null;
}

/**
 * 재입고 알림 메일 (#326 · 옵션 단위 PD-11).
 *
 * 신청 행을 notified 로 넘기는 것은 DB 트리거다(굿즈 행의 판매 가능 전이와 옵션 행의 재고
 * 전이). 여기는 그 결과를 읽어 메일만 보낸다 — "전이가 일어났는가"를 앱이 다시 판정하지 않는다. 판정을 두 곳에 두면 재고 복원 경로
 * (주문 취소·반품의 service role 쓰기)가 늘 때마다 한쪽이 빠진다.
 *
 * 그래서 호출부는 재고를 건드린 뒤 조건 없이 부르면 된다. 이미 보낸 사이클은
 * claim_email_delivery 가 거른다(dedupe_key 에 notified_at 이 들어가 사이클마다 유일).
 * 다시 읽는 범위는 전이 뒤 7일 안의 notified 신청 전부다(RESTOCK_EMAIL_LOOKBACK_MS).
 *
 * 한 굿즈에 신청자가 여럿이라 결과도 여러 개다. 한 명에게 실패해도 나머지는 보낸다 —
 * 배열 하나로 묶어 실패를 삼키면 누가 못 받았는지 알 수 없다.
 *
 * 알려진 한계: 호출부는 어드민 접점(굿즈 저장·실재고 조정·옵션 복원 app/admin/goods-variant-actions.ts·
 * 무통장 재허용 app/admin/good-bank-transfer-actions.ts)이다. 그 밖의 전이 — 주문 취소·반품의 재고
 * 복원, 행 변경 없이 열린 판매 조건(IP 재공개·판매 기간 시작 시각 도래 — DB 청소 작업
 * private.sweep_restock_alerts 가 5분마다 깨운다) — 은 인앱 알림이 즉시 나가지만, 메일은 어드민이 그
 * 굿즈를 다음에 저장하거나 실재고를 조정할 때까지 미룬다(전이 뒤 7일이 지나면 보내지 않는다). 취소
 * 정합화 경로 서너 곳에 orderId→goods 팬아웃 훅을 심는 산탄보다, notified 행이 claim 게이트에 남아
 * 있다가 다음 접점에서 발송되는 쪽을 택했다. 어드민 액션이 굿즈 id 를 들고 있는 접점은 굿즈 저장처럼
 * after() 로 이 함수를 부르면 된다. 발송 주기가 필요해지면 호출부를 늘리지 말고 미발송 notified 행을
 * 쓸어 담는 단일 청소 경로를 만들 것.
 */
export async function sendRestockAlertEmails(
  goodId: string,
): Promise<TransactionalEmailResult[]> {
  /* 수신자별 결과는 팬아웃 안에서 쌓인다. 바깥 껍질의 결과는 팬아웃 자체가 서지
     못했을 때(service role 없음·조회 실패·보낼 신청 없음)만 쓰인다. */
  const results: TransactionalEmailResult[] = [];

  const outcome = await safely('restock alert', `good:${goodId}`, async () => {
    const blocked = guardedEnvironment();
    if (blocked) return blocked;

    const service = createServiceClient();

    const { data: goodData, error: goodError } = await service
      .from('goods')
      .select('name,published_at,archived_at,sale_restriction,ips:ip_id(published_at,archived_at)')
      .eq('id', goodId)
      .maybeSingle();
    if (goodError) throw new Error('restock_email_good_load_failed');
    const goodName = (goodData as { name?: unknown } | null)?.name;
    if (typeof goodName !== 'string' || !goodName.trim()) {
      return { status: 'skipped', reason: 'good_missing' };
    }
    // A notification may have been queued before the operator hid this good.
    const current = goodData as unknown as {
      published_at: string | null; archived_at: string | null; sale_restriction: string;
      ips: { published_at: string | null; archived_at: string | null } | null;
    };
    if (!current.published_at || current.archived_at || current.sale_restriction !== 'none'
      || !current.ips?.published_at || current.ips.archived_at) {
      return { status: 'skipped', reason: 'good_unavailable' };
    }

    const rows = await loadNotifiedRestockAlerts(service, goodId);
    if (!rows.length) return { status: 'skipped', reason: 'no_notified_alerts' };
    /* 옵션 신청이 있을 때만 옵션 이름을 읽는다. 못 읽으면 옵션을 말하지 않는 메일을 보내지 않고 이번 배치를
       접는다 — 클레임 전이라 다음 재고 접점에서 다시 보낸다. */
    const optionNames = rows.some((row) => rowVariantId(row)) ? await restockOptionNames(service, goodId) : new Map<string, string>();

    /* 본문은 수신자와 무관하고 옵션마다 다르다 — 옵션(없으면 굿즈 단위)별로 한 번 그려 재사용한다.
       옵션 신청의 링크는 그 옵션을 고른 상세다(?variant=, PD-14). */
    const renderedByOption = new Map<string, RenderedEmail>();
    const renderedFor = (variantId: string | null, optionName: string | null) => {
      const cacheKey = variantId ?? '';
      const cached = renderedByOption.get(cacheKey);
      if (cached) return cached;
      const rendered = renderRestockAlertEmail({
        goodName,
        optionName: variantId ? optionName : null,
        goodPath: `${siteUrl()}/shop/${goodId}${variantId ? `?variant=${encodeURIComponent(variantId)}` : ''}`,
      });
      renderedByOption.set(cacheKey, rendered);
      return rendered;
    };

    for (const row of rows) {
      const recipient = rowRecipient(row.profiles);
      const notifiedAt = row.notified_at;
      if (!recipient || !notifiedAt) {
        results.push({ status: 'skipped', reason: 'recipient_missing' });
        console.error(`[email] restock alert not sent (alert:${row.id}): recipient_missing`);
        continue;
      }

      const variantId = rowVariantId(row);
      /* 한 명이 실패해도 나머지는 보낸다 — 행마다 껍질을 씌워 실패를 격리한다. */
      results.push(await safely('restock alert', `alert:${row.id}`, () => deliver(service, {
        dedupeKey: restockAlertEmailDedupeKey(row.id, notifiedAt, variantId),
        template: 'restock_alert',
        recipient,
        rendered: renderedFor(variantId, variantId ? optionNames.get(variantId) ?? null : null),
      })));
    }

    return { status: 'sent' };
  });

  return results.length ? results : [outcome];
}

export interface InquiryAnsweredEmailRequest {
  /** 답변 메시지 id. dedupe_key가 되므로 스레드 id를 넘기면 두 번째 답변이 막힌다. */
  messageId: string;
  inquiryId: string;
  reference: number;
  categoryLabel: string;
  title: string;
  answerBody: string;
  recipient: string | null;
}

/**
 * 1:1 문의 답변 알림 메일(#253).
 *
 * 인앱 알림은 `admin_answer_inquiry`가 같은 트랜잭션에서 남긴다. 메일만 밖에서 보낸다 —
 * HTTP는 트랜잭션에 넣을 수 없고, 메일 실패가 답변 등록을 되돌리면 안 되기 때문이다.
 * 다른 발송 훅과 같은 규율로 절대 throw하지 않는다.
 *
 * 주문 메일과 달리 사실성 게이트가 없다. "답변이 등록됐다"는 문의가 종결된 뒤에도
 * 계속 참이라 되돌아볼 상태가 없다.
 */
export function sendInquiryAnsweredEmail(
  input: InquiryAnsweredEmailRequest,
): Promise<TransactionalEmailResult> {
  return safely('inquiry answered', `inquiry:${input.inquiryId}`, async () => {
    const blocked = guardedEnvironment();
    if (blocked) return blocked;

    const recipient = input.recipient?.trim();
    if (!recipient || !recipient.includes('@')) {
      return { status: 'skipped', reason: 'recipient_missing' };
    }

    return deliver(createServiceClient(), {
      dedupeKey: inquiryEmailDedupeKey(input.messageId),
      template: 'inquiry_answered',
      recipient,
      rendered: renderInquiryAnsweredEmail({
        answerBody: input.answerBody,
        categoryLabel: input.categoryLabel,
        inquiryUrl: `${siteUrl()}/my/inquiries/${input.inquiryId}`,
        reference: input.reference,
        title: input.title,
      }),
    });
  });
}
