import 'server-only';

import { createPublicKey, verify, type JsonWebKey, type KeyObject } from 'node:crypto';
import { createServiceClient } from '@/lib/supabase/service';

/*
 * 카카오 계정 상태 변경 웹훅(SSF) — 회원이 카카오 쪽에서 ICONS 앱 연결을 끊었다는 알림(user-unlinked)을 받는다.
 * 카카오 콘솔 [앱] > [웹훅] > [계정 상태 변경 웹훅]에 /api/webhooks/kakao/account-status를 등록한다
 * (docs/runbooks/kakao-account-unlink.md).
 *
 * 왜 '연결 해제 웹훅'이 아니라 이것인가: 연결 해제 웹훅은 재전송이 없어 한 번 놓치면 그 회원의 개인정보 처리가 영영
 * 빠지고, 인증이 대표 어드민 키 비교(공유 비밀)다. 계정 상태 변경 웹훅은 카카오 인증 서버가 개인키로 서명한
 * SET(Security Event Token, RS256 JWT)을 보내 공개키로 검증하고, 응답이 없거나 실패하면 최대 6번까지 다시 보낸다.
 * 그래서 처리를 응답 전에 끝내고(after 없음) 실패하면 500으로 재전송을 부른다. 처리는 이벤트 ID(jti)로 멱등이다.
 *
 * 응답 규격(RFC 8935): 검증·처리 성공은 본문 없는 202, 서명 전 판정 실패(형식·발급자·대상·서명 불일치)는
 * 400 + {"err","description"}. 400을 받은 카카오는 다시 보내지 않으므로, 서명은 맞는데 공개키를 찾지 못했거나 서명된 SET의
 * 모양이 예상과 다르면 500으로 재전송을 받는다(그 사이 고칠 수 있다). 카카오는 3초 안의 응답을 기대하고 3시간 넘게 연속
 * 실패하면 웹훅을 비활성화한다. REST API 키(SET의 aud)가 설정되지 않으면 404다.
 *
 * 받은 뒤 할 일은 DB(service_record_kakao_unlink)가 정한다: 다른 로그인 수단(다른 공급자, 비밀번호가 있는 이메일)이
 * 있는 회원은 카카오 연결만 끊고(카카오가 준 프로필 파기), 그 밖의 회원은 계정·연결을 두고 '탈퇴 검토 대기'로 남긴다.
 * 알림보다 나중에 카카오로 다시 로그인한 기록이 있으면 아무것도 바꾸지 않는다. 본문은 서명 검증 전에는 믿지 않는다.
 */

export const KAKAO_SET_ISSUER = 'https://kauth.kakao.com';
export const KAKAO_JWKS_URL = 'https://kauth.kakao.com/.well-known/jwks.json';
export const KAKAO_USER_UNLINKED_EVENT = 'https://schemas.openid.net/secevent/oauth/event-type/user-unlinked';

const REST_API_KEY = /^[A-Za-z0-9]{16,128}$/;
const KAKAO_USER_ID = /^[1-9]\d{0,19}$/;
const UNLINK_REASON = /^[A-Z_]{1,64}$/;
const BASE64URL = /^[A-Za-z0-9_-]+$/;
const MAX_TOKEN_ID_LENGTH = 256;

/* 공개키 목록은 자주 바뀌지 않는다. 카카오가 과도한 조회를 막으므로 캐시하고, 모르는 kid가 와도 1분에 한 번만 다시 받는다. */
const JWKS_TTL_MS = 6 * 60 * 60 * 1000;
const JWKS_REFETCH_MIN_INTERVAL_MS = 60 * 1000;
const JWKS_TIMEOUT_MS = 1200;
/* 카카오는 3초 안의 응답을 기대한다. 공개키 조회(최대 1.2초)와 합쳐도 넘지 않게 DB 처리를 1.5초로 끊는다. */
const DB_TIMEOUT_MS = 1500;

type RuntimeEnvironment = Readonly<Record<string, string | undefined>>;
type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;
type ServiceClient = ReturnType<typeof createServiceClient>;

export interface KakaoAccountStatusConfig {
  /** 카카오 앱의 대표 REST API 키. 카카오가 SET의 aud에 넣는다(비밀값은 아니다 — OAuth client_id와 같은 종류). */
  restApiKey: string;
}

/** KAKAO_REST_API_KEY가 없거나 형식이 어긋나면 null(fail closed — 웹훅은 404). */
export function kakaoAccountStatusConfig(env: RuntimeEnvironment = process.env): KakaoAccountStatusConfig | null {
  const restApiKey = env.KAKAO_REST_API_KEY?.trim() ?? '';
  return REST_API_KEY.test(restApiKey) ? { restApiKey } : null;
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

/* ------------------------------------------------------------------------------------------------
 * 공개키(JWKS)
 * ---------------------------------------------------------------------------------------------- */

/**
 * kid에 맞는 공개키. 찾지 못하면 이유와 상관없이 'unavailable'이다 — 웹훅은 500을 돌려 카카오의 재전송을 받는다.
 * 키 교체 직후 목록 반영이 늦거나 재조회 제한에 걸린 정상 알림을 400(재전송 없음)으로 영영 버리지 않으려는 것이다.
 * 위조 요청은 어느 응답을 받든 상관없고, 서명 판정은 찾은 키로만 한다.
 */
export type KakaoJwksLookup = KeyObject | 'unavailable';

export interface KakaoJwksStore {
  getKey(kid: string): Promise<KakaoJwksLookup>;
}

function parseJwks(body: unknown): Map<string, KeyObject> | null {
  const keys = record(body)?.keys;
  if (!Array.isArray(keys)) return null;
  const parsed = new Map<string, KeyObject>();
  for (const candidate of keys) {
    const jwk = record(candidate);
    if (!jwk || jwk.kty !== 'RSA' || typeof jwk.kid !== 'string' || !jwk.kid) continue;
    if (jwk.alg !== undefined && jwk.alg !== 'RS256') continue;
    if (jwk.use !== undefined && jwk.use !== 'sig') continue;
    if (typeof jwk.n !== 'string' || typeof jwk.e !== 'string') continue;
    try {
      parsed.set(jwk.kid, createPublicKey({ key: { kty: 'RSA', n: jwk.n, e: jwk.e } as JsonWebKey, format: 'jwk' }));
    } catch {
      /* 읽을 수 없는 키는 건너뛴다. */
    }
  }
  return parsed;
}

export function createKakaoJwksStore(deps: { fetch?: FetchLike; now?: () => number } = {}): KakaoJwksStore {
  const fetchImpl = deps.fetch ?? fetch;
  const now = deps.now ?? Date.now;
  let keys: Map<string, KeyObject> | null = null;
  let fetchedAt = 0;
  let lastAttemptAt = Number.NEGATIVE_INFINITY;
  /* 새 인스턴스에 알림이 몰려도 공개키 조회는 한 번만 한다. */
  let inflight: Promise<boolean> | null = null;

  async function fetchKeys(): Promise<boolean> {
    try {
      const response = await fetchImpl(KAKAO_JWKS_URL, {
        method: 'GET',
        cache: 'no-store',
        signal: AbortSignal.timeout(JWKS_TIMEOUT_MS),
      });
      if (!response.ok) return false;
      const parsed = parseJwks(await response.json());
      if (!parsed || parsed.size === 0) return false;
      keys = parsed;
      fetchedAt = now();
      return true;
    } catch {
      return false;
    }
  }

  function refresh(): Promise<boolean> {
    if (inflight) return inflight;
    /* 아무나 보낸 요청이 조회를 부르지 못하게 직전 시도에서 1분이 지나야 다시 받는다. */
    if (now() - lastAttemptAt < JWKS_REFETCH_MIN_INTERVAL_MS) return Promise.resolve(false);
    lastAttemptAt = now();
    inflight = fetchKeys().finally(() => {
      inflight = null;
    });
    return inflight;
  }

  return {
    async getKey(kid) {
      const cached = keys?.get(kid);
      if (cached && now() - fetchedAt < JWKS_TTL_MS) return cached;
      /* 오래됐거나 모르는 kid면 다시 받는다. 받지 못해도 가진 목록(오래된 것 포함)에 있으면 쓴다. */
      await refresh();
      return keys?.get(kid) ?? 'unavailable';
    },
  };
}

const defaultJwksStore = createKakaoJwksStore();

/* ------------------------------------------------------------------------------------------------
 * SET 검증
 * ---------------------------------------------------------------------------------------------- */

export type KakaoSetError = 'invalid_request' | 'invalid_key' | 'invalid_issuer' | 'invalid_audience';

export interface KakaoVerifiedSet {
  jti: string;
  /** 이벤트 발생 시각(toe, 초). */
  occurredAt: number;
  sub: string | null;
  events: Record<string, unknown>;
}

/**
 * 실패 셋으로 나눈다. 서명 전 판정(형식·발급자·대상·서명 불일치)은 400 — 위조이거나 우리 설정 문제다.
 * 'unavailable'(공개키를 찾지 못함)과 'unexpected'(카카오가 서명한 SET인데 모양이 예상과 다름)는 500 — 카카오가
 * 다시 보내므로 그 사이 고칠 수 있다. 서명된 정상 알림을 400으로 받으면 카카오는 다시 보내지 않아 영영 사라진다.
 */
export type KakaoSetVerification =
  | { ok: true; set: KakaoVerifiedSet }
  | { ok: false; error: KakaoSetError; description: string }
  | { ok: false; error: 'unavailable' }
  | { ok: false; error: 'unexpected'; description: string };

function decodeSegment(segment: string): Record<string, unknown> | null {
  if (!BASE64URL.test(segment)) return null;
  try {
    return record(JSON.parse(Buffer.from(segment, 'base64url').toString('utf8')));
  } catch {
    return null;
  }
}

function invalid(error: KakaoSetError, description: string): KakaoSetVerification {
  return { ok: false, error, description };
}

function memberNumber(value: unknown): string | null {
  const text = typeof value === 'number' && Number.isSafeInteger(value) ? String(value) : value;
  return typeof text === 'string' && KAKAO_USER_ID.test(text) ? text : null;
}

/**
 * 카카오 문서의 검증 순서(발급자 → 대상 → 서명)를 따른다. 발급자·대상을 먼저 보는 것은 아무나 보낸 요청이 공개키
 * 재조회를 부르지 못하게 하려는 것이다. 서명을 통과하기 전의 값은 판정에 쓰지 않는다.
 */
export async function verifyKakaoSecurityEventToken(
  token: string,
  input: { restApiKey: string; jwks: KakaoJwksStore },
): Promise<KakaoSetVerification> {
  const parts = token.trim().split('.');
  if (parts.length !== 3 || parts.some((part) => !BASE64URL.test(part))) {
    return invalid('invalid_request', 'The request is not a compact JWS.');
  }
  const [encodedHeader, encodedPayload, encodedSignature] = parts;
  const header = decodeSegment(encodedHeader);
  const payload = decodeSegment(encodedPayload);
  if (!header || !payload) return invalid('invalid_request', 'The JWT header or payload is not a JSON object.');

  const typ = typeof header.typ === 'string' ? header.typ.toLowerCase() : '';
  if (header.alg !== 'RS256' || (typ !== 'secevent+jwt' && typ !== 'application/secevent+jwt')) {
    return invalid('invalid_request', 'The SET must be an RS256 secevent+jwt.');
  }
  if (typeof header.kid !== 'string' || !header.kid || header.kid.length > MAX_TOKEN_ID_LENGTH) {
    return invalid('invalid_request', 'The SET header has no key ID.');
  }

  if (payload.iss !== KAKAO_SET_ISSUER) return invalid('invalid_issuer', 'Unexpected issuer.');
  const audience = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  if (!audience.includes(input.restApiKey)) return invalid('invalid_audience', 'Unexpected audience.');

  const key = await input.jwks.getKey(header.kid);
  if (key === 'unavailable') return { ok: false, error: 'unavailable' };
  let signatureValid = false;
  try {
    signatureValid = verify(
      'RSA-SHA256',
      Buffer.from(`${encodedHeader}.${encodedPayload}`),
      key,
      Buffer.from(encodedSignature, 'base64url'),
    );
  } catch {
    signatureValid = false;
  }
  if (!signatureValid) return invalid('invalid_key', 'Signature verification failed.');

  const events = record(payload.events);
  if (typeof payload.jti !== 'string' || !payload.jti || payload.jti.length > MAX_TOKEN_ID_LENGTH
    || typeof payload.toe !== 'number' || !Number.isSafeInteger(payload.toe) || payload.toe <= 0 || !events) {
    return { ok: false, error: 'unexpected', description: 'The signed SET is missing jti, toe or events.' };
  }
  return {
    ok: true,
    set: { jti: payload.jti, occurredAt: payload.toe, sub: memberNumber(payload.sub), events },
  };
}

/* ------------------------------------------------------------------------------------------------
 * 연결 해제 처리
 * ---------------------------------------------------------------------------------------------- */

export interface KakaoUnlinkEvent {
  eventId: string;
  kakaoUserId: string;
  reason: string;
  occurredAt: Date;
}

/**
 * user-unlinked 이벤트를 읽는다. 다른 이벤트만 있으면 null. 회원번호는 이벤트의 subject.sub와 최상위 sub가
 * 둘 다 있으면 같아야 한다.
 */
export function readKakaoUnlinkEvent(set: KakaoVerifiedSet): KakaoUnlinkEvent | { error: string } | null {
  if (!(KAKAO_USER_UNLINKED_EVENT in set.events)) return null;
  const event = record(set.events[KAKAO_USER_UNLINKED_EVENT]);
  if (!event) return { error: 'The user-unlinked event is not an object.' };
  if (typeof event.reason !== 'string' || !UNLINK_REASON.test(event.reason)) {
    return { error: 'The user-unlinked event has no reason.' };
  }

  const subject = event.subject === undefined ? null : record(event.subject);
  if (event.subject !== undefined && !subject) return { error: 'The event subject is not an object.' };
  if (subject?.subject_type !== undefined && subject.subject_type !== 'iss-sub') {
    return { error: 'The event subject is not a member number.' };
  }
  if (subject?.iss !== undefined && subject.iss !== KAKAO_SET_ISSUER) return { error: 'The event subject issuer differs.' };
  const subjectSub = subject?.sub === undefined ? null : memberNumber(subject.sub);
  if (subject?.sub !== undefined && !subjectSub) return { error: 'The event subject has no member number.' };
  if (subjectSub && set.sub && subjectSub !== set.sub) return { error: 'The event subject differs from sub.' };
  const kakaoUserId = subjectSub ?? set.sub;
  if (!kakaoUserId) return { error: 'The SET has no member number.' };

  return {
    eventId: set.jti,
    kakaoUserId,
    reason: event.reason,
    occurredAt: new Date(set.occurredAt * 1000),
  };
}

export type KakaoUnlinkOutcome = 'identity_unlinked' | 'withdrawal_review' | 'relinked' | 'no_member';
const UNLINK_OUTCOMES: readonly string[] = ['identity_unlinked', 'withdrawal_review', 'relinked', 'no_member'];

/** DB에 연결 해제를 기록·반영한다. 실패(시간 초과 포함)면 null — 웹훅은 500으로 재전송을 부른다. */
export async function recordKakaoUnlink(event: KakaoUnlinkEvent, service: ServiceClient): Promise<KakaoUnlinkOutcome | null> {
  try {
    const { data, error } = await service
      .rpc('service_record_kakao_unlink', {
        p_event_id: event.eventId,
        p_kakao_user_id: event.kakaoUserId,
        p_reason: event.reason,
        p_event_at: event.occurredAt.toISOString(),
      })
      .abortSignal(AbortSignal.timeout(DB_TIMEOUT_MS));
    const status = record(data)?.status;
    if (error || typeof status !== 'string' || !UNLINK_OUTCOMES.includes(status)) return null;
    return status as KakaoUnlinkOutcome;
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------------------------------------
 * 웹훅
 * ---------------------------------------------------------------------------------------------- */

export type KakaoAccountStatusResult =
  | { status: 202 | 404 | 500 }
  | { status: 400; body: { err: KakaoSetError; description: string } };

export interface KakaoAccountStatusDependencies {
  config?: KakaoAccountStatusConfig | null;
  jwks?: KakaoJwksStore;
  service?: ServiceClient;
}

export async function handleKakaoAccountStatusWebhook(
  input: { body: string },
  deps: KakaoAccountStatusDependencies = {},
): Promise<KakaoAccountStatusResult> {
  const config = deps.config === undefined ? kakaoAccountStatusConfig() : deps.config;
  if (!config) return { status: 404 };

  const verification = await verifyKakaoSecurityEventToken(input.body, {
    restApiKey: config.restApiKey,
    jwks: deps.jwks ?? defaultJwksStore,
  });
  /* 로그에는 판정 결과만 남기고 본문·회원번호는 남기지 않는다. Vercel은 응답 본문을 기록하지 않으므로 여기서 남긴다. */
  if (!verification.ok) {
    if (verification.error === 'unavailable') {
      console.warn('[kakao-account-status] signing key unavailable; Kakao will retry');
      return { status: 500 };
    }
    if (verification.error === 'unexpected') {
      console.error('[kakao-account-status] signed SET has an unexpected shape; Kakao will retry', { description: verification.description });
      return { status: 500 };
    }
    console.warn('[kakao-account-status] refused', { err: verification.error, description: verification.description });
    return { status: 400, body: { err: verification.error, description: verification.description } };
  }

  const event = readKakaoUnlinkEvent(verification.set);
  /* 연결 해제가 아닌 이벤트(콘솔에서 더 고른 경우)는 받기만 한다. */
  if (event === null) return { status: 202 };
  if ('error' in event) {
    console.error('[kakao-account-status] signed user-unlinked event has an unexpected shape; Kakao will retry', { description: event.error });
    return { status: 500 };
  }

  let service: ServiceClient;
  try {
    service = deps.service ?? createServiceClient();
  } catch {
    return { status: 500 };
  }
  const outcome = await recordKakaoUnlink(event, service);
  if (!outcome) {
    /* 회원번호는 남기지 않는다. 카카오가 같은 SET을 다시 보낸다. */
    console.error('[kakao-account-status] unlink not recorded; Kakao will retry', { reason: event.reason });
    return { status: 500 };
  }
  return { status: 202 };
}
