import 'server-only';

import { createHash, createHmac, randomBytes, randomUUID } from 'node:crypto';

import { ADULT_VERIFICATION_POLICY_VERSION, adultAgeDecision } from '@/lib/age/adult-age';
import { safeNextPath } from '@/lib/auth/onboarding';
import { createServiceClient } from '@/lib/supabase/service';
import { fetchKcpCertResult, KcpCertRequestError, registerKcpCertTransaction } from './kcp-cert-client.server';
import { kcpCertConfiguration, type KcpCertConfiguration } from './kcp-cert-config';

/*
 * 성인 인증 흐름 (NHN KCP 휴대폰 본인확인 V2).
 *
 *   1. begin    — 로그인 사용자의 서버 액션. 세션 행을 만들고 KCP 거래등록을 한 뒤
 *                 브라우저에 인증창 주소·거래등록키를 준다.
 *   2. return   — KCP 인증창이 브라우저를 Ret_URL로 보낸 요청. 교차 사이트 POST라
 *                 로그인 쿠키가 없다. 경로 nonce + 거래등록키로 세션을 잡고, KCP에 결과를
 *                 직접 조회·복호화해 판정만 '보류'로 적는다.
 *   3. complete — return이 같은 브라우저를 보낸 GET. 콜백을 선점한 요청만 그 브라우저에
 *                 완료 토큰 쿠키를 준다. 로그인 세션이 세션 주인이고 완료 토큰이 맞을 때만
 *                 DB가 보류를 증거로 확정한다.
 *
 * 2의 판정 근거는 KCP 결과조회 응답뿐이고, 3의 계정 근거는 DB의 auth.uid()뿐이다. 브라우저가
 * 실어 오는 res_cd는 조회를 시작할지 정하는 신호로만 쓴다. 완료 토큰은 인증창을 실제로
 * 끝낸 브라우저를 묶는다 — nonce와 거래등록키를 아는 다른 브라우저는 확정하지 못한다.
 */

export type AdultVerificationPresentation = 'popup' | 'page';

export class AdultVerificationUnavailableError extends Error {
  constructor() {
    super('adult_verification_unavailable');
    this.name = 'AdultVerificationUnavailableError';
  }
}

export class AdultVerificationRateLimitedError extends Error {
  constructor() {
    super('adult_verification_rate_limited');
    this.name = 'AdultVerificationRateLimitedError';
  }
}

export class AdultVerificationAccountBlockedError extends Error {
  constructor() {
    super('adult_verification_account_blocked');
    this.name = 'AdultVerificationAccountBlockedError';
  }
}

interface RpcError {
  readonly message: string;
}

type RpcResult<T> = { data: T | null; error: RpcError | null };

export interface AdultVerificationDependencies {
  readonly configuration: () => KcpCertConfiguration | null;
  readonly rpc: <T>(fn: string, args: Record<string, unknown>) => Promise<RpcResult<T>>;
  readonly register: typeof registerKcpCertTransaction;
  readonly fetchResult: typeof fetchKcpCertResult;
  readonly now: () => Date;
  readonly nonce: () => string;
  readonly claimToken: () => string;
  readonly completionToken: () => string;
}

export function runtimeAdultVerificationDependencies(): AdultVerificationDependencies {
  return {
    configuration: () => kcpCertConfiguration(),
    rpc: async <T,>(fn: string, args: Record<string, unknown>) => {
      const { data, error } = await createServiceClient().rpc(fn, args);
      return { data: (data ?? null) as T | null, error: error ? { message: error.message } : null };
    },
    register: registerKcpCertTransaction,
    fetchResult: fetchKcpCertResult,
    now: () => new Date(),
    nonce: () => randomBytes(32).toString('base64url'),
    claimToken: () => randomUUID(),
    completionToken: () => randomBytes(32).toString('base64url'),
  };
}

/** 경로 nonce·완료 토큰: 32바이트 base64url(43자). KCP 전문·쿠키 금지 문자가 없다. */
const RANDOM_TOKEN = /^[A-Za-z0-9_-]{43}$/;
const REGISTRATION_KEY = /^[A-Za-z0-9]{1,40}$/;
const RESULT_CODE = /^[A-Za-z0-9]{1,10}$/;

export function isAdultVerificationNonce(value: string) {
  return RANDOM_TOKEN.test(value);
}

function sha256Hex(value: string) {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

export function adultVerificationNonceDigest(nonce: string) {
  return sha256Hex(nonce);
}

/**
 * 확정 티켓. 콜백을 선점한 요청이 같은 브라우저에 쿠키로 준다. DB에는 두 값의
 * 해시만 있다.
 */
export interface AdultVerificationTicket {
  readonly nonce: string;
  readonly token: string;
}

export function adultVerificationTicketValue(ticket: AdultVerificationTicket) {
  return `${ticket.nonce}.${ticket.token}`;
}

export function parseAdultVerificationTicket(value: string | null | undefined): AdultVerificationTicket | null {
  if (typeof value !== 'string') return null;
  const [nonce, token, ...rest] = value.split('.');
  if (rest.length > 0 || !nonce || !token || !RANDOM_TOKEN.test(nonce) || !RANDOM_TOKEN.test(token)) return null;
  return { nonce, token };
}

function keyedDigest(secret: string, label: string, value: string) {
  return createHmac('sha256', secret).update(`${label}\u0000${value}`, 'utf8').digest('hex');
}

/**
 * 인증 뒤 돌아갈 경로. 같은 사이트의 화면 경로만 남기고 API·인증 경로는 마이페이지로
 * 바꾼다. DB 제약(512자)보다 길면 같은 처리를 한다.
 */
export function adultVerificationReturnPath(value: string | null | undefined) {
  const safe = safeNextPath(value ?? '/');
  if (safe.length > 512 || /^\/(api|auth)(\/|[?#]|$)/i.test(safe)) return '/my';
  return safe;
}

export function adultVerificationReturnUrl(config: KcpCertConfiguration, nonce: string) {
  return `${config.siteOrigin}/api/identity/kcp/return/${nonce}`;
}

export interface AdultVerificationStart {
  readonly callUrl: string;
  readonly registrationKey: string;
  /** KCP 인증창 호출 방식: Y = 페이지 전환, N = 팝업. */
  readonly pageSubmit: 'Y' | 'N';
}

export async function beginAdultVerification(
  input: { readonly userId: string; readonly presentation: AdultVerificationPresentation; readonly returnPath: string },
  deps: AdultVerificationDependencies = runtimeAdultVerificationDependencies(),
): Promise<AdultVerificationStart> {
  const config = deps.configuration();
  if (!config) throw new AdultVerificationUnavailableError();

  const nonce = deps.nonce();
  if (!isAdultVerificationNonce(nonce)) throw new AdultVerificationUnavailableError();

  const begun = await deps.rpc<{ sessionId: string; providerOrderId: string }>('begin_adult_verification', {
    p_user_id: input.userId,
    p_provider_mode: config.mode,
    p_presentation: input.presentation,
    p_return_path: adultVerificationReturnPath(input.returnPath),
    p_callback_nonce_digest: adultVerificationNonceDigest(nonce),
  });
  if (begun.error) {
    if (begun.error.message === 'adult_verification_rate_limited') throw new AdultVerificationRateLimitedError();
    if (begun.error.message === 'adult_verification_account_blocked') throw new AdultVerificationAccountBlockedError();
    throw new AdultVerificationUnavailableError();
  }
  const sessionId = begun.data?.sessionId;
  const providerOrderId = begun.data?.providerOrderId;
  if (typeof sessionId !== 'string' || typeof providerOrderId !== 'string') {
    throw new AdultVerificationUnavailableError();
  }

  let registration;
  try {
    registration = await deps.register(config, {
      providerOrderId,
      returnUrl: adultVerificationReturnUrl(config, nonce),
    });
  } catch (error) {
    const code = error instanceof KcpCertRequestError ? error.code : 'kcp_registration_failed';
    await deps.rpc('fail_adult_verification_registration', { p_session_id: sessionId, p_result_code: code });
    throw new AdultVerificationUnavailableError();
  }

  const registered = await deps.rpc('register_adult_verification', {
    p_session_id: sessionId,
    p_registration_key: registration.registrationKey,
  });
  if (registered.error) throw new AdultVerificationUnavailableError();

  return {
    callUrl: registration.callUrl,
    registrationKey: registration.registrationKey,
    pageSubmit: input.presentation === 'page' ? 'Y' : 'N',
  };
}

export type KcpCertReturnOutcome =
  /**
   * 세션 주인의 로그인 세션 확정으로 넘어간다(보류·실패·진행 중·이미 종결 모두 확정 경로가
   * 답한다). ticket은 이 요청이 콜백을 선점했을 때만 있다 — 그 브라우저에만 준다.
   */
  | { readonly kind: 'confirm'; readonly ticket: AdultVerificationTicket | null }
  /** 우리 세션이 아니거나 형식이 깨진 콜백이다. 아무 상태도 바꾸지 않았다. */
  | { readonly kind: 'invalid' };

interface ClaimResult {
  readonly claimStatus: 'claimed' | 'in_progress' | 'staged' | 'terminal';
  readonly sessionId?: string;
  readonly providerOrderId?: string;
  readonly registrationKey?: string;
}

/**
 * KCP Ret_URL 콜백 처리. KCP 응답·복호화·판정에서 무엇이 실패해도 세션은 failed로 닫고
 * 확정 경로로 보낸다 — 사용자는 실패 화면을 보고 다시 시작한다. 재시도로 같은 거래등록키를
 * 다시 조회하지 않는다. 확정 티켓은 선점한 요청에만 준다: 실패로 닫은 경우에도 같은
 * 브라우저가 확정 경로에서 실패 결과를 볼 수 있어야 한다.
 */
export async function processKcpCertReturn(
  input: { readonly nonce: string; readonly resultCode: string | null; readonly registrationKey: string | null },
  deps: AdultVerificationDependencies = runtimeAdultVerificationDependencies(),
): Promise<KcpCertReturnOutcome> {
  const config = deps.configuration();
  if (
    !config
    || !isAdultVerificationNonce(input.nonce)
    || input.registrationKey === null
    || !REGISTRATION_KEY.test(input.registrationKey)
  ) {
    return { kind: 'invalid' };
  }

  const claimToken = deps.claimToken();
  const completionToken = deps.completionToken();
  if (!RANDOM_TOKEN.test(completionToken)) return { kind: 'invalid' };
  const claimed = await deps.rpc<ClaimResult>('claim_adult_verification_callback', {
    p_callback_nonce_digest: adultVerificationNonceDigest(input.nonce),
    p_registration_key: input.registrationKey,
    p_claim_token: claimToken,
    p_completion_token_digest: sha256Hex(completionToken),
  });
  if (claimed.error || !claimed.data) return { kind: 'invalid' };
  if (claimed.data.claimStatus !== 'claimed') return { kind: 'confirm', ticket: null };
  const ticket: AdultVerificationTicket = { nonce: input.nonce, token: completionToken };

  const { sessionId, providerOrderId, registrationKey } = claimed.data;
  if (typeof sessionId !== 'string' || typeof providerOrderId !== 'string' || typeof registrationKey !== 'string') {
    return { kind: 'invalid' };
  }

  const fail = async (code: string) => {
    await deps.rpc('fail_adult_verification_callback', {
      p_session_id: sessionId,
      p_claim_token: claimToken,
      p_result_code: code,
    });
    return { kind: 'confirm', ticket } as const;
  };

  // 인증창의 실패 코드(사용자 취소·인증 실패 등)는 조회 없이 닫는다.
  if (input.resultCode !== '0000') {
    return fail(
      input.resultCode !== null && RESULT_CODE.test(input.resultCode)
        ? `kcp_window_${input.resultCode.toLowerCase()}`
        : 'kcp_window_invalid',
    );
  }

  let result;
  try {
    result = await deps.fetchResult(config, { providerOrderId, registrationKey });
  } catch (error) {
    return fail(error instanceof KcpCertRequestError ? error.code : 'kcp_result_failed');
  }

  const decision = adultAgeDecision(result.birthDay, deps.now());
  if (!decision) return fail('kcp_result_birth_day');

  const staged = await deps.rpc('stage_adult_verification_result', {
    p_session_id: sessionId,
    p_claim_token: claimToken,
    p_outcome: decision,
    p_subject_digest: decision === 'adult'
      ? keyedDigest(config.digestSecret, 'adult-verification/subject/di', result.duplicateInfo)
      : null,
    p_transaction_digest: decision === 'adult'
      ? keyedDigest(config.digestSecret, 'adult-verification/kcp/per-cert-no', result.transactionNo)
      : null,
    p_policy_version: ADULT_VERIFICATION_POLICY_VERSION,
  });
  // 보류 기록이 실패하면(세션 만료 경합 등) 세션을 실패로 닫는다. 선점을 잃은 경우에는
  // 닫기도 거절되고, 그 세션은 이미 다른 요청이 처리한 것이다.
  if (staged.error) return fail('stage_failed');

  return { kind: 'confirm', ticket };
}

export type AdultVerificationCompletion =
  | {
    readonly outcome: 'verified' | 'underage' | 'failed' | 'expired' | 'pending';
    readonly presentation: AdultVerificationPresentation;
    readonly returnPath: string;
  }
  /** 남의 세션·모르는 nonce·맞지 않는 완료 토큰. 구별하지 않는다. */
  | { readonly outcome: 'not_found' }
  /** 탈퇴 신청 등으로 쓰기가 막힌 계정. */
  | { readonly outcome: 'blocked' }
  /** 확정 직전에 로그인 세션이 끊겼다. */
  | { readonly outcome: 'login_required' };

export class AdultVerificationCompletionError extends Error {
  constructor() {
    super('adult_verification_completion_failed');
    this.name = 'AdultVerificationCompletionError';
  }
}

interface CompletionRow {
  readonly outcome?: string;
  readonly presentation?: string;
  readonly returnPath?: string;
}

const COMPLETION_OUTCOMES = new Set(['verified', 'underage', 'failed', 'expired', 'pending']);

/**
 * 확정은 세션 주인의 로그인 세션으로 부른다 — service role이 아니다. rpc는 사용자 쿠키로
 * 만든 클라이언트의 것이어야 한다. DB가 거절 사유로 답한 경우만 결과로 돌려주고, 그 밖의
 * 실패(장애·깨진 응답)는 던진다 — 호출자는 상태를 추측하지 않고 다시 확인하게 한다.
 */
export async function completeAdultVerification(
  ticket: AdultVerificationTicket,
  rpc: <T>(fn: string, args: Record<string, unknown>) => Promise<RpcResult<T>>,
): Promise<AdultVerificationCompletion> {
  if (!RANDOM_TOKEN.test(ticket.nonce) || !RANDOM_TOKEN.test(ticket.token)) return { outcome: 'not_found' };
  const completed = await rpc<CompletionRow>('complete_my_adult_verification', {
    p_callback_nonce_digest: adultVerificationNonceDigest(ticket.nonce),
    p_completion_token_digest: sha256Hex(ticket.token),
  });
  if (completed.error) {
    if (completed.error.message === 'adult_verification_not_found') return { outcome: 'not_found' };
    if (completed.error.message === 'adult_verification_account_blocked') return { outcome: 'blocked' };
    if (completed.error.message === 'auth required') return { outcome: 'login_required' };
    throw new AdultVerificationCompletionError();
  }
  const row = completed.data;
  if (
    !row
    || typeof row.outcome !== 'string'
    || !COMPLETION_OUTCOMES.has(row.outcome)
    || (row.presentation !== 'popup' && row.presentation !== 'page')
  ) {
    throw new AdultVerificationCompletionError();
  }
  return {
    outcome: row.outcome as 'verified' | 'underage' | 'failed' | 'expired' | 'pending',
    presentation: row.presentation,
    returnPath: adultVerificationReturnPath(row.returnPath),
  };
}
