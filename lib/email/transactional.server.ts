import 'server-only';

import { normalizeCheckoutAddress } from '../checkout';
import { orderShipment, type OrderShipment } from '../orders/shipment';
import { loadShippingCarrierRegistry } from '../orders/shipment.server';
import { createServiceClient, getServiceRoleConfig } from '../supabase/service';
import {
  inquiryEmailDedupeKey,
  orderEmailDedupeKey,
  restockAlertEmailDedupeKey,
  type EmailTemplateName,
  type OrderEmailTemplateName,
} from './dedupe';
import { sendTransactionalEmail } from './provider.server';
import {
  renderInquiryAnsweredEmail,
  renderOrderConfirmationEmail,
  renderOrderShippedEmail,
  renderRestockAlertEmail,
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
 * 다른 이슈(#174)의 범위이고, 어느 쪽이 먼저 들어와도 이 파생값은 맞다.
 *
 * 보내지 못한 사실은 반드시 관측 가능해야 한다. 결과를 버리는 호출자가 하나라도 있으면
 * 미발송이 흔적 없이 사라지므로, 로그는 호출부가 아니라 이 훅이 직접 남긴다. */

const DEFAULT_SITE_URL = 'https://iconsip.com';

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
  id: string;
  user_id: string;
  status: string;
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
  orderStatus: string;
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
    .select('id,user_id,status,total,created_at,address,shipping_carrier,tracking_number')
    .eq('id', orderId)
    .maybeSingle();
  if (orderError) throw new Error('order_email_load_failed');
  const order = orderData as OrderRow | null;
  if (!order) return { skipped: 'order_missing' };

  const { data: itemData, error: itemError } = await service
    .from('order_items')
    .select('good_name_snapshot,qty,unit_price')
    .eq('order_id', orderId)
    .order('id', { ascending: true });
  if (itemError) throw new Error('order_email_items_load_failed');

  const { data: profileData, error: profileError } = await service
    .from('profiles')
    .select('email')
    .eq('id', order.user_id)
    .maybeSingle();
  if (profileError) throw new Error('order_email_recipient_load_failed');

  const recipient = (profileData as { email?: unknown } | null)?.email;
  if (typeof recipient !== 'string' || !recipient.includes('@')) {
    return { skipped: 'recipient_missing' };
  }

  /* 웹훅 경로라 쿠키 클라이언트를 만들 수 없다. 레지스트리는 공개 읽기 테이블이므로
     이미 들고 있는 service 클라이언트로 그대로 읽는다(#251). */
  const carriers = await loadShippingCarrierRegistry(service);

  const items = ((itemData ?? []) as OrderItemRow[]).map((row) => ({
    name: row.good_name_snapshot,
    qty: row.qty,
    unitPrice: row.unit_price,
  }));
  const itemsSubtotal = items.reduce((sum, item) => sum + item.qty * item.unitPrice, 0);

  return {
    recipient,
    orderId: order.id,
    orderStatus: order.status,
    orderedAt: order.created_at,
    items,
    itemsSubtotal,
    shippingFee: Math.max(0, order.total - itemsSubtotal),
    total: order.total,
    address: normalizeCheckoutAddress(order.address),
    shipment: orderShipment(carriers, order.shipping_carrier, order.tracking_number),
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
  if (claimed !== true) return { status: 'skipped', reason: 'already_delivered' };

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

/** 주문 확정(웹훅) 확인 메일. 전자상거래법상 계약내용 서면 교부 경로다(L4). */
export function sendOrderConfirmationEmail(orderId: string): Promise<TransactionalEmailResult> {
  return safely('order confirmation', `order:${orderId}`, async () => {
    const blocked = guardedEnvironment();
    if (blocked) return blocked;

    const service = createServiceClient();
    const context = await prepareOrderEmail(service, 'order_confirmation', orderId);
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
  return safely('order shipped', `order:${input.orderId}`, async () => {
    const blocked = guardedEnvironment();
    if (blocked) return blocked;

    const service = createServiceClient();
    const context = await prepareOrderEmail(service, 'order_shipped', input.orderId);
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

interface RestockAlertRow {
  id: string;
  notified_at: string | null;
  profiles: { email: string | null } | { email: string | null }[] | null;
}

function rowRecipient(value: RestockAlertRow['profiles']): string | null {
  const profile = Array.isArray(value) ? value[0] : value;
  const email = profile?.email?.trim();
  return email && email.includes('@') ? email : null;
}

/**
 * 재입고 알림 메일 (#326).
 *
 * 신청 행을 notified 로 넘기는 것은 DB 트리거다. 여기는 그 결과를 읽어 메일만 보낸다 —
 * "전이가 일어났는가"를 앱이 다시 판정하지 않는다. 판정을 두 곳에 두면 재고 복원 경로
 * (주문 취소·반품의 service role 쓰기)가 늘 때마다 한쪽이 빠진다.
 *
 * 그래서 호출부는 재고를 건드린 뒤 조건 없이 부르면 된다. 이미 보낸 사이클은
 * claim_email_delivery 가 거른다(dedupe_key 에 notified_at 이 들어가 사이클마다 유일).
 *
 * 한 굿즈에 신청자가 여럿이라 결과도 여러 개다. 한 명에게 실패해도 나머지는 보낸다 —
 * 배열 하나로 묶어 실패를 삼키면 누가 못 받았는지 알 수 없다.
 *
 * 알려진 한계: 현재 호출부는 어드민의 재고 접점(굿즈 저장·실재고 조정)뿐이다.
 * 주문 취소·반품의 재고 복원으로 전이가 일어나면 인앱 알림은 트리거가 즉시 보내지만,
 * 메일은 어드민이 그 굿즈를 다음에 만질 때까지 미룬다 — 취소 정합화 경로 서너 곳에
 * orderId→goods 팬아웃 훅을 심는 산탄보다, notified 행이 claim 게이트에 남아 있다가
 * 다음 접점에서 발송되는 쪽을 택했다. 발송 주기가 필요해지면 호출부를 늘리지 말고
 * 미발송 notified 행을 쓸어 담는 단일 청소 경로를 만들 것.
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
      .select('name')
      .eq('id', goodId)
      .maybeSingle();
    if (goodError) throw new Error('restock_email_good_load_failed');
    const goodName = (goodData as { name?: unknown } | null)?.name;
    if (typeof goodName !== 'string' || !goodName.trim()) {
      return { status: 'skipped', reason: 'good_missing' };
    }

    const { data, error } = await service
      .from('restock_alerts')
      .select('id,notified_at,profiles(email)')
      .eq('good_id', goodId)
      .eq('status', 'notified')
      .order('notified_at', { ascending: true });
    if (error) throw new Error('restock_email_alerts_load_failed');

    const rows = (data ?? []) as RestockAlertRow[];
    if (!rows.length) return { status: 'skipped', reason: 'no_notified_alerts' };

    /* 본문은 수신자와 무관하다 — 한 번 그려 재사용한다. */
    const rendered = renderRestockAlertEmail({
      goodName,
      goodPath: `${siteUrl()}/shop/${goodId}`,
    });

    for (const row of rows) {
      const recipient = rowRecipient(row.profiles);
      const notifiedAt = row.notified_at;
      if (!recipient || !notifiedAt) {
        results.push({ status: 'skipped', reason: 'recipient_missing' });
        console.error(`[email] restock alert not sent (alert:${row.id}): recipient_missing`);
        continue;
      }

      /* 한 명이 실패해도 나머지는 보낸다 — 행마다 껍질을 씌워 실패를 격리한다. */
      results.push(await safely('restock alert', `alert:${row.id}`, () => deliver(service, {
        dedupeKey: restockAlertEmailDedupeKey(row.id, notifiedAt),
        template: 'restock_alert',
        recipient,
        rendered,
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
