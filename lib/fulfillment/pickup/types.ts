/**
 * 반품 자동 회수 접수 seam(QNA-032·ADR-0034). 택배사(우체국·한진 반품 회수 — 계약 전) API마다 다른 요청·응답을 이 모양으로
 * 맞춘다. 무엇을 언제 접수·취소할지와 상태 전이는 DB만 정한다(`service_return_pickup_work`·`service_record_return_pickup_results`) —
 * 어댑터·크론은 DB가 넘긴 일을 택배사에 옮기고 결과를 돌려줄 뿐이다.
 *
 * 개인정보: 택배사에 보내는 것은 회수지(고객) 최소 필드(받는 분 이름·연락처·우편번호·주소)와 반품지(받는 곳)뿐이다. 어댑터는 이 값을
 * 로그·오류 코드·결과에 남기지 않는다. 결과에는 회수 송장·택배사 예약 번호·오류 코드만 싣는다.
 */

/** 회수지(고객 쪽) 주소. 클레임 연락처 정정과 같은 다섯 칸이다. */
export interface PickupAddress {
  recipientName: string;
  phone: string;
  postalCode: string;
  address1: string;
  address2: string;
}

/** 반품지(받는 곳). 주소록 반품지면 이름·연락처가 있고, 출고지 반품 주소면 이름은 출고지 이름·연락처는 빈 값이다. */
export interface PickupReceiver { name: string; phone: string; address: string }

/** 택배사에 보낼 회수 접수 한 건. */
export interface ReturnPickupRequest {
  /** 같은 회수 묶음은 늘 같은 값이다. 재시도·응답 유실 뒤 다시 보내도 수거가 두 번 잡히지 않게 택배사에 함께 보낸다. */
  idempotencyKey: string;
  /** ICONS 택배사 코드(`shipping_carriers.code`) — 그 출고지의 회수 계약 택배사. 서비스별 코드로 바꾸는 일은 어댑터 몫이다. */
  carrier: string;
  /** 원래 출고 운송장(반품 접수에 원송장을 받는 택배사용). 없을 수 있다. */
  outboundTrackingNumber: string | null;
  sender: PickupAddress;
  receiver: PickupReceiver;
  items: { name: string; qty: number }[];
}

export type ReturnPickupRequestResult =
  | { outcome: 'requested'; trackingNumber: string; externalId?: string }
  | { outcome: 'error'; errorCode: string };

/** 접수한 수거의 취소. 접수 응답을 받지 못했어도 멱등 키로 찾아 취소할 수 있어야 한다(어댑터 계약). */
export interface ReturnPickupCancelRequest {
  idempotencyKey: string;
  carrier: string;
  trackingNumber: string | null;
  externalId: string | null;
}

/** not_found는 택배사에 접수된 것이 없다는 뜻이다(취소할 것이 없음 — DB는 취소 완료로 본다). */
export type ReturnPickupCancelResult = { outcome: 'canceled' | 'not_found' } | { outcome: 'error'; errorCode: string };

/** 택배사 어댑터. `provider`는 DB 스위치(`private.return_pickup_settings.provider`)와 큐 행에 적힌 이름과 같아야 쓰인다. */
export interface ReturnPickupAdapter {
  readonly provider: string;
  request(input: ReturnPickupRequest, signal: AbortSignal): Promise<ReturnPickupRequestResult>;
  cancel(input: ReturnPickupCancelRequest, signal: AbortSignal): Promise<ReturnPickupCancelResult>;
}

/** DB가 넘긴 회수지. 회수 주소 정정이 있으면 암호문이고(앱 서버가 클레임 연락처 키로 연다), 아니면 평문 다섯 칸이다. */
export type PickupSender =
  | { source: 'plain'; address: PickupAddress }
  | { source: 'sealed'; orderId: string; claimId: string; plan: SealedPickupPlan };

export interface SealedPickupPlan {
  planId: string;
  piiVersion: string;
  keyVersion: string;
  addressHmac: string;
  addressHmacKeyVersion: string;
  address: Record<string, unknown>;
}

/** 크론이 받은 할 일 한 건(`service_return_pickup_work`의 items 원소). */
export type ReturnPickupWorkItem =
  | {
    kind: 'request'; pickupId: string; leaseToken: string; provider: string; idempotencyKey: string; carrier: string;
    outboundTrackingNumber: string | null; sender: PickupSender | null; receiver: PickupReceiver; items: { name: string; qty: number }[];
  }
  | {
    kind: 'cancel'; pickupId: string; leaseToken: string; provider: string; idempotencyKey: string; carrier: string;
    trackingNumber: string | null; externalId: string | null;
  };

/** DB에 남기는 결과 한 건(`service_record_return_pickup_results`의 results 원소). 개인정보는 싣지 않는다. */
export type ReturnPickupResult =
  | { pickupId: string; leaseToken: string; kind: 'request'; outcome: 'requested'; trackingNumber: string; externalId?: string }
  | { pickupId: string; leaseToken: string; kind: 'request'; outcome: 'error'; errorCode: string }
  | { pickupId: string; leaseToken: string; kind: 'cancel'; outcome: 'canceled' | 'not_found' }
  | { pickupId: string; leaseToken: string; kind: 'cancel'; outcome: 'error'; errorCode: string }
  /** 회차 시간 예산이 끝나 보내지 않은 일 — DB가 임대를 풀고 이번 회차가 센 시도를 되돌린다. */
  | { pickupId: string; leaseToken: string; kind: 'request' | 'cancel'; outcome: 'deferred' };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const ERROR_CODE = /^[a-z0-9_]{1,64}$/;
const PROVIDER = /^[a-z][a-z0-9_]{1,31}$/;
const IDEMPOTENCY_KEY = /^[a-z0-9-]{8,64}$/;
const EXTERNAL_ID = /^[\x21-\x7e]{1,100}$/;

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
const text = (value: unknown, max: number): value is string => typeof value === 'string' && value.length <= max && !/[\u0000-\u001f\u007f]/u.test(value);
const nullableText = (value: unknown, max: number): value is string | null => value === null || text(value, max);

/** 오류 코드는 DB가 받는 형식만 남긴다(택배사 오류 본문·개인정보가 섞이지 않게). */
export function pickupErrorCode(value: unknown): string {
  return typeof value === 'string' && ERROR_CODE.test(value) ? value : 'upstream_error';
}

/** 회수 송장 정규화: 영문·숫자만 남기고 대문자로. DB와 같은 8~30자가 아니면 null. */
export function normalizePickupTrackingNumber(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.replace(/[^A-Za-z0-9]/gu, '').toUpperCase();
  return /^[A-Z0-9]{8,30}$/u.test(normalized) ? normalized : null;
}

export function normalizePickupExternalId(value: unknown): string | undefined {
  return typeof value === 'string' && EXTERNAL_ID.test(value) ? value : undefined;
}

export function parsePickupAddress(value: unknown): PickupAddress | null {
  if (!record(value)) return null;
  const fields = ['recipientName', 'phone', 'postalCode', 'address1', 'address2'] as const;
  if (!fields.every(field => text(value[field], 200))) return null;
  const address = Object.fromEntries(fields.map(field => [field, String(value[field]).trim()])) as unknown as PickupAddress;
  return address.recipientName && address.phone && address.postalCode && address.address1 ? address : null;
}

function parseSender(value: unknown): PickupSender | null {
  if (!record(value)) return null;
  if (value.source === 'plain') {
    const address = parsePickupAddress(value.address);
    return address ? { source: 'plain', address } : null;
  }
  if (value.source === 'sealed' && typeof value.orderId === 'string' && UUID.test(value.orderId) && typeof value.claimId === 'string'
    && UUID.test(value.claimId) && record(value.plan)) {
    const plan = value.plan;
    if (typeof plan.planId === 'string' && UUID.test(plan.planId) && typeof plan.piiVersion === 'string' && UUID.test(plan.piiVersion)
      && text(plan.keyVersion, 64) && typeof plan.addressHmac === 'string' && /^[0-9a-f]{64}$/u.test(plan.addressHmac)
      && text(plan.addressHmacKeyVersion, 64) && record(plan.address)) {
      return { source: 'sealed', orderId: value.orderId, claimId: value.claimId, plan: {
        planId: plan.planId, piiVersion: plan.piiVersion, keyVersion: plan.keyVersion, addressHmac: plan.addressHmac,
        addressHmacKeyVersion: plan.addressHmacKeyVersion, address: plan.address,
      } };
    }
  }
  return null;
}

/**
 * DB가 넘긴 할 일 한 건을 읽는다. 임대 열쇠(pickupId·leaseToken·kind)조차 읽을 수 없으면 null(결과를 남길 수 없다 — 임대가 끝나면
 * DB가 다시 넘긴다). 열쇠는 맞는데 나머지가 틀리면 `invalid`로 돌려 실패로 남기게 한다. 회수지가 없거나 틀리면 sender는 null이다.
 */
export function parseReturnPickupWorkItem(value: unknown): { item: ReturnPickupWorkItem } | { invalid: { pickupId: string; leaseToken: string; kind: 'request' | 'cancel' } } | null {
  if (!record(value) || typeof value.pickupId !== 'string' || !UUID.test(value.pickupId) || typeof value.leaseToken !== 'string'
    || !UUID.test(value.leaseToken) || (value.kind !== 'request' && value.kind !== 'cancel')) return null;
  const key: { pickupId: string; leaseToken: string; kind: 'request' | 'cancel' } = { pickupId: value.pickupId, leaseToken: value.leaseToken, kind: value.kind };
  if (typeof value.provider !== 'string' || !PROVIDER.test(value.provider) || typeof value.idempotencyKey !== 'string'
    || !IDEMPOTENCY_KEY.test(value.idempotencyKey) || !text(value.carrier, 40) || !value.carrier) return { invalid: key };
  if (value.kind === 'cancel') {
    if (!nullableText(value.trackingNumber, 30) || !nullableText(value.externalId, 100)) return { invalid: key };
    return { item: { ...key, kind: 'cancel', provider: value.provider, idempotencyKey: value.idempotencyKey, carrier: value.carrier,
      trackingNumber: value.trackingNumber, externalId: value.externalId } };
  }
  const receiver = value.receiver;
  if (!record(receiver) || !text(receiver.name, 100) || !text(receiver.phone, 20) || !text(receiver.address, 500) || !receiver.address.trim()
    || !nullableText(value.outboundTrackingNumber, 40) || !Array.isArray(value.items) || value.items.length === 0 || value.items.length > 200
    || !value.items.every(entry => record(entry) && text(entry.name, 300) && Number.isSafeInteger(entry.qty) && Number(entry.qty) >= 1)) return { invalid: key };
  return { item: {
    ...key, kind: 'request', provider: value.provider, idempotencyKey: value.idempotencyKey, carrier: value.carrier,
    outboundTrackingNumber: value.outboundTrackingNumber, sender: parseSender(value.sender),
    receiver: { name: receiver.name, phone: receiver.phone, address: receiver.address },
    items: (value.items as Record<string, unknown>[]).map(entry => ({ name: String(entry.name), qty: Number(entry.qty) })),
  } };
}
