import 'server-only';

/*
 * 토스 에스크로(구매안전서비스) 작업자 — 배송 등록·정정과 거래 상태 확인(ADR-0049 결정 6).
 *
 * 공식문서(MCP 2026-11-23 실조회): 에스크로 가이드 /guides/v2/escrow, 부가 API /reference/additional#에스크로.
 *  - 에스크로 결제의 Payment에는 `useEscrow: true`와 `escrowKey`(= 거래 id, 가상계좌는 입금 뒤에 채워진다)가 실린다.
 *  - 거래 조회 GET /v2/escrows/{id} → Escrow(status·products[].id·deliveryIds). 결제 요청에 escrowProducts를 싣지 않았으므로
 *    상품은 주문 하나다. 배송 등록 POST /v2/deliveries의 targetId는 그 products[].id다(우리 배송 건 id가 아니다).
 *  - 배송 등록은 상품당 한 번이고 택배(SHIPMENT: carrierCode·trackingNumber·shippedAt) 또는 직접 전달(DIRECT: receivedAt·
 *    receiverName·receiverRelation)이다. 정정은 배송중(IN_TRANSIT) 택배만 POST /v2/deliveries/{id}.
 *  - v2 응답은 `{ version, traceId, entityType, entityBody }`, 오류는 `{ error: { code, message } }`다.
 * 무엇을 언제 등록할지는 DB가 정한다(private.toss_escrow_deliveries). 이 모듈은 토스를 부르고 결과를 분류만 한다 — 결과는
 * 운영자 확인이 필요한 것(manual_required)과 다시 시도할 것(retry)을 나눈다. 토스 응답 원문은 남기지 않는다.
 *
 * 키(토스 공식 문서 'API 키' /reference/using-api/api-keys): 주문서형 결제 시크릿 키(gsk)는 코어 API(결제 승인·취소·paymentKey로 결제
 * 조회·거래 조회·정산 조회)만 부를 수 있고, 에스크로 거래 조회·배송 등록·수정은 부가서비스 API라 API 개별 연동 시크릿 키(sk)로 부른다.
 * 그래서 결제 조회(useEscrow·escrowKey 읽기)는 결제 키로, /v2/escrows·/v2/deliveries는 에스크로 키로 부른다. 키가 거절되면
 * (401·403·UNAUTHORIZED_KEY 등) 작업을 운영자 확인으로 굳히지 않고 다시 시도로 둔다 — 키를 고치면 다음 회차에 다시 돈다.
 */

const TOSS_API_ORIGIN = 'https://api.tosspayments.com';
const REQUEST_TIMEOUT_MS = 8_000;
const MAX_RESPONSE_BYTES = 64 * 1024;
const PAYMENT_KEY = /^[\x21-\x7e]{1,200}$/;
const OPAQUE_ID = /^[\x21-\x7e]{1,64}$/;
const ERROR_CODE = /^[A-Za-z0-9_.:-]{1,64}$/;
/** 키·인증 축의 거절(문서 'API 키' 에러 표, 에러 코드 문서) — 사람이 키를 고칠 일이지 이 작업을 직접 등록할 일이 아니다. */
const KEY_REJECTED_CODES = new Set([
  'UNAUTHORIZED_KEY',
  'INVALID_API_KEY',
  'INCORRECT_BASIC_AUTH_FORMAT',
  'FORBIDDEN_REQUEST',
  'API_KEY_ACCESS_DENIED',
]);
/** 키 거절로 다시 시도하는 작업의 확인 코드. 시스템 상태가 이 코드를 '키 거절'로 보인다. */
export const TOSS_ESCROW_KEY_REJECTED = 'toss_escrow_key_rejected';
export const TOSS_PAYMENT_KEY_REJECTED = 'toss_payment_key_rejected';

/**
 * 우리 택배사 코드(public.shipping_carriers.code) → 토스 택배사 코드(/codes/org-codes 택배사 코드, 대소문자 무관).
 * 목록에 없는 택배사는 자동 등록하지 않고 운영자 확인으로 넘긴다(코드를 추측하지 않는다).
 */
export const TOSS_ESCROW_CARRIER_CODES: Readonly<Record<string, string>> = Object.freeze({
  hanjin: 'HJ',
  epost: 'PO',
  cj: 'CJ',
  cjlogistics: 'CJ',
  lotte: 'LOTTE',
  logen: 'LG',
  kdexp: 'KD',
  daesin: 'DS',
  ilyang: 'IY',
  chunil: 'CI',
  hdexp: 'HA',
  cvsnet: 'CN',
});

export interface TossEscrowJob {
  readonly orderId: string;
  readonly attemptId: string;
  readonly state: 'ready' | 'registered' | 'waiting';
  readonly deliveryMethod: 'SHIPMENT' | 'DIRECT' | null;
  readonly carrier: string | null;
  readonly trackingNumber: string | null;
  readonly shippedAt: string | null;
  readonly receivedAt: string | null;
  readonly escrowKey: string | null;
  readonly tossDeliveryId: string | null;
  readonly revision: number;
  readonly paymentKey: string | null;
  readonly recipientName: string | null;
}

export type TossEscrowStatus = 'IN_PROGRESS' | 'CANCEL_REQUESTED' | 'CONFIRMED' | 'CANCELED';

export interface TossEscrowJobResult {
  readonly outcome: 'registered' | 'skipped' | 'manual_required' | 'retry' | 'status_only';
  readonly escrowKey?: string;
  readonly tossDeliveryId?: string;
  readonly escrowStatus?: TossEscrowStatus;
  readonly errorCode?: string;
}

interface ProviderResponse {
  readonly status: number;
  readonly payload: unknown;
}

function plainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function entityBody(payload: unknown): Record<string, unknown> | null {
  if (!plainRecord(payload)) return null;
  return plainRecord(payload.entityBody) ? payload.entityBody : payload;
}

function providerErrorCode(payload: unknown): string | null {
  if (!plainRecord(payload)) return null;
  const nested = plainRecord(payload.error) ? payload.error.code : undefined;
  const code = typeof nested === 'string' ? nested : payload.code;
  return typeof code === 'string' && ERROR_CODE.test(code) ? code : null;
}

function escrowStatus(value: unknown): TossEscrowStatus | undefined {
  return value === 'IN_PROGRESS' || value === 'CANCEL_REQUESTED' || value === 'CONFIRMED' || value === 'CANCELED'
    ? value
    : undefined;
}

/** ISO 시각을 토스 형식 `yyyy-MM-dd'T'HH:mm:ss+09:00`(KST)으로. */
export function tossKstTimestamp(iso: string): string | null {
  const time = Date.parse(iso);
  if (!Number.isFinite(time)) return null;
  const kst = new Date(time + 9 * 60 * 60_000).toISOString().slice(0, 19);
  return `${kst}+09:00`;
}

export function createTossEscrowWorker(options: {
  /** 결제 시크릿 키(gsk) — paymentKey로 결제 조회. */
  readonly paymentSecretKey: string;
  /** 에스크로 부가서비스 API 키(API 개별 연동 sk) — 거래 조회·배송 등록·수정. */
  readonly escrowSecretKey: string;
  readonly fetch?: typeof fetch;
}) {
  const fetchImpl = options.fetch ?? fetch;
  const basic = (key: string) => `Basic ${Buffer.from(`${key}:`, 'utf8').toString('base64')}`;
  const authorizations = { payment: basic(options.paymentSecretKey), escrow: basic(options.escrowSecretKey) } as const;

  async function request(path: string, init: {
    method: 'GET' | 'POST'; body?: unknown; idempotencyKey?: string; credential: 'payment' | 'escrow';
  }) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const response = await fetchImpl(new URL(path, TOSS_API_ORIGIN).toString(), {
        method: init.method,
        headers: {
          authorization: authorizations[init.credential],
          accept: 'application/json',
          ...(init.body ? { 'content-type': 'application/json' } : {}),
          ...(init.idempotencyKey ? { 'idempotency-key': init.idempotencyKey } : {}),
        },
        body: init.body ? JSON.stringify(init.body) : undefined,
        cache: 'no-store',
        signal: controller.signal,
      });
      const text = await response.text();
      if (text.length > MAX_RESPONSE_BYTES) return null;
      let payload: unknown;
      try {
        payload = text ? JSON.parse(text) : undefined;
      } catch {
        payload = undefined;
      }
      return { status: response.status, payload } satisfies ProviderResponse;
    } catch {
      return null;
    } finally {
      clearTimeout(timeout);
    }
  }

  /**
   * 토스 응답 분류 — 전송 실패·5xx·반복 요청 제한은 다시 시도, 키·인증 거절(401·403·키 오류 코드)도 다시 시도(키를 고치면 풀린다),
   * 그 밖의 4xx는 운영자 확인.
   */
  function failure(response: ProviderResponse | null, fallback: string, credential: 'payment' | 'escrow'): TossEscrowJobResult {
    if (!response || response.status >= 500 || response.status === 429) {
      return { outcome: 'retry', errorCode: providerErrorCode(response?.payload) ?? (response ? `http_${response.status}` : 'transport') };
    }
    const code = providerErrorCode(response.payload);
    if (code === 'FORBIDDEN_CONSECUTIVE_REQUEST') return { outcome: 'retry', errorCode: code };
    if (response.status === 401 || response.status === 403 || (code !== null && KEY_REJECTED_CODES.has(code))) {
      return { outcome: 'retry', errorCode: credential === 'escrow' ? TOSS_ESCROW_KEY_REJECTED : TOSS_PAYMENT_KEY_REJECTED };
    }
    return { outcome: 'manual_required', errorCode: code ?? `${fallback}_${response.status}` };
  }

  async function resolveEscrowKey(job: TossEscrowJob): Promise<{ escrowKey: string } | TossEscrowJobResult> {
    if (job.escrowKey && OPAQUE_ID.test(job.escrowKey)) return { escrowKey: job.escrowKey };
    if (!job.paymentKey || !PAYMENT_KEY.test(job.paymentKey)) return { outcome: 'manual_required', errorCode: 'payment_key_missing' };
    const response = await request(`/v1/payments/${encodeURIComponent(job.paymentKey)}`, { method: 'GET', credential: 'payment' });
    if (!response || response.status !== 200 || !plainRecord(response.payload)) return failure(response, 'payment_inquiry', 'payment');
    const payment = response.payload;
    if (payment.paymentKey !== job.paymentKey) return { outcome: 'manual_required', errorCode: 'payment_key_mismatch' };
    // 에스크로 사용 여부는 useEscrow로만 판별한다(escrowKey null 여부로 판별하지 않는다 — 문서 "에스크로 결제 판별하기").
    if (payment.useEscrow !== true) return { outcome: 'skipped' };
    const escrowKey = payment.escrowKey;
    if (typeof escrowKey !== 'string' || !OPAQUE_ID.test(escrowKey)) return { outcome: 'retry', errorCode: 'escrow_key_pending' };
    return { escrowKey };
  }

  return {
    async process(job: TossEscrowJob): Promise<TossEscrowJobResult> {
      const resolved = await resolveEscrowKey(job);
      if ('outcome' in resolved) return resolved;
      const { escrowKey } = resolved;

      const escrowResponse = await request(`/v2/escrows/${encodeURIComponent(escrowKey)}`, { method: 'GET', credential: 'escrow' });
      if (!escrowResponse || escrowResponse.status !== 200) return { ...failure(escrowResponse, 'escrow_inquiry', 'escrow'), escrowKey };
      const escrow = entityBody(escrowResponse.payload);
      const status = escrowStatus(escrow?.status);
      if (!escrow || !status) return { outcome: 'retry', escrowKey, errorCode: 'escrow_response_invalid' };

      if (job.state !== 'ready') return { outcome: 'status_only', escrowKey, escrowStatus: status };
      // 거래가 이미 끝났으면(확정·취소) 등록할 것이 없다. 구매자 취소 신청 중이면 등록하지 않고 상태만 남긴다 — DB가 출고
      // 보류를 걸고 운영자가 신청을 수락(운영자 전액 취소)하거나 구매확정 요청을 다시 보낸다.
      if (status === 'CONFIRMED' || status === 'CANCELED') return { outcome: 'skipped', escrowKey, escrowStatus: status };
      if (status === 'CANCEL_REQUESTED') return { outcome: 'status_only', escrowKey, escrowStatus: status };

      const products = Array.isArray(escrow.products) ? escrow.products.filter(plainRecord) : [];
      const productId = products[0]?.id;
      if (products.length !== 1 || typeof productId !== 'string' || !OPAQUE_ID.test(productId)) {
        return { outcome: 'manual_required', escrowKey, escrowStatus: status, errorCode: 'escrow_products_unexpected' };
      }
      const deliveryIds = Array.isArray(escrow.deliveryIds) ? escrow.deliveryIds.filter((id): id is string => typeof id === 'string' && OPAQUE_ID.test(id)) : [];

      let body: Record<string, unknown>;
      if (job.deliveryMethod === 'SHIPMENT') {
        const carrierCode = job.carrier ? TOSS_ESCROW_CARRIER_CODES[job.carrier] : undefined;
        const shippedAt = job.shippedAt ? tossKstTimestamp(job.shippedAt) : null;
        if (!carrierCode) return { outcome: 'manual_required', escrowKey, escrowStatus: status, errorCode: 'carrier_unmapped' };
        if (!job.trackingNumber || !shippedAt) return { outcome: 'manual_required', escrowKey, escrowStatus: status, errorCode: 'shipment_incomplete' };
        body = { deliveryMethod: 'SHIPMENT', shipment: { carrierCode, trackingNumber: job.trackingNumber, shippedAt } };
      } else if (job.deliveryMethod === 'DIRECT') {
        const receivedAt = job.receivedAt ? tossKstTimestamp(job.receivedAt) : null;
        if (!receivedAt) return { outcome: 'manual_required', escrowKey, escrowStatus: status, errorCode: 'direct_incomplete' };
        const receiverName = (job.recipientName ?? '').trim().slice(0, 50) || '구매자';
        body = { deliveryMethod: 'DIRECT', direct: { receivedAt, receiverName, receiverRelation: 'BUYER' } };
      } else {
        return { outcome: 'manual_required', escrowKey, escrowStatus: status, errorCode: 'delivery_method_missing' };
      }

      const existingDeliveryId = job.tossDeliveryId ?? deliveryIds[0];
      if (existingDeliveryId) {
        // 등록한 적이 있다(우리 기록이 남았거나 기록을 잃었거나). 정정은 택배 → 택배만 — 수정 API로 송장 정보만 고친다.
        if (job.deliveryMethod !== 'SHIPMENT') {
          return { outcome: 'registered', escrowKey, escrowStatus: status, tossDeliveryId: existingDeliveryId };
        }
        const updated = await request(`/v2/deliveries/${encodeURIComponent(existingDeliveryId)}`, {
          method: 'POST',
          body: { deliveryMethod: 'SHIPMENT', shipment: (body.shipment as Record<string, unknown>) },
          credential: 'escrow',
        });
        if (!updated || updated.status !== 200) return { ...failure(updated, 'delivery_update', 'escrow'), escrowKey, escrowStatus: status };
        return { outcome: 'registered', escrowKey, escrowStatus: status, tossDeliveryId: existingDeliveryId };
      }

      const registered = await request('/v2/deliveries', {
        method: 'POST',
        idempotencyKey: `escrow-delivery:${job.orderId}:${job.revision}`,
        body: { targetType: 'ESCROW_PRODUCT', targetId: productId, ...body },
        credential: 'escrow',
      });
      if (!registered || registered.status !== 200) return { ...failure(registered, 'delivery_register', 'escrow'), escrowKey, escrowStatus: status };
      const delivery = entityBody(registered.payload);
      const deliveryId = delivery?.id;
      return {
        outcome: 'registered',
        escrowKey,
        escrowStatus: status,
        ...(typeof deliveryId === 'string' && OPAQUE_ID.test(deliveryId) ? { tossDeliveryId: deliveryId } : {}),
      };
    },
  };
}
