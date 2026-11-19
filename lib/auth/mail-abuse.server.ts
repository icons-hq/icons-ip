import 'server-only';

import { createHmac } from 'node:crypto';
import { headers } from 'next/headers';
import { createServiceClient } from '@/lib/supabase/service';

/*
 * 가입·로그인·확인 메일 재전송·비밀번호 재설정 요청의 서버 측 방어(원장 CUS-003·OPS-085).
 *
 * 1) Cloudflare Turnstile — NEXT_PUBLIC_TURNSTILE_SITE_KEY가 있으면 폼에 위젯이 그려지고, 앱은 토큰을 siteverify하지 않고
 *    `options.captchaToken`으로 GoTrue에 그대로 넘긴다. 토큰은 1회용이라 앱과 GoTrue가 함께 검증할 수 없고, 공개 publishable 키로
 *    `/auth/v1/signup`·`/recover`·`/resend`·`/otp`·`/magiclink`·`/token`(password)을 직접 부르는 우회는 앱 서버가 볼 수 없으므로
 *    방어선은 GoTrue에 둔다(Supabase Auth CAPTCHA, 비밀 키는 배포 파이프라인 scripts/sync-supabase-auth.mjs가 프로젝트에 PATCH).
 *    GoTrue가 토큰을 요구하는 엔드포인트: supabase/auth internal/api/api.go의 verifyCaptcha — /signup, /recover, /resend, /magiclink,
 *    /otp, /token(grant_type password·web3; pkce·refresh_token·id_token은 면제), /sso, 패스키 options. /verify·/user·/authorize는 아니다.
 *    사이트 키만 있고 프로젝트 CAPTCHA가 꺼져 있으면 위젯만 그려지고 보호는 없다 — 둘의 짝은 런북 §13 순서로 맞춘다.
 * 2) 접속 IP·이메일 시도 한도 — DB 원장(private.auth_mail_abuse_attempts)이 판정하고 메일을 보내기 전에 거절한다. 앱 서버를
 *    거치는 요청만 센다(직접 호출 우회는 위 1이 막는다). IP·이메일 원문은 저장하지 않고 HMAC 다이제스트만 보낸다.
 *
 * 비밀값은 이미 운영 필수 env인 AUTH_SIGNUP_RESEND_SECRET을 재사용한다(빌드 가드가 production·preview에서 요구).
 * 쿠키 서명과 키가 같아도 메시지 앞에 도메인 접두를 붙여 서로의 값을 위조·충돌시킬 수 없다. 비밀값이 없으면(로컬 등)
 * 한도를 건너뛰고 경고만 남긴다 — 방어 설정 누락이 가입을 막아서는 안 된다. DB 호출이 실패해도 같은 이유로 열어 둔다
 * (Supabase Auth 자체 한도와 앱 쿠키 창은 남는다).
 */

const DIGEST_DOMAIN = 'icons-auth-mail-abuse-v1';
export const TURNSTILE_RESPONSE_FIELD = 'cf-turnstile-response';

export type AuthMailAction = 'signup' | 'resend' | 'reset';
export type CaptchaScreen = AuthMailAction | 'signin';

const CAPTCHA_FAILED_MESSAGES: Record<CaptchaScreen, string> = {
  signup: '자동 가입 방지 확인을 완료하지 못했습니다. 화면을 새로고침한 뒤 다시 시도해주세요.',
  resend: '자동 가입 방지 확인을 완료하지 못했습니다. 화면을 새로고침한 뒤 다시 시도해주세요.',
  reset: '자동 요청 방지 확인을 완료하지 못했습니다. 화면을 새로고침한 뒤 다시 시도해주세요.',
  signin: '자동 로그인 방지 확인을 완료하지 못했습니다. 화면을 새로고침한 뒤 다시 시도해주세요.',
};

export function captchaFailedMessage(screen: CaptchaScreen): string {
  return CAPTCHA_FAILED_MESSAGES[screen];
}

type RuntimeEnvironment = Readonly<Record<string, string | undefined>>;

function envValue(env: RuntimeEnvironment, name: string) {
  return env[name]?.trim() || null;
}

/** 사이트 키가 있으면 폼에 위젯이 있고 서버 액션은 토큰을 요구한다. */
export function turnstileEnabled(env: RuntimeEnvironment = process.env): boolean {
  return envValue(env, 'NEXT_PUBLIC_TURNSTILE_SITE_KEY') !== null;
}

/** 폼의 Turnstile 토큰. 꺼져 있으면 undefined(GoTrue에 보내지 않는다), 켜져 있는데 비었거나 이상하면 null(거절). */
export function captchaTokenFromForm(formData: FormData, env: RuntimeEnvironment = process.env): string | undefined | null {
  if (!turnstileEnabled(env)) return undefined;
  const token = formData.get(TURNSTILE_RESPONSE_FIELD);
  return typeof token === 'string' && token.length > 0 && token.length <= 2048 ? token : null;
}

/** GoTrue의 CAPTCHA 검증 실패(captcha_failed). 토큰이 없거나 이미 쓰였거나 만료된 경우. */
export function isCaptchaError(error: { code?: string | null } | null | undefined): boolean {
  return error?.code?.toLowerCase() === 'captcha_failed';
}

/*
 * Auth 프로젝트 메일 한도(rate_limit_email_sent)에 걸렸을 때 운영 경보용 태그 로그를 남긴다. Vercel 로그 경보가 이 태그를 본다.
 * 이메일·IP 원문은 싣지 않는다.
 */
export const AUTH_MAIL_LIMIT_LOG_TAG = '[auth-mail-limit]';
export function logAuthMailLimit(error: { code?: string | null; status?: number | null } | null | undefined, action: CaptchaScreen) {
  if (error?.code?.toLowerCase() !== 'over_email_send_rate_limit') return;
  console.error(`${AUTH_MAIL_LIMIT_LOG_TAG} Supabase Auth hourly mail limit reached`, { action, status: error.status ?? null });
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

export type AuthMailAttemptResult =
  | { ok: true }
  | { ok: false; retryAfterSeconds: number | null; scope: 'ip' | 'email' | null };

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
      return {
        ok: false,
        retryAfterSeconds: typeof seconds === 'number' && Number.isFinite(seconds) ? seconds : null,
        scope: result.scope === 'ip' || result.scope === 'email' ? result.scope : null,
      };
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
