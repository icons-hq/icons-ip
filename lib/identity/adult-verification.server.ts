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
 *   3. complete — return이 같은 브라우저를 보낸 동일 사이트 GET. 로그인 세션이 세션
 *                 주인과 같을 때만 DB가 보류를 증거로 확정한다.
 *
 * 2의 판정 근거는 KCP 결과조회 응답뿐이고, 3의 계정 근거는 DB의 auth.uid()뿐이다. 브라우저가
 * 실어 오는 res_cd는 조회를 시작할지 정하는 신호로만 쓴다.
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
  };
}

/** 경로 nonce: 32바이트 base64url(43자). KCP 전문 금지 문자가 없다. */
const CALLBACK_NONCE = /^[A-Za-z0-9_-]{43}$/;
const REGISTRATION_KEY = /^[A-Za-z0-9]{1,40}$/;
const RESULT_CODE = /^[A-Za-z0-9]{1,10}$/;

export function isAdultVerificationNonce(value: string) {
  return CALLBACK_NONCE.test(value);
}

export function adultVerificationNonceDigest(nonce: string) {
  return createHash('sha256').update(nonce, 'utf8').digest('hex');
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

export function adultVerificationCompletionPath(nonce: string) {
  return `/api/identity/adult/complete/${nonce}`;
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
  /** 세션 주인의 로그인 세션 확정으로 넘어간다(보류·진행 중·이미 종결 모두 확정 경로가 답한다). */
  | { readonly kind: 'confirm'; readonly nonce: string }
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
 * 다시 조회하지 않는다.
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
  const claimed = await deps.rpc<ClaimResult>('claim_adult_verification_callback', {
    p_callback_nonce_digest: adultVerificationNonceDigest(input.nonce),
    p_registration_key: input.registrationKey,
    p_claim_token: claimToken,
  });
  if (claimed.error || !claimed.data) return { kind: 'invalid' };
  if (claimed.data.claimStatus !== 'claimed') return { kind: 'confirm', nonce: input.nonce };

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
    return { kind: 'confirm', nonce: input.nonce } as const;
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

  return { kind: 'confirm', nonce: input.nonce };
}

export type AdultVerificationCompletion =
  | {
    readonly outcome: 'verified' | 'underage' | 'failed' | 'expired' | 'pending';
    readonly presentation: AdultVerificationPresentation;
    readonly returnPath: string;
  }
  | { readonly outcome: 'not_found' };

interface CompletionRow {
  readonly outcome?: string;
  readonly presentation?: string;
  readonly returnPath?: string;
}

const COMPLETION_OUTCOMES = new Set(['verified', 'underage', 'failed', 'expired', 'pending']);

/**
 * 확정은 세션 주인의 로그인 세션으로 부른다 — service role이 아니다. rpc는 사용자 쿠키로
 * 만든 클라이언트의 것이어야 한다.
 */
export async function completeAdultVerification(
  nonce: string,
  rpc: <T>(fn: string, args: Record<string, unknown>) => Promise<RpcResult<T>>,
): Promise<AdultVerificationCompletion> {
  if (!isAdultVerificationNonce(nonce)) return { outcome: 'not_found' };
  const completed = await rpc<CompletionRow>('complete_my_adult_verification', {
    p_callback_nonce_digest: adultVerificationNonceDigest(nonce),
  });
  const row = completed.data;
  if (
    completed.error
    || !row
    || typeof row.outcome !== 'string'
    || !COMPLETION_OUTCOMES.has(row.outcome)
    || (row.presentation !== 'popup' && row.presentation !== 'page')
  ) {
    return { outcome: 'not_found' };
  }
  return {
    outcome: row.outcome as 'verified' | 'underage' | 'failed' | 'expired' | 'pending',
    presentation: row.presentation,
    returnPath: adultVerificationReturnPath(row.returnPath),
  };
}
