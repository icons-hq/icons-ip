import 'server-only';

// 나이스페이 웹표준 인증 응답(결제창 호출하기 4절). 모바일은 나이스페이가 ReturnURL로, PC는
// 결제 페이지의 nicepaySubmit()이 결제 폼을 같은 주소로 POST한다. 어느 쪽이든 구매자
// 브라우저가 실어 오는 값이라 진실원이 아니다 — 대조는 게이트웨이 어댑터가 서버의 attempt와
// MerchantKey 서명으로 한다. 이 파서는 크기·형식만 줄인다.
const MAX_CALLBACK_BYTES = 64 * 1024;
// 판정에 쓰는 필드만 받는다. 상품명·구매자명·결과 메시지(한글, EUC-KR일 수 있다)는 버린다 —
// 응답 필드는 사전 고지 없이 늘 수 있으므로 모르는 필드로 파싱이 깨지지 않게 한다.
const CALLBACK_FIELDS = [
  'AuthResultCode',
  'AuthToken',
  'PayMethod',
  'MID',
  'Moid',
  'Signature',
  'Amt',
  'ReqReserved',
  'TxTid',
  'NextAppURL',
  'NetCancelURL',
] as const;
const ASCII_VALUE = /^[\x20-\x7e]*$/;

export class NicepayCallbackTooLargeError extends Error {}
export class NicepayCallbackInvalidError extends Error {}

async function readBoundedBody(request: Request) {
  const declaredLength = Number(request.headers.get('content-length') ?? '0');
  if (Number.isFinite(declaredLength) && declaredLength > MAX_CALLBACK_BYTES) {
    throw new NicepayCallbackTooLargeError();
  }
  if (!request.body) throw new NicepayCallbackInvalidError();

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_CALLBACK_BYTES) {
      await reader.cancel();
      throw new NicepayCallbackTooLargeError();
    }
    chunks.push(value);
  }
  const body = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  // urlencoded 본문 자체는 ASCII다. 한글 값은 %XX로 오며 문자셋(EUC-KR·UTF-8)은 폼 설정을
  // 따른다 — 판정 필드는 ASCII뿐이라 바이트 단위(latin1)로 읽고 아래에서 ASCII만 받는다.
  return new TextDecoder('latin1').decode(body);
}

/** Bounded parser that admits only the authentication-response fields the adapter verifies. */
export async function parseNicepayCallback(request: Request) {
  const contentType = request.headers.get('content-type')?.toLowerCase() ?? '';
  if (contentType.split(';', 1)[0]?.trim() !== 'application/x-www-form-urlencoded') {
    throw new NicepayCallbackInvalidError();
  }
  const values = new URLSearchParams(await readBoundedBody(request));
  const payload: Record<string, string> = {};
  for (const field of CALLBACK_FIELDS) {
    const all = values.getAll(field);
    if (all.length === 0) continue;
    // PC 결제창은 인증 결과를 결제 폼에 더해 submit한다 — 요청 때 넣은 같은 이름의 값과 함께
    // 올 수 있다. 값이 모두 같으면 하나로 보고, 다르면 거절한다.
    if (all.some((value) => value !== all[0])) throw new NicepayCallbackInvalidError();
    const value = all[0]!;
    if (value.length > 500 || !ASCII_VALUE.test(value)) throw new NicepayCallbackInvalidError();
    payload[field] = value;
  }

  const moid = payload.Moid;
  const nonce = payload.ReqReserved;
  if (
    typeof payload.AuthResultCode !== 'string'
    || !/^[A-Za-z0-9]{4}$/.test(payload.AuthResultCode)
    || typeof moid !== 'string'
    || !/^O[0-9a-f]{32}$/i.test(moid)
    || typeof nonce !== 'string'
    || !/^[A-Za-z0-9_-]{16,255}$/.test(nonce)
    || typeof payload.MID !== 'string'
    || !/^[A-Za-z0-9]{10}$/.test(payload.MID)
    || typeof payload.Amt !== 'string'
    || !/^[0-9]{1,12}$/.test(payload.Amt)
  ) {
    throw new NicepayCallbackInvalidError();
  }

  return {
    providerOrderId: moid,
    callbackNonce: nonce,
    providerPayload: payload,
  };
}

/** 구매자 브라우저 POST 콜백을 결과 화면으로 돌려보내는 303. */
export function nicepayCallbackRedirect(location: string) {
  return new Response(null, {
    status: 303,
    headers: {
      location,
      'cache-control': 'no-store',
      'referrer-policy': 'no-referrer',
    },
  });
}
