import 'server-only';

import { createHmac } from 'node:crypto';
import { headers } from 'next/headers';
import { createServiceClient } from '@/lib/supabase/service';

/*
 * 가입·확인 메일 재전송·비밀번호 재설정 요청의 서버 측 방어(원장 CUS-003·OPS-085).
 *
 * 1) Cloudflare Turnstile — NEXT_PUBLIC_TURNSTILE_SITE_KEY와 TURNSTILE_SECRET_KEY가 둘 다 있을 때만 켜진다.
 *    Supabase Auth 자체 CAPTCHA는 쓰지 않는다: 켜면 이 세 요청뿐 아니라 모든 Auth 호출(로그인·소셜·콜백 교환)에
 *    토큰이 필요해지고, 앱 서버가 이 세 요청의 유일한 메일 발송 경로이므로 서버 검증으로 충분하다.
 * 2) 접속 IP·이메일 시도 한도 — DB 원장(private.auth_mail_abuse_attempts)이 판정하고 메일을 보내기 전에 거절한다.
 *    IP·이메일 원문은 저장하지 않고 HMAC 다이제스트만 보낸다.
 *
 * 비밀값은 이미 운영 필수 env인 AUTH_SIGNUP_RESEND_SECRET을 재사용한다(빌드 가드가 production·preview에서 요구).
 * 쿠키 서명과 키가 같아도 메시지 앞에 도메인 접두를 붙여 서로의 값을 위조·충돌시킬 수 없다. 비밀값이 없으면(로컬 등)
 * 한도를 건너뛰고 경고만 남긴다 — 방어 설정 누락이 가입을 막아서는 안 된다. DB 호출이 실패해도 같은 이유로 열어 둔다
 * (Supabase Auth 자체 한도와 앱 쿠키 창은 남는다).
 */

const DIGEST_DOMAIN = 'icons-auth-mail-abuse-v1';
const TURNSTILE_VERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';
const TURNSTILE_TIMEOUT_MS = 5000;
export const TURNSTILE_RESPONSE_FIELD = 'cf-turnstile-response';

export type AuthMailAction = 'signup' | 'resend' | 'reset';

export const TURNSTILE_FAILED_MESSAGE = '자동 가입 방지 확인을 완료하지 못했습니다. 잠시 후 화면을 새로고침하고 다시 시도해주세요.';

type RuntimeEnvironment = Readonly<Record<string, string | undefined>>;

function envValue(env: RuntimeEnvironment, name: string) {
  return env[name]?.trim() || null;
}

/** 둘 다 있을 때만 켜진다. 하나만 있으면 꺼진 채로 둔다(빌드 가드가 그 설정을 막는다). */
export function turnstileSecretFromEnvironment(env: RuntimeEnvironment = process.env): string | null {
  return envValue(env, 'NEXT_PUBLIC_TURNSTILE_SITE_KEY') && envValue(env, 'TURNSTILE_SECRET_KEY')
    ? envValue(env, 'TURNSTILE_SECRET_KEY')
    : null;
}

type FetchLike = (input: string, init: RequestInit) => Promise<{ ok: boolean; json(): Promise<unknown> }>;

/** Turnstile이 꺼져 있으면 항상 통과한다. 켜져 있으면 토큰이 없거나 검증이 실패·시간 초과여도 거절한다. */
export async function verifyTurnstileToken(
  formData: FormData,
  ip: string | null,
  deps: { env?: RuntimeEnvironment; fetch?: FetchLike } = {},
): Promise<boolean> {
  const secret = turnstileSecretFromEnvironment(deps.env ?? process.env);
  if (!secret) return true;

  const token = formData.get(TURNSTILE_RESPONSE_FIELD);
  if (typeof token !== 'string' || token.length === 0 || token.length > 2048) return false;

  const body = new URLSearchParams({ secret, response: token });
  if (ip) body.set('remoteip', ip);
  try {
    const response = await (deps.fetch ?? fetch)(TURNSTILE_VERIFY_URL, {
      method: 'POST',
      body,
      signal: AbortSignal.timeout(TURNSTILE_TIMEOUT_MS),
    });
    if (!response.ok) return false;
    const result = await response.json() as { success?: unknown };
    return result?.success === true;
  } catch {
    return false;
  }
}

/** Vercel이 덮어쓰는 접속 IP 헤더(휴대폰 인증과 같은 선례). 없으면 이메일 한도만 적용된다. */
export async function requestClientIp(): Promise<string | null> {
  const list = await headers();
  const value = (list.get('x-real-ip') ?? list.get('x-forwarded-for')?.split(',')[0] ?? '').trim();
  return value && value.length <= 64 ? value : null;
}

export function authMailDigest(secret: string, kind: 'ip' | 'email', value: string) {
  return createHmac('sha256', secret).update(DIGEST_DOMAIN).update('\0').update(kind).update('\0').update(value).digest('base64url');
}

export type AuthMailAttemptResult = { ok: true } | { ok: false; retryAfterSeconds: number | null };

let warnedMissingSecret = false;

/** 메일을 보내기 전에 한 번 부른다. 한도를 넘으면 { ok: false }를 돌려주고 메일을 보내면 안 된다. */
export async function consumeAuthMailAttempt(
  input: { action: AuthMailAction; email: string; ip: string | null },
  deps: { secret?: string | null; service?: Pick<ReturnType<typeof createServiceClient>, 'rpc'> } = {},
): Promise<AuthMailAttemptResult> {
  const secret = deps.secret === undefined ? envValue(process.env, 'AUTH_SIGNUP_RESEND_SECRET') : deps.secret;
  if (!secret) {
    if (!warnedMissingSecret) {
      warnedMissingSecret = true;
      console.warn('[auth-mail-abuse] AUTH_SIGNUP_RESEND_SECRET is not set: IP/email attempt limits are skipped');
    }
    return { ok: true };
  }

  try {
    const service = deps.service ?? createServiceClient();
    const { data, error } = await service.rpc('service_consume_auth_mail_attempt', {
      p_action: input.action,
      p_ip_digest: input.ip ? authMailDigest(secret, 'ip', input.ip) : null,
      p_email_digest: authMailDigest(secret, 'email', input.email.trim().toLowerCase()),
    });
    if (error) {
      console.error('[auth-mail-abuse] limit check failed; allowing the request', error.message);
      return { ok: true };
    }
    const result = data && typeof data === 'object' ? data as Record<string, unknown> : null;
    if (result?.ok === true) return { ok: true };
    if (result?.ok === false) {
      const seconds = result.retryAfterSeconds;
      return { ok: false, retryAfterSeconds: typeof seconds === 'number' && Number.isFinite(seconds) ? seconds : null };
    }
    console.error('[auth-mail-abuse] unexpected limit check response; allowing the request');
    return { ok: true };
  } catch (error) {
    console.error('[auth-mail-abuse] limit check threw; allowing the request', error instanceof Error ? error.message : error);
    return { ok: true };
  }
}

/** 기존 쿠키 한도 문구와 같은 형태. 남은 시간을 알면 그 시간(올림), 모르면 10분. */
export function authMailLimitedWait(retryAfterSeconds: number | null): string {
  if (retryAfterSeconds === null) return '10분 후';
  const seconds = Math.max(1, Math.ceil(retryAfterSeconds));
  if (seconds <= 600) return '10분 후';
  if (seconds < 3600) return `${Math.ceil(seconds / 60)}분 후`;
  return `${Math.ceil(seconds / 3600)}시간 후`;
}
