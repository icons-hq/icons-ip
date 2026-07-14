import 'server-only';

import { paymentsEnabledForRuntime } from './config';
import { tossBasicAuthHeader } from './toss';

/* 토스페이먼츠 코어 API 호출 경계(#88). 시크릿 키는 서버 전용 env로만 읽는다.
 * 승인 성공은 UX 반영용이고 확정의 진실원은 웹훅 + 재조회 검증이다(ARCHITECTURE §9). */

const TOSS_API_BASE = 'https://api.tosspayments.com/v1';

export function getTossConfig() {
  const secretKey = process.env.TOSS_SECRET_KEY;
  return {
    secretKey,
    isConfigured: paymentsEnabledForRuntime(
      process.env.NEXT_PUBLIC_TOSS_CLIENT_KEY,
      secretKey,
    ),
  };
}

export type TossApiResult =
  | { ok: true; body: unknown }
  | { ok: false; status: number; code: string; message: string };

async function tossRequest(input: {
  method: 'GET' | 'POST';
  path: string;
  body?: unknown;
  idempotencyKey?: string;
  /** 웹훅 경로 호출은 토스의 '10초 내 200' 응답 시한 안에 들도록 짧게 상한을 건다. */
  timeoutMs: number;
}): Promise<TossApiResult> {
  const { secretKey } = getTossConfig();
  if (!secretKey) {
    return { ok: false, status: 0, code: 'NOT_CONFIGURED', message: 'TOSS_SECRET_KEY is not set' };
  }

  try {
    const response = await fetch(`${TOSS_API_BASE}${input.path}`, {
      method: input.method,
      headers: {
        Authorization: tossBasicAuthHeader(secretKey),
        ...(input.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(input.idempotencyKey ? { 'Idempotency-Key': input.idempotencyKey } : {}),
      },
      body: input.body !== undefined ? JSON.stringify(input.body) : undefined,
      cache: 'no-store',
      signal: AbortSignal.timeout(input.timeoutMs),
    });
    const parsed: unknown = await response.json().catch(() => null);

    if (!response.ok) {
      const { code, message } = (parsed ?? {}) as { code?: unknown; message?: unknown };
      return {
        ok: false,
        status: response.status,
        code: typeof code === 'string' ? code : 'UNKNOWN',
        message: typeof message === 'string' ? message : '토스페이먼츠 API 오류',
      };
    }
    return { ok: true, body: parsed };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      code: error instanceof Error && error.name === 'TimeoutError' ? 'TIMEOUT' : 'NETWORK_ERROR',
      message: error instanceof Error ? error.message : String(error),
    };
  }
}

/** 결제 승인 — successUrl 콜백 파라미터 그대로. Idempotency-Key로 재호출을 흡수한다.
 * 카드사 승인 지연 여지가 있어 여유 있게 두고, 타임아웃돼도 멱등키 재시도가 안전하다. */
export function confirmTossPayment(input: { paymentKey: string; orderId: string; amount: number }) {
  return tossRequest({
    method: 'POST',
    path: '/payments/confirm',
    body: input,
    idempotencyKey: input.paymentKey,
    timeoutMs: 60_000,
  });
}

/** 결제 조회 — 서명 없는 결제 웹훅의 진위를 시크릿 키 재조회로 검증하는 경로. */
export function fetchTossPayment(paymentKey: string) {
  return tossRequest({
    method: 'GET',
    path: `/payments/${encodeURIComponent(paymentKey)}`,
    timeoutMs: 5_000,
  });
}

/** 결제 취소 — 확정 불가 자동 환불과 본인 주문 취소에서 서버가 호출한다.
 * paymentKey 기반 고정 멱등키로 웹훅 재전송과 사용자 재시도를 안전하게 흡수한다. */
export function cancelTossPayment(paymentKey: string, cancelReason: string) {
  return tossRequest({
    method: 'POST',
    path: `/payments/${encodeURIComponent(paymentKey)}/cancel`,
    body: { cancelReason },
    idempotencyKey: `cancel-${paymentKey}`,
    timeoutMs: 5_000,
  });
}
