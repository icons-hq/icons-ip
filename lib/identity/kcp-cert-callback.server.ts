import 'server-only';

/*
 * KCP 인증창 → Ret_URL 콜백의 경계 파서.
 *
 * 샘플 기준 콜백은 form POST(application/x-www-form-urlencoded)다. 필요한 값은 ASCII인
 * res_cd·reg_cert_key 둘뿐이라, 본문은 latin1로 읽어 다른 인코딩의 res_msg 때문에 콜백이
 * 깨지지 않게 한다. res_msg와 param_opt_*는 읽지 않는다 — 표시·판정 어디에도 쓰지 않는다.
 * GET 쿼리로 오는 경우도 같은 두 값만 본다.
 */

const MAX_CALLBACK_BYTES = 16 * 1024;
const FIELDS = ['res_cd', 'reg_cert_key'] as const;

export class KcpCertCallbackInvalidError extends Error {
  constructor() {
    super('kcp_cert_callback_invalid');
    this.name = 'KcpCertCallbackInvalidError';
  }
}

export interface KcpCertCallbackFields {
  readonly resultCode: string | null;
  readonly registrationKey: string | null;
}

async function readBoundedText(request: Request) {
  const declaredLength = Number(request.headers.get('content-length') ?? '0');
  if (Number.isFinite(declaredLength) && declaredLength > MAX_CALLBACK_BYTES) {
    throw new KcpCertCallbackInvalidError();
  }
  if (!request.body) return '';

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_CALLBACK_BYTES) {
      await reader.cancel();
      throw new KcpCertCallbackInvalidError();
    }
    chunks.push(value);
  }
  const body = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder('latin1').decode(body);
}

function fieldsFrom(values: URLSearchParams): KcpCertCallbackFields {
  for (const field of FIELDS) {
    if (values.getAll(field).length > 1) throw new KcpCertCallbackInvalidError();
  }
  return {
    resultCode: values.get('res_cd'),
    registrationKey: values.get('reg_cert_key'),
  };
}

export async function parseKcpCertCallback(request: Request): Promise<KcpCertCallbackFields> {
  if (request.method === 'GET') return fieldsFrom(new URL(request.url).searchParams);

  const contentType = request.headers.get('content-type')?.toLowerCase() ?? '';
  if (contentType.split(';', 1)[0]?.trim() !== 'application/x-www-form-urlencoded') {
    throw new KcpCertCallbackInvalidError();
  }
  return fieldsFrom(new URLSearchParams(await readBoundedText(request)));
}

/** 콜백·확정 경로의 303. 결과 화면 주소에 nonce가 실려도 다른 사이트로 새지 않게 한다. */
export function adultVerificationRedirect(location: string) {
  return new Response(null, {
    status: 303,
    headers: {
      location,
      'cache-control': 'no-store',
      'referrer-policy': 'no-referrer',
    },
  });
}
