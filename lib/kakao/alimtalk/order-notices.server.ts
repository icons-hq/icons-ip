import 'server-only';

import { orderReferenceLabel } from '@/lib/orders';
import { loadOrderDeliveryForService } from '@/lib/order-delivery.server';
import { loadShippingCarrierRegistry } from '@/lib/orders/shipment.server';
import { loadOrderShipments } from '@/lib/orders/shipments.server';
import { readCompleteIdPages } from '@/lib/supabase/complete-id-pages';
import { createServiceClient, getServiceRoleConfig } from '@/lib/supabase/service';
import { isUuid } from '@/lib/uuid';
import { createNhnAlimtalkSender, kakaoAlimtalkConfig, type AlimtalkSendResult, type KakaoAlimtalkConfig, type NhnAlimtalkSender } from './nhn.server';
import { orderConfirmationParameters, orderShippedParameters, type AlimtalkTemplateName } from './templates';

/*
 * 카카오 알림톡 주문 안내 — 결제 확인(주문 접수)과 발송 시작.
 *
 * 이메일(lib/email/transactional.server.ts)과 같은 시점에 나란히 부르는 부수효과다. 이메일은 전자상거래법 서면 교부라
 * 그대로 두고, 알림톡은 휴대폰으로 한 번 더 알리는 수단이다. 그래서:
 *   · 절대 throw하지 않는다 — 결제 확정 웹훅·출고 작업이 알림톡 때문에 실패하면 안 된다.
 *   · 받는 사람은 주문한 회원의 인증 휴대폰(국내)뿐이고 DB 클레임이 정한다. 앱은 번호를 고르지 않는다.
 *   · (안내, 주문, 배송 건)마다 한 번만 보낸다(service_claim_kakao_alimtalk_delivery). 결과를 모르는 발송은 다시 보내지 않는다.
 *   · 보내는 내용은 승인된 템플릿의 #{변수}뿐이다 — 주문번호·굿즈 요약·금액·택배사·송장번호·주문 id. 주소·이름은 싣지 않는다.
 *   · 선물 주문의 발송 안내는 보내지 않는다. 송장번호로 받는 분 주소를 조회할 수 있어, 선물한 분 메일도 운송장을 가린다.
 *     선물 받는 분에게 보내는 알림톡은 아직 없다(이메일만 간다).
 * 스위치·키가 없으면(기본) 아무것도 읽지 않고 'disabled'로 끝난다.
 */

export type AlimtalkNoticeResult =
  | { status: 'sent' }
  | { status: 'skipped'; reason: string }
  | { status: 'failed'; error: string };

/* 이메일 본문이 지금도 사실인 주문 상태와 같은 집합이다(transactional.server.ts ACCURATE_ORDER_STATUSES). */
const ACCURATE_ORDER_STATUSES: Record<AlimtalkTemplateName, readonly string[]> = {
  order_confirmation: ['paid', 'confirmed', 'shipping', 'delivered', 'done'],
  order_shipped: ['shipping', 'delivered', 'done'],
};

/* 정상 동작의 결과라 로그를 남기지 않는 건너뜀. 그 밖의 건너뜀·실패는 로그로 남긴다. */
const EXPECTED_SKIP_REASONS: readonly string[] = [
  'disabled', 'template_not_configured', 'already_sent', 'in_progress', 'no_verified_phone', 'unsupported_number', 'gift_order',
];

export interface AlimtalkOrderSnapshot {
  orderId: string;
  orderNumber: string | null;
  status: string;
  total: number;
  /** 주문 줄(배정 행 그대로). 고객에게 보일 이름은 visibleItemNames가 만든다. 옵션 이름은 싣지 않는다. */
  items: { id: string; goodId: string; name: string; random: boolean }[];
}

export interface AlimtalkShipmentSnapshot {
  id: string;
  status: string;
  carrierLabel: string | null;
  trackingNumber: string | null;
  orderItemIds: readonly string[];
}

export type AlimtalkClaim =
  | { ok: true; deliveryId: string; claimToken: string; recipientNo: string }
  | { ok: false; reason: string };

export interface AlimtalkNoticeRepository {
  loadOrder(orderId: string): Promise<AlimtalkOrderSnapshot | null>;
  loadShipments(orderId: string): Promise<AlimtalkShipmentSnapshot[]>;
  isGiftOrder(orderId: string): Promise<boolean>;
  claim(template: AlimtalkTemplateName, orderId: string, shipmentId: string | null): Promise<AlimtalkClaim>;
  complete(claim: Extract<AlimtalkClaim, { ok: true }>, result: AlimtalkSendResult): Promise<boolean>;
}

export interface AlimtalkNoticeDependencies {
  config?: KakaoAlimtalkConfig | null;
  repository?: AlimtalkNoticeRepository;
  sender?: Pick<NhnAlimtalkSender, 'send'>;
  log?: (line: string) => void;
}

interface OrderItemRow {
  id: string;
  good_id: string;
  good_name_snapshot: string;
  option_sale_mode_snapshot: 'random' | null;
}

const CLAIM_REASONS = new Set([
  'order_missing', 'shipment_missing', 'account_unavailable', 'no_verified_phone', 'unsupported_number',
  'already_sent', 'in_progress', 'outcome_unknown', 'attempts_exhausted',
]);

function parseClaim(data: unknown): AlimtalkClaim {
  const value = data && typeof data === 'object' && !Array.isArray(data) ? data as Record<string, unknown> : null;
  if (value?.ok === true && isUuid(value.deliveryId) && isUuid(value.claimToken)
    && typeof value.recipientNo === 'string' && /^01[016789][0-9]{7,8}$/.test(value.recipientNo)) {
    return { ok: true, deliveryId: value.deliveryId, claimToken: value.claimToken, recipientNo: value.recipientNo };
  }
  if (value?.ok === false && typeof value.reason === 'string' && CLAIM_REASONS.has(value.reason)) {
    return { ok: false, reason: value.reason };
  }
  throw new Error('alimtalk_claim_invalid');
}

export function createAlimtalkNoticeRepository(service: ReturnType<typeof createServiceClient> = createServiceClient()): AlimtalkNoticeRepository {
  return {
    async loadOrder(orderId) {
      const { data: order, error } = await service.from('orders')
        .select('id,order_number,status,total').eq('id', orderId).maybeSingle();
      if (error) throw new Error('alimtalk_order_load_failed');
      if (!order) return null;
      const { data: rows, error: itemError } = await readCompleteIdPages<OrderItemRow>((after, size) => {
        let query = service.from('order_items')
          .select('id,good_id,good_name_snapshot,option_sale_mode_snapshot', { count: 'exact' })
          .eq('order_id', orderId).order('id', { ascending: true }).limit(size);
        if (after) query = query.gt('id', after);
        return query;
      });
      if (itemError || !rows) throw new Error('alimtalk_order_items_load_failed');
      const items = rows.map((row) => ({
        id: row.id, goodId: row.good_id, name: row.good_name_snapshot, random: row.option_sale_mode_snapshot === 'random',
      }));
      const value = order as { id: string; order_number?: string | null; status: string; total: number };
      return { orderId: value.id, orderNumber: value.order_number ?? null, status: value.status, total: value.total, items };
    },
    async loadShipments(orderId) {
      const shipments = await loadOrderShipments(service, [orderId], await loadShippingCarrierRegistry(service));
      return shipments.map((shipment) => ({
        id: shipment.id, status: shipment.status, carrierLabel: shipment.carrierLabel,
        trackingNumber: shipment.trackingNumber, orderItemIds: shipment.orderItemIds,
      }));
    },
    async isGiftOrder(orderId) {
      const delivery = await loadOrderDeliveryForService(orderId);
      if (!delivery) throw new Error('alimtalk_delivery_context_missing');
      return delivery.isGift;
    },
    async claim(template, orderId, shipmentId) {
      const { data, error } = await service.rpc('service_claim_kakao_alimtalk_delivery', {
        p_template: template, p_order_id: orderId, p_shipment_id: shipmentId,
      });
      if (error) throw new Error('alimtalk_claim_failed');
      return parseClaim(data);
    },
    async complete(claim, result) {
      const { data, error } = await service.rpc('service_complete_kakao_alimtalk_delivery', {
        p_delivery_id: claim.deliveryId,
        p_claim_token: claim.claimToken,
        p_status: result.status,
        p_provider_request_id: result.status === 'sent' ? result.requestId : null,
        p_error_code: result.status === 'sent' ? null : result.error,
      });
      if (error || typeof data !== 'boolean') throw new Error('alimtalk_complete_failed');
      return data;
    },
  };
}

async function safely(
  label: string,
  orderId: string,
  log: (line: string) => void,
  run: () => Promise<AlimtalkNoticeResult>,
): Promise<AlimtalkNoticeResult> {
  try {
    const result = await run();
    if (result.status === 'failed') log(`[alimtalk] ${label} failed (order:${orderId}): ${result.error}`);
    else if (result.status === 'skipped' && !EXPECTED_SKIP_REASONS.includes(result.reason)) {
      log(`[alimtalk] ${label} not sent (order:${orderId}): ${result.reason}`);
    }
    return result;
  } catch {
    log(`[alimtalk] ${label} failed (order:${orderId}): unexpected_alimtalk_failure`);
    return { status: 'failed', error: 'unexpected_alimtalk_failure' };
  }
}

/**
 * 안내에 실을 굿즈 이름. 옵션 이름은 싣지 않고, 랜덤 판매 굿즈(D5②)의 배정 행은 굿즈마다 한 줄로 합친다 —
 * 배정이 여러 행으로 나뉘어도 고객에게는 한 굿즈다(메일의 mergeRandomOrderItemRows와 같은 취지 — 이름만 실으므로 굿즈
 * 단위로 합친다). 배송 건 품목으로 거른 뒤에 합쳐야 다른 배송 건으로 간 배정 행 때문에 굿즈가 빠지지 않는다.
 */
export function visibleItemNames(items: readonly AlimtalkOrderSnapshot['items'][number][]): string[] {
  const names: string[] = [];
  const randomGoods = new Set<string>();
  for (const item of items) {
    if (item.random) {
      if (randomGoods.has(item.goodId)) continue;
      randomGoods.add(item.goodId);
    }
    names.push(item.name);
  }
  return names;
}

interface Prepared {
  config: KakaoAlimtalkConfig;
  templateCode: string;
  repository: AlimtalkNoticeRepository;
  sender: Pick<NhnAlimtalkSender, 'send'>;
}

function prepare(template: AlimtalkTemplateName, dependencies: AlimtalkNoticeDependencies): Prepared | { skipped: string } {
  const config = dependencies.config === undefined ? kakaoAlimtalkConfig() : dependencies.config;
  if (!config) return { skipped: 'disabled' };
  const templateCode = config.templateCodes[template];
  if (!templateCode) return { skipped: 'template_not_configured' };
  if (!dependencies.repository && !getServiceRoleConfig().isConfigured) return { skipped: 'service_role_not_configured' };
  return {
    config,
    templateCode,
    repository: dependencies.repository ?? createAlimtalkNoticeRepository(),
    sender: dependencies.sender ?? createNhnAlimtalkSender(config),
  };
}

/* 클레임 → 발송 → 결과 기록. 발송기가 던지면 접수됐을 수 있으므로 unknown으로 닫는다. */
async function deliver(
  prepared: Prepared,
  input: { template: AlimtalkTemplateName; orderId: string; shipmentId: string | null; parameters: Record<string, string> },
  log: (line: string) => void,
): Promise<AlimtalkNoticeResult> {
  const claim = await prepared.repository.claim(input.template, input.orderId, input.shipmentId);
  if (!claim.ok) return { status: 'skipped', reason: claim.reason };
  let result: AlimtalkSendResult;
  try {
    result = await prepared.sender.send({
      templateCode: prepared.templateCode,
      recipientNo: claim.recipientNo,
      templateParameter: input.parameters,
      idempotencyKey: claim.claimToken,
    });
  } catch {
    result = { status: 'unknown', error: 'unexpected_send_failure' };
  }
  let recorded = false;
  try {
    recorded = await prepared.repository.complete(claim, result);
  } catch {
    recorded = false;
  }
  if (!recorded) log(`[alimtalk] delivery_record_failed (order:${input.orderId})`);
  if (result.status === 'sent') return { status: 'sent' };
  return { status: 'failed', error: result.error };
}

/** 결제 확인(주문 접수) 알림톡. 결제 확정 훅에서 주문 확인 메일과 나란히 부른다. */
export function sendOrderConfirmationAlimtalk(orderId: string, dependencies: AlimtalkNoticeDependencies = {}): Promise<AlimtalkNoticeResult> {
  const log = dependencies.log ?? console.error;
  return safely('order confirmation', orderId, log, async () => {
    const prepared = prepare('order_confirmation', dependencies);
    if ('skipped' in prepared) return { status: 'skipped', reason: prepared.skipped };
    if (!isUuid(orderId)) return { status: 'skipped', reason: 'invalid_order_reference' };
    const order = await prepared.repository.loadOrder(orderId);
    if (!order) return { status: 'skipped', reason: 'order_missing' };
    if (!ACCURATE_ORDER_STATUSES.order_confirmation.includes(order.status)) {
      return { status: 'skipped', reason: `order_status_mismatch:${order.status}` };
    }
    return deliver(prepared, {
      template: 'order_confirmation', orderId, shipmentId: null,
      parameters: orderConfirmationParameters({
        orderId, orderReference: orderReferenceLabel(orderId, order.orderNumber),
        itemNames: visibleItemNames(order.items), total: order.total,
      }),
    }, log);
  });
}

/** 발송 시작 알림톡. 배송 건 id가 없으면 배송 건이 하나뿐인 주문에서만 보낸다(이메일과 같은 규칙). */
export function sendOrderShippedAlimtalk(
  input: { orderId: string; shipmentId?: string },
  dependencies: AlimtalkNoticeDependencies = {},
): Promise<AlimtalkNoticeResult> {
  const log = dependencies.log ?? console.error;
  return safely('order shipped', input.orderId, log, async () => {
    const prepared = prepare('order_shipped', dependencies);
    if ('skipped' in prepared) return { status: 'skipped', reason: prepared.skipped };
    if (!isUuid(input.orderId) || (input.shipmentId !== undefined && !isUuid(input.shipmentId))) {
      return { status: 'skipped', reason: 'invalid_order_reference' };
    }
    const order = await prepared.repository.loadOrder(input.orderId);
    if (!order) return { status: 'skipped', reason: 'order_missing' };
    if (!ACCURATE_ORDER_STATUSES.order_shipped.includes(order.status)) {
      return { status: 'skipped', reason: `order_status_mismatch:${order.status}` };
    }
    if (await prepared.repository.isGiftOrder(input.orderId)) return { status: 'skipped', reason: 'gift_order' };
    const shipments = await prepared.repository.loadShipments(input.orderId);
    const shipment = input.shipmentId
      ? shipments.find((item) => item.id === input.shipmentId)
      : shipments.length === 1 ? shipments[0] : undefined;
    if (!shipment) return { status: 'skipped', reason: 'shipment_reference_required' };
    if (!['shipping', 'delivered'].includes(shipment.status)) return { status: 'skipped', reason: 'shipment_status_mismatch' };
    const carrierLabel = shipment.carrierLabel?.trim();
    const trackingNumber = shipment.trackingNumber?.trim();
    if (!carrierLabel || !trackingNumber) return { status: 'skipped', reason: 'tracking_missing' };
    const items = order.items.filter((item) => shipment.orderItemIds.includes(item.id));
    if (!items.length) return { status: 'skipped', reason: 'shipment_items_missing' };
    return deliver(prepared, {
      template: 'order_shipped', orderId: input.orderId, shipmentId: shipment.id,
      parameters: orderShippedParameters({
        orderId: input.orderId, orderReference: orderReferenceLabel(input.orderId, order.orderNumber),
        itemNames: visibleItemNames(items), carrierLabel, trackingNumber,
      }),
    }, log);
  });
}
