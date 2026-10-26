import 'server-only';

import { createHmac, timingSafeEqual } from 'node:crypto';
import { safeNextPath, UPDATE_PASSWORD_PATH } from './onboarding';

export const AUTH_NEXT_SIGNUP_MAX_AGE_SECONDS = 10 * 60;
export const AUTH_NEXT_RECOVERY_MAX_AGE_SECONDS = 60 * 60;
export const AUTH_RECOVERY_PROOF_MAX_AGE_SECONDS = 15 * 60;
export const AUTH_PASSWORD_RESET_COOKIE_NAME = 'icons_auth_password_reset';
export const AUTH_PASSWORD_RESET_COOKIE_MAX_AGE_SECONDS = 10 * 60;
export const PASSWORD_RESET_WINDOW_MS = 10 * 60 * 1000;
export const PASSWORD_RESET_MAX_ATTEMPTS = 3;
export const PASSWORD_RESET_MAX_BUCKETS = 12;

export type AuthNextPurpose = 'signup' | 'oauth' | 'recovery';

export interface AuthNextState {
  issuedAt: number;
  next: string;
  purpose: AuthNextPurpose;
}

interface PasswordResetBucket {
  attemptCount: number;
  emailHash: string;
  windowStartedAt: number;
}

interface PasswordResetRateState {
  buckets: PasswordResetBucket[];
}

const AUTH_NEXT_SIGNATURE_DOMAIN = 'icons-auth-next-v1';
const PASSWORD_RESET_EMAIL_DOMAIN = 'icons-password-reset-email-v1';
const PASSWORD_RESET_RATE_SIGNATURE_DOMAIN = 'icons-password-reset-rate-v1';
const PASSWORD_RECOVERY_PROOF_SIGNATURE_DOMAIN = 'icons-password-recovery-proof-v1';

function hmacDigest(secret: string, domain: string, value: string) {
  return createHmac('sha256', secret)
    .update(domain)
    .update('\0')
    .update(value)
    .digest('base64url');
}

function signaturesMatch(actual: string, expected: string) {
  const actualBuffer = Buffer.from(actual);
  const expectedBuffer = Buffer.from(expected);
  return actualBuffer.length === expectedBuffer.length && timingSafeEqual(actualBuffer, expectedBuffer);
}

function encodeSignedPayload(value: unknown, secret: string, domain: string) {
  const payload = Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');
  return `${payload}.${hmacDigest(secret, domain, payload)}`;
}

function decodeSignedPayload(value: string | null | undefined, secret: string, domain: string): unknown {
  if (!value || !secret) return null;

  try {
    const [payload, signature, extra] = value.split('.');
    if (!payload || !signature || extra !== undefined) return null;
    if (!signaturesMatch(signature, hmacDigest(secret, domain, payload))) return null;
    return JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
}

export function authCookieSecret() {
  return process.env.AUTH_SIGNUP_RESEND_SECRET?.trim() || null;
}

export function signedAuthNextCookieValue(
  next: string,
  purpose: AuthNextPurpose,
  issuedAt: number,
  secret: string,
) {
  return encodeSignedPayload({
    issuedAt,
    next: safeNextPath(next),
    purpose,
  } satisfies AuthNextState, secret, AUTH_NEXT_SIGNATURE_DOMAIN);
}

export function authNextStateFromCookie(
  value: string | null | undefined,
  now: number,
  secret: string | null,
): AuthNextState | null {
  if (!secret) return null;
  const parsed = decodeSignedPayload(value, secret, AUTH_NEXT_SIGNATURE_DOMAIN);
  if (!parsed || typeof parsed !== 'object') return null;

  const candidate = parsed as Partial<AuthNextState>;
  if (
    candidate.purpose !== 'signup'
    && candidate.purpose !== 'oauth'
    && candidate.purpose !== 'recovery'
  ) return null;
  if (typeof candidate.next !== 'string') return null;
  if (typeof candidate.issuedAt !== 'number' || !Number.isFinite(candidate.issuedAt)) return null;
  if (!Number.isInteger(candidate.issuedAt) || candidate.issuedAt > now) return null;

  const maxAgeSeconds = candidate.purpose === 'recovery'
    ? AUTH_NEXT_RECOVERY_MAX_AGE_SECONDS
    : AUTH_NEXT_SIGNUP_MAX_AGE_SECONDS;
  if (now - candidate.issuedAt >= maxAgeSeconds * 1000) return null;

  return {
    issuedAt: candidate.issuedAt,
    next: safeNextPath(candidate.next),
    purpose: candidate.purpose,
  };
}

/*
 * 비밀번호 복구 증명. /update-password는 로그인 세션만으로 비밀번호를 바꾸지 않는다 — 세션을 가진 사람이
 * 현재 비밀번호 없이 계정을 가져갈 수 있기 때문이다. recovery 콜백이 verifyOtp(type=recovery)를 통과한
 * 세션에만 이 서명 쿠키를 남기고, 화면과 서버 action은 쿠키의 사용자·세션이 검증된 access token claims와
 * 같을 때만 비밀번호를 받는다. JWT `amr`은 recovery와 매직링크를 똑같이 `otp`로 남겨 증명으로 쓰지 않는다.
 */
export interface PasswordRecoveryProof {
  issuedAt: number;
  sessionId: string;
  userId: string;
}

interface PasswordRecoveryClaimsReader {
  auth: {
    getClaims: () => Promise<{
      data: { claims: { sub?: unknown; session_id?: unknown } } | null;
      error: unknown;
    }>;
  };
}

export function signedPasswordRecoveryProofValue(
  proof: Pick<PasswordRecoveryProof, 'sessionId' | 'userId'>,
  issuedAt: number,
  secret: string,
) {
  return encodeSignedPayload({
    issuedAt,
    sessionId: proof.sessionId,
    userId: proof.userId,
  } satisfies PasswordRecoveryProof, secret, PASSWORD_RECOVERY_PROOF_SIGNATURE_DOMAIN);
}

export function passwordRecoveryProofFromCookie(
  value: string | null | undefined,
  now: number,
  secret: string | null,
): PasswordRecoveryProof | null {
  if (!secret) return null;
  const parsed = decodeSignedPayload(value, secret, PASSWORD_RECOVERY_PROOF_SIGNATURE_DOMAIN);
  if (!parsed || typeof parsed !== 'object') return null;

  const candidate = parsed as Partial<PasswordRecoveryProof>;
  if (typeof candidate.userId !== 'string' || !candidate.userId) return null;
  if (typeof candidate.sessionId !== 'string' || !candidate.sessionId) return null;
  if (typeof candidate.issuedAt !== 'number' || !Number.isInteger(candidate.issuedAt)) return null;
  if (candidate.issuedAt > now) return null;
  if (now - candidate.issuedAt >= AUTH_RECOVERY_PROOF_MAX_AGE_SECONDS * 1000) return null;

  return {
    issuedAt: candidate.issuedAt,
    sessionId: candidate.sessionId,
    userId: candidate.userId,
  };
}

export function passwordRecoveryProofCookieOptions(secure: boolean) {
  return {
    httpOnly: true,
    maxAge: AUTH_RECOVERY_PROOF_MAX_AGE_SECONDS,
    path: UPDATE_PASSWORD_PATH,
    sameSite: 'lax' as const,
    secure,
  };
}

export async function hasPasswordRecoveryProof(
  supabase: PasswordRecoveryClaimsReader,
  cookieValue: string | null | undefined,
  now: number = Date.now(),
  secret: string | null = authCookieSecret(),
) {
  const proof = passwordRecoveryProofFromCookie(cookieValue, now, secret);
  if (!proof) return false;

  try {
    const { data, error } = await supabase.auth.getClaims();
    if (error || !data) return false;
    return data.claims.sub === proof.userId && data.claims.session_id === proof.sessionId;
  } catch {
    return false;
  }
}

function normalizedEmail(email: string) {
  return email.trim().toLowerCase();
}

function passwordResetEmailHash(email: string, secret: string) {
  return hmacDigest(secret, PASSWORD_RESET_EMAIL_DOMAIN, normalizedEmail(email));
}

function passwordResetRateStateFromCookie(
  value: string | null | undefined,
  now: number,
  secret: string,
): PasswordResetRateState {
  const parsed = decodeSignedPayload(value, secret, PASSWORD_RESET_RATE_SIGNATURE_DOMAIN);
  if (!parsed || typeof parsed !== 'object' || !Array.isArray((parsed as Partial<PasswordResetRateState>).buckets)) {
    return { buckets: [] };
  }

  const buckets = (parsed as PasswordResetRateState).buckets.filter((bucket): bucket is PasswordResetBucket => (
    Boolean(bucket)
    && typeof bucket.emailHash === 'string'
    && Boolean(bucket.emailHash)
    && typeof bucket.attemptCount === 'number'
    && Number.isInteger(bucket.attemptCount)
    && bucket.attemptCount >= 0
    && typeof bucket.windowStartedAt === 'number'
    && Number.isFinite(bucket.windowStartedAt)
    && Number.isInteger(bucket.windowStartedAt)
    && bucket.windowStartedAt <= now
    && now - bucket.windowStartedAt < PASSWORD_RESET_WINDOW_MS
  ));

  return { buckets };
}

export function consumePasswordResetAttempt(
  value: string | null | undefined,
  email: string,
  now: number,
  secret: string,
) {
  const state = passwordResetRateStateFromCookie(value, now, secret);
  const targetEmailHash = passwordResetEmailHash(email, secret);
  const existingIndex = state.buckets.findIndex((bucket) => bucket.emailHash === targetEmailHash);
  const existingBucket = existingIndex === -1 ? null : state.buckets[existingIndex];

  if (existingBucket && existingBucket.attemptCount >= PASSWORD_RESET_MAX_ATTEMPTS) {
    return {
      attemptCount: existingBucket.attemptCount,
      blocked: true,
      cookieValue: encodeSignedPayload(state, secret, PASSWORD_RESET_RATE_SIGNATURE_DOMAIN),
    };
  }

  if (!existingBucket && state.buckets.length >= PASSWORD_RESET_MAX_BUCKETS) {
    return {
      attemptCount: 0,
      blocked: true,
      cookieValue: encodeSignedPayload(state, secret, PASSWORD_RESET_RATE_SIGNATURE_DOMAIN),
    };
  }

  const nextBucket: PasswordResetBucket = {
    attemptCount: (existingBucket?.attemptCount ?? 0) + 1,
    emailHash: targetEmailHash,
    windowStartedAt: existingBucket?.windowStartedAt ?? now,
  };

  if (existingIndex === -1) state.buckets.push(nextBucket);
  else state.buckets[existingIndex] = nextBucket;

  return {
    attemptCount: nextBucket.attemptCount,
    blocked: false,
    cookieValue: encodeSignedPayload(state, secret, PASSWORD_RESET_RATE_SIGNATURE_DOMAIN),
  };
}
