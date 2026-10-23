import 'server-only';

import { ADULT_VERIFICATION_COMPLETE_PATH } from './adult-verification-routes';

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

/** 콜백·확정 경로의 303. 쿠키를 함께 실을 수 있고, 이동 주소가 다른 사이트로 새지 않게 한다. */
export function adultVerificationRedirect(location: string, setCookie?: string) {
  const headers = new Headers({
    location,
    'cache-control': 'no-store',
    'referrer-policy': 'no-referrer',
  });
  if (setCookie) headers.append('set-cookie', setCookie);
  return new Response(null, { status: 303, headers });
}

/*
 * 확정 티켓 쿠키. 콜백을 선점한 Ret_URL 응답이 그 브라우저에 심고, 확정 경로만 읽는다.
 * Ret_URL은 KCP 페이지에서 오는 최상위 이동이라 SameSite=Lax 쿠키를 심을 수 있고, 이어지는
 * 확정 GET에도 실린다. 세션 TTL(30분)만큼만 산다.
 */
const TICKET_COOKIE = 'icons_adult_verification';
const TICKET_COOKIE_MAX_AGE_SECONDS = 30 * 60;

function ticketCookie(value: string, maxAge: number, request: Request) {
  const secure = new URL(request.url).protocol === 'https:';
  return [
    `${TICKET_COOKIE}=${value}`,
    `Path=${ADULT_VERIFICATION_COMPLETE_PATH}`,
    `Max-Age=${maxAge}`,
    'HttpOnly',
    'SameSite=Lax',
    ...(secure ? ['Secure'] : []),
  ].join('; ');
}

export function adultVerificationTicketCookie(value: string, request: Request) {
  return ticketCookie(value, TICKET_COOKIE_MAX_AGE_SECONDS, request);
}

export function clearAdultVerificationTicketCookie(request: Request) {
  return ticketCookie('', 0, request);
}

/** 요청의 확정 티켓 쿠키 값. 같은 이름이 둘 이상이면 고르지 않는다. */
export function readAdultVerificationTicketCookie(request: Request): string | null {
  const values = (request.headers.get('cookie') ?? '')
    .split(';')
    .map((part) => part.trim())
    .filter((part) => part.startsWith(`${TICKET_COOKIE}=`))
    .map((part) => part.slice(TICKET_COOKIE.length + 1));
  return values.length === 1 ? values[0] : null;
}
