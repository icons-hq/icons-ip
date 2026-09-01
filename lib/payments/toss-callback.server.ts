import 'server-only';

// 토스 주문서형 v2 successUrl 리다이렉트 계약(공식문서 MCP 실조회):
// {successUrl}?paymentType={..}&amount={..}&orderId={..}&paymentKey={..}
// 단회용 callback nonce는 쿼리 보존이 문서로 보장되지 않아 successUrl 경로
// 세그먼트에 싣는다 — 라우트가 경로에서 꺼내 이 파서에 넘긴다.
const CALLBACK_QUERY_FIELDS = ['paymentType', 'amount', 'orderId', 'paymentKey'] as const;
const NONCE_PATTERN = /^[A-Za-z0-9_-]{16,255}$/;
const PROVIDER_ORDER_ID = /^[OT][0-9a-f]{32}$/i;
const PAYMENT_KEY = /^[\x21-\x7e]{1,200}$/;
const AMOUNT = /^[1-9][0-9]{0,11}$/;
const PAYMENT_TYPE = /^[A-Z]{1,20}$/;

export class TossCallbackInvalidError extends Error {}

/**
 * successUrl 쿼리를 도메인이 아는 형태로만 줄인다. 값 검증은 형식까지만이고
 * attempt와의 대조(금액·orderId·nonce)는 게이트웨이 어댑터의 몫이다. 허용 밖
 * 쿼리 키는 폐기한다 — provider가 파라미터를 늘려도 콜백이 깨지지 않는다.
 */
export function parseTossSuccessCallback(requestUrl: URL, nonce: string) {
  if (!NONCE_PATTERN.test(nonce)) throw new TossCallbackInvalidError();
  for (const field of CALLBACK_QUERY_FIELDS) {
    if (requestUrl.searchParams.getAll(field).length > 1) {
      throw new TossCallbackInvalidError();
    }
  }
  const paymentKey = requestUrl.searchParams.get('paymentKey');
  const orderId = requestUrl.searchParams.get('orderId');
  const amount = requestUrl.searchParams.get('amount');
  const paymentType = requestUrl.searchParams.get('paymentType');
  if (
    typeof paymentKey !== 'string'
    || !PAYMENT_KEY.test(paymentKey)
    || typeof orderId !== 'string'
    || !PROVIDER_ORDER_ID.test(orderId)
    || typeof amount !== 'string'
    || !AMOUNT.test(amount)
    || (paymentType !== null && !PAYMENT_TYPE.test(paymentType))
  ) {
    throw new TossCallbackInvalidError();
  }

  return {
    providerOrderId: orderId,
    callbackNonce: nonce,
    providerPayload: {
      paymentKey,
      orderId,
      amount,
      ...(paymentType === null ? {} : { paymentType }),
    },
  };
}

/** 사용자 브라우저 GET 콜백을 결과 화면으로 돌려보내는 303. */
export function tossCallbackRedirect(location: string) {
  return new Response(null, {
    status: 303,
    headers: {
      location,
      'cache-control': 'no-store',
      'referrer-policy': 'no-referrer',
    },
  });
}
