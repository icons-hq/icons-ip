import 'server-only';

// 토스 웹훅(PAYMENT_STATUS_CHANGED) 수신 계약(2026-09-01 공식문서 MCP 실조회):
// POST JSON { eventType, createdAt, data: Payment }. 일반 결제 웹훅에는 서명
// 헤더가 없으므로 본문은 어떤 상태 반영의 근거도 되지 않는다 — 여기서는 어느
// attempt를 재정합화할지(orderId)만 읽고 전부 버린다. raw payload는 저장하지
// 않는다.
const MAX_WEBHOOK_BYTES = 64 * 1024;
const PROVIDER_ORDER_ID = /^[OT][0-9a-f]{32}$/i;
const EVENT_TYPE = /^[A-Z_]{2,64}$/;
const CASE_REF = /^[A-Za-z0-9_-]{16,128}$/;

export class TossWebhookInvalidError extends Error {}

async function readBoundedBody(request: Request) {
  const declaredLength = Number(request.headers.get('content-length') ?? '0');
  if (Number.isFinite(declaredLength) && declaredLength > MAX_WEBHOOK_BYTES) {
    throw new TossWebhookInvalidError();
  }
  if (!request.body) throw new TossWebhookInvalidError();
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_WEBHOOK_BYTES) {
      await reader.cancel();
      throw new TossWebhookInvalidError();
    }
    chunks.push(value);
  }
  const body = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(body);
  } catch {
    throw new TossWebhookInvalidError();
  }
}

export type ParsedTossWebhook =
  | { readonly kind: 'payment_status_changed'; readonly providerOrderId: string }
  | { readonly kind: 'unsupported_event' }
  | { readonly kind: 'unknown_reference' };

/**
 * 웹훅 본문을 재정합 대상 식별자 하나로 줄인다. 형식 위반은 throw(→400 —
 * 개발자센터 실패 기록으로 관측), 비지원 이벤트·미지 식별자는 종류만 돌려준다
 * (→200 ack — 재전송해도 처리할 것이 없다).
 */
export async function parseTossWebhook(request: Request): Promise<ParsedTossWebhook> {
  const contentType = request.headers.get('content-type')?.toLowerCase() ?? '';
  if (contentType.split(';', 1)[0]?.trim() !== 'application/json') {
    throw new TossWebhookInvalidError();
  }
  let payload: unknown;
  try {
    payload = JSON.parse(await readBoundedBody(request));
  } catch (error) {
    if (error instanceof TossWebhookInvalidError) throw error;
    throw new TossWebhookInvalidError();
  }
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
    throw new TossWebhookInvalidError();
  }
  const eventType = (payload as Record<string, unknown>).eventType;
  if (typeof eventType !== 'string' || !EVENT_TYPE.test(eventType)) {
    throw new TossWebhookInvalidError();
  }
  if (eventType !== 'PAYMENT_STATUS_CHANGED') return { kind: 'unsupported_event' };

  const data = (payload as Record<string, unknown>).data;
  const orderId = typeof data === 'object' && data !== null && !Array.isArray(data)
    ? (data as Record<string, unknown>).orderId
    : undefined;
  if (typeof orderId !== 'string' || !PROVIDER_ORDER_ID.test(orderId)) {
    return { kind: 'unknown_reference' };
  }
  return { kind: 'payment_status_changed', providerOrderId: orderId };
}

/** 재정합 감사에 실을 case_ref — 토스 전송 id가 형식에 맞으면 그대로 쓴다. */
export function tossWebhookCaseRef(request: Request, fallback: () => string) {
  const transmissionId = request.headers.get('tosspayments-webhook-transmission-id');
  if (typeof transmissionId === 'string' && CASE_REF.test(transmissionId)) {
    return transmissionId;
  }
  const generated = `webhook-${fallback()}`;
  return CASE_REF.test(generated) ? generated : null;
}
