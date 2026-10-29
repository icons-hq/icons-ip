import 'server-only';

import type { KcpCertConfiguration } from './kcp-cert-config';
import { decryptKcpCertPayload, encryptKcpCertPayload, KcpCertCryptoError } from './kcp-cert-crypto';

/*
 * KCP 휴대폰 본인확인 V2 서버 간 호출 두 가지: 거래등록과 결과조회.
 *
 * 두 응답 모두 우리가 KCP에 직접 물은 TLS 응답이다. 브라우저가 Ret_URL로 들고 오는 값은
 * 결과 조회를 시작할 신호일 뿐이고, 성인 판정의 근거는 결과조회 응답을 복호화한 값뿐이다.
 *
 * 결과조회 응답에는 이름·전화번호·생년월일·CI·DI가 함께 들어 있다. 이 모듈은 판정에
 * 필요한 세 값(생년월일·DI·KCP 거래번호)만 꺼내 돌려주고 나머지는 버린다. 어떤 값도
 * 로그나 오류 메시지에 싣지 않는다 — 오류는 코드만 남긴다.
 */

const REQUEST_TIMEOUT_MS = 10_000;
const MAX_RESPONSE_BYTES = 64 * 1024;
const RESULT_CODE = /^[A-Za-z0-9]{1,10}$/;
const REGISTRATION_KEY = /^[A-Za-z0-9]{1,40}$/;

export class KcpCertRequestError extends Error {
  /** DB result_code 어휘(^[a-z0-9_]{1,40}$)와 같은 형식이다. */
  readonly code: string;

  constructor(code: string) {
    super(code);
    this.name = 'KcpCertRequestError';
    this.code = code;
  }
}

export interface KcpCertRegistration {
  readonly callUrl: string;
  readonly registrationKey: string;
}

export interface KcpCertResult {
  /** YYYYMMDD. 판정 즉시 버린다. */
  readonly birthDay: string;
  /** 중복가입확인정보. 키 해시로만 남긴다. */
  readonly duplicateInfo: string;
  /** KCP 본인확인 고유 거래번호. 키 해시로만 남긴다. */
  readonly transactionNo: string;
}

type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

function resultCodeError(prefix: string, code: unknown) {
  return new KcpCertRequestError(
    typeof code === 'string' && RESULT_CODE.test(code)
      ? `${prefix}_${code.toLowerCase()}`
      : `${prefix}_invalid`,
  );
}

async function readJsonObject(response: Response, errorPrefix: string): Promise<Record<string, unknown>> {
  if (!response.ok) throw new KcpCertRequestError(`${errorPrefix}_http`);
  const declaredLength = Number(response.headers.get('content-length') ?? '0');
  if (Number.isFinite(declaredLength) && declaredLength > MAX_RESPONSE_BYTES) {
    throw new KcpCertRequestError(`${errorPrefix}_invalid`);
  }
  const text = await response.text();
  if (text.length > MAX_RESPONSE_BYTES) throw new KcpCertRequestError(`${errorPrefix}_invalid`);
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new KcpCertRequestError(`${errorPrefix}_invalid`);
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new KcpCertRequestError(`${errorPrefix}_invalid`);
  }
  return value as Record<string, unknown>;
}

async function postToKcp(fetchImpl: FetchLike, url: string, init: RequestInit, errorPrefix: string) {
  try {
    return await fetchImpl(url, {
      ...init,
      method: 'POST',
      cache: 'no-store',
      redirect: 'error',
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch {
    throw new KcpCertRequestError(`${errorPrefix}_network`);
  }
}

/** 본인확인 거래등록. 성공하면 인증창 주소와 거래등록키를 돌려준다. */
export async function registerKcpCertTransaction(
  config: KcpCertConfiguration,
  request: { readonly providerOrderId: string; readonly returnUrl: string },
  fetchImpl: FetchLike = fetch,
): Promise<KcpCertRegistration> {
  const payload = JSON.stringify({
    site_cd: config.siteCode,
    ordr_idxx: request.providerOrderId,
    Ret_URL: request.returnUrl,
    web_siteid: config.webSiteId ?? '',
    param_opt_1: '',
    param_opt_2: '',
    param_opt_3: '',
  });
  const { encData, rv } = encryptKcpCertPayload(payload, config.encKey, config.siteCode);

  const response = await postToKcp(fetchImpl, config.registrationUrl, {
    headers: {
      'content-type': 'application/json; charset=utf-8',
      site_cd: config.siteCode,
      rv,
    },
    // 거래등록 본문은 enc_data 문자열 그대로다 — JSON으로 감싸지 않는다(KCP 가이드 3-2).
    body: encData,
  }, 'kcp_registration');

  const body = await readJsonObject(response, 'kcp_registration');
  if (body.res_cd !== '0000') throw resultCodeError('kcp_registration', body.res_cd);

  const callUrl = body.call_url;
  const registrationKey = body.reg_cert_key;
  if (typeof callUrl !== 'string' || typeof registrationKey !== 'string' || !REGISTRATION_KEY.test(registrationKey)) {
    throw new KcpCertRequestError('kcp_registration_invalid');
  }
  let parsedCallUrl: URL;
  try {
    parsedCallUrl = new URL(callUrl);
  } catch {
    throw new KcpCertRequestError('kcp_registration_invalid');
  }
  // 인증창 주소는 KCP가 바꿀 수 있어 응답값을 그대로 쓰되(가이드 3-2), 우리가 부른 KCP
  // 환경의 https origin이 아니면 브라우저를 보내지 않는다.
  if (parsedCallUrl.origin !== config.certWindowOrigin || parsedCallUrl.username || parsedCallUrl.password) {
    throw new KcpCertRequestError('kcp_registration_invalid');
  }

  return { callUrl: parsedCallUrl.toString(), registrationKey };
}

function nonEmptyString(value: unknown, maxLength: number): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= maxLength;
}

/**
 * DI는 특수문자 누락을 막으려고 URL 인코딩본(DI_URL)이 함께 온다. 인코딩본을 디코딩한
 * 값이 정본이고(가이드 3-5), 없거나 깨졌을 때만 원문 DI를 쓴다.
 */
function duplicateInfoFrom(certData: Record<string, unknown>) {
  if (nonEmptyString(certData.DI_URL, 1024)) {
    try {
      const decoded = decodeURIComponent(certData.DI_URL);
      if (decoded.length > 0) return decoded;
    } catch {
      // 원문 DI로 넘어간다.
    }
  }
  return nonEmptyString(certData.DI, 1024) ? certData.DI : null;
}

/** 본인확인 결과조회 + 복호화. 인증창이 성공(0000)을 알린 직후에만 부른다. */
export async function fetchKcpCertResult(
  config: KcpCertConfiguration,
  request: { readonly providerOrderId: string; readonly registrationKey: string },
  fetchImpl: FetchLike = fetch,
): Promise<KcpCertResult> {
  const response = await postToKcp(fetchImpl, config.resultUrl, {
    headers: {
      'content-type': 'application/json; charset=utf-8',
      site_cd: config.siteCode,
    },
    // 결과조회 요청은 평문 JSON이다(가이드 3-4).
    body: JSON.stringify({ reg_cert_key: request.registrationKey, ordr_idxx: request.providerOrderId }),
  }, 'kcp_result');

  const body = await readJsonObject(response, 'kcp_result');
  if (body.res_cd !== '0000') throw resultCodeError('kcp_result', body.res_cd);
  if (typeof body.enc_cert_data !== 'string' || typeof body.rv !== 'string') {
    throw new KcpCertRequestError('kcp_result_invalid');
  }

  let decrypted: unknown;
  try {
    decrypted = decryptKcpCertPayload(body.enc_cert_data, body.rv, config.encKey, config.siteCode);
  } catch (error) {
    if (error instanceof KcpCertCryptoError) throw new KcpCertRequestError('kcp_result_decrypt');
    throw error;
  }
  if (!decrypted || typeof decrypted !== 'object' || Array.isArray(decrypted)) {
    throw new KcpCertRequestError('kcp_result_invalid');
  }
  const certData = decrypted as Record<string, unknown>;
  if (certData.res_cd !== '0000') throw resultCodeError('kcp_cert', certData.res_cd);

  const duplicateInfo = duplicateInfoFrom(certData);
  if (
    typeof certData.birth_day !== 'string'
    || !/^\d{8}$/.test(certData.birth_day)
    || duplicateInfo === null
    || !nonEmptyString(certData.per_cert_no, 40)
  ) {
    throw new KcpCertRequestError('kcp_result_invalid');
  }

  return {
    birthDay: certData.birth_day,
    duplicateInfo,
    transactionNo: certData.per_cert_no,
  };
}
