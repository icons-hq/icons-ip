import 'server-only';

import { normalizeCheckoutAddress } from '../checkout';
import { orderShipment, type OrderShipment } from '../orders/shipment';
import { createServiceClient, getServiceRoleConfig } from '../supabase/service';
import { orderEmailDedupeKey, type EmailTemplateName } from './dedupe';
import { getEmailProviderConfig, sendTransactionalEmail } from './provider.server';
import {
  renderOrderConfirmationEmail,
  renderOrderShippedEmail,
  type OrderEmailItem,
  type RenderedEmail,
} from './templates';

/* 트랜잭션 이메일 발송 훅(#180).
 *
 * 어느 진입점에서 불러도 절대 throw하지 않는다. 확인 메일은 토스 웹훅 경로에서 불리는데,
 * 여기서 던지면 웹훅이 500으로 떨어지고 토스가 결제 확정을 재전송한다 — 메일 문제로
 * 주문 상태를 흔드는 셈이다. 결제 확정의 진실원은 웹훅이고 메일은 그 뒤의 부수효과다.
 *
 * 멱등은 email_deliveries 클레임이 담당한다(claim_email_delivery). 웹훅이 7번 재전송돼도
 * 확인 메일은 1통이다.
 *
 * 배송비는 orders 컬럼을 읽지 않고 `총 결제금액 - 굿즈 합계`로 파생한다. 배송비 컬럼은
 * 다른 이슈(#174)의 범위이고, 어느 쪽이 먼저 들어와도 이 파생값은 맞다. */

const DEFAULT_SITE_URL = 'https://iconsip.com';

export type TransactionalEmailResult =
  | { status: 'sent' }
  | { status: 'skipped'; reason: string }
  | { status: 'failed'; error: string };

interface OrderRow {
  id: string;
  user_id: string;
  total: number;
  created_at: string;
  address: unknown;
  shipping_carrier: string | null;
  tracking_number: string | null;
}

interface OrderItemRow {
  good_name_snapshot: string;
  qty: number;
  unit_price: number;
}

interface OrderEmailContext {
  recipient: string;
  orderId: string;
  orderedAt: string;
  items: OrderEmailItem[];
  itemsSubtotal: number;
  shippingFee: number;
  total: number;
  address: ReturnType<typeof normalizeCheckoutAddress>;
  shipment: OrderShipment | null;
  orderUrl: string;
}

function siteUrl() {
  const configured = process.env.SITE_URL?.trim();
  return (configured || DEFAULT_SITE_URL).replace(/\/+$/, '');
}

type ServiceClient = ReturnType<typeof createServiceClient>;

async function loadOrderEmailContext(
  service: ServiceClient,
  orderId: string,
): Promise<OrderEmailContext | { skipped: string }> {
  const { data: orderData, error: orderError } = await service
    .from('orders')
    .select('id,user_id,total,created_at,address,shipping_carrier,tracking_number')
    .eq('id', orderId)
    .maybeSingle();
  if (orderError) throw new Error(`Failed to load order for email: ${orderError.message}`);
  const order = orderData as OrderRow | null;
  if (!order) return { skipped: 'order_missing' };

  const { data: itemData, error: itemError } = await service
    .from('order_items')
    .select('good_name_snapshot,qty,unit_price')
    .eq('order_id', orderId)
    .order('id', { ascending: true });
  if (itemError) throw new Error(`Failed to load order items for email: ${itemError.message}`);

  const { data: profileData, error: profileError } = await service
    .from('profiles')
    .select('email')
    .eq('id', order.user_id)
    .maybeSingle();
  if (profileError) throw new Error(`Failed to load recipient for email: ${profileError.message}`);

  const recipient = (profileData as { email?: unknown } | null)?.email;
  if (typeof recipient !== 'string' || !recipient.includes('@')) {
    return { skipped: 'recipient_missing' };
  }

  const items = ((itemData ?? []) as OrderItemRow[]).map((row) => ({
    name: row.good_name_snapshot,
    qty: row.qty,
    unitPrice: row.unit_price,
  }));
  const itemsSubtotal = items.reduce((sum, item) => sum + item.qty * item.unitPrice, 0);

  return {
    recipient,
    orderId: order.id,
    orderedAt: order.created_at,
    items,
    itemsSubtotal,
    shippingFee: Math.max(0, order.total - itemsSubtotal),
    total: order.total,
    address: normalizeCheckoutAddress(order.address),
    shipment: orderShipment(order.shipping_carrier, order.tracking_number),
    orderUrl: `${siteUrl()}/orders/${order.id}`,
  };
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
  if (claimError) throw new Error(`Failed to claim email delivery: ${claimError.message}`);
  if (claimed !== true) return { status: 'skipped', reason: 'already_delivered' };

  const outcome = await sendTransactionalEmail({
    to: input.recipient,
    subject: input.rendered.subject,
    text: input.rendered.text,
    html: input.rendered.html,
  });
  const failure = outcome.status === 'sent'
    ? null
    : outcome.status === 'failed' ? outcome.error : outcome.reason;

  const { error: completeError } = await service.rpc('complete_email_delivery', {
    target_dedupe_key: input.dedupeKey,
    target_status: failure ? 'failed' : 'sent',
    target_error: failure,
  });
  if (completeError) {
    console.error(`[email] delivery record failed: ${completeError.message}`);
  }

  return failure ? { status: 'failed', error: failure } : { status: 'sent' };
}

function guardedEnvironment(): TransactionalEmailResult | null {
  if (!getServiceRoleConfig().isConfigured) {
    return { status: 'skipped', reason: 'service_role_not_configured' };
  }
  if (!getEmailProviderConfig().isConfigured) {
    return { status: 'skipped', reason: 'provider_not_configured' };
  }
  return null;
}

async function safely(
  label: string,
  run: () => Promise<TransactionalEmailResult>,
): Promise<TransactionalEmailResult> {
  try {
    return await run();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[email] ${label} failed: ${message}`);
    return { status: 'failed', error: message };
  }
}

/** 주문 확정(웹훅) 확인 메일. 전자상거래법상 계약내용 서면 교부 경로다(L4). */
export function sendOrderConfirmationEmail(orderId: string): Promise<TransactionalEmailResult> {
  return safely('order confirmation', async () => {
    const blocked = guardedEnvironment();
    if (blocked) return blocked;

    const service = createServiceClient();
    const context = await loadOrderEmailContext(service, orderId);
    if ('skipped' in context) return { status: 'skipped', reason: context.skipped };

    return deliver(service, {
      dedupeKey: orderEmailDedupeKey('order_confirmation', orderId),
      template: 'order_confirmation',
      recipient: context.recipient,
      rendered: renderOrderConfirmationEmail(context),
    });
  });
}

/**
 * 배송 시작 메일.
 *
 * 운송장 값은 인자로 받되, 생략하면 주문 행(orders.shipping_carrier·tracking_number)에서
 * 읽는다. 인자에만 의존하면 그 값을 넘기지 않는 호출자 하나가 "운송장 정보가 등록되면…"
 * 만 담긴 메일을 보내고, dedupe 행이 sent로 닫혀 영원히 다시 못 보낸다. 재발송 경로처럼
 * 폼 입력이 없는 호출자도 완전한 메일을 만들 수 있어야 한다.
 */
export function sendOrderShippedEmail(input: {
  orderId: string;
  carrierName?: string | null;
  trackingNumber?: string | null;
  trackingUrl?: string | null;
}): Promise<TransactionalEmailResult> {
  return safely('order shipped', async () => {
    const blocked = guardedEnvironment();
    if (blocked) return blocked;

    const service = createServiceClient();
    const context = await loadOrderEmailContext(service, input.orderId);
    if ('skipped' in context) return { status: 'skipped', reason: context.skipped };

    return deliver(service, {
      dedupeKey: orderEmailDedupeKey('order_shipped', input.orderId),
      template: 'order_shipped',
      recipient: context.recipient,
      rendered: renderOrderShippedEmail({
        orderId: context.orderId,
        items: context.items,
        address: context.address,
        carrierName: input.carrierName ?? context.shipment?.carrierLabel ?? null,
        trackingNumber: input.trackingNumber ?? context.shipment?.trackingNumber ?? null,
        trackingUrl: input.trackingUrl ?? context.shipment?.trackingUrl ?? null,
        orderUrl: context.orderUrl,
      }),
    });
  });
}
