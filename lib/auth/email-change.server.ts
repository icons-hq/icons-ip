import 'server-only';

import { createHmac, randomInt, randomUUID } from 'node:crypto';
import type { EmailProvider } from '@/lib/email/dispatcher';
import { resendEmailProviderFromEnvironment } from '@/lib/email/resend-provider.server';
import { escapeHtml } from '@/lib/email/templates';
import { createServiceClient } from '@/lib/supabase/service';
import { EMAIL_CHANGE_CODE_LENGTH, EMAIL_CHANGE_CODE_TTL_SECONDS, normalizeEmailInput } from './email-change';

/*
 * 이메일 변경 코드(2026-11-17). 휴대폰 번호 인증과 같은 모양이다 — 코드는 서버가 만들고 원문 대신 HMAC만 DB에 남긴다.
 * 판정(대상 계정·한도·5회 잠금·만료·'이미 쓰는 주소'는 코드를 맞힌 뒤에만)은 DB의 service_*_member_email_change가 한다.
 * DB가 코드를 확인하면 서비스 롤 Admin API로 로그인 이메일을 바꾼다(email_confirm) — 프로필 이메일은 DB 트리거가 맞춘다.
 *
 * 비밀값은 이미 운영에 있는 메일 발송 HMAC 비밀값(EMAIL_DISPATCH_HMAC_SECRET)을 쓰되 도메인을 나눈다. 메일은 거래 메일과
 * 같은 Resend 설정(RESEND_* 또는 EMAIL_*)으로 보낸다. 둘 중 하나라도 없으면 기능이 닫힌다(화면이 그리지 않는다).
 * 로컬(Vercel 밖)에서 메일 설정이 없으면 코드를 서버 로그에 남기는 console 발송을 쓴다 — Preview·운영에는 없다.
 */

const DIGEST_DOMAIN = 'icons:member-email-change:v1';

type RuntimeEnvironment = Readonly<Record<string, string | undefined>>;

export interface EmailChangeMessage {
  to: string;
  challengeId: string;
  subject: string;
  text: string;
  html: string;
}

export interface EmailChangeSender {
  readonly provider: string;
  send(message: EmailChangeMessage): Promise<boolean>;
}

export interface EmailChangeConfig {
  secret: string;
  sender: EmailChangeSender;
}

function maskedEmail(email: string) {
  const [local = '', domain = ''] = email.split('@');
  return `${local.slice(0, 1)}***@${domain}`;
}

export function createConsoleEmailChangeSender(write: (line: string) => void = console.info): EmailChangeSender {
  return {
    provider: 'console',
    async send(message) {
      write(`[email-change:console] to=${maskedEmail(message.to)} text=${message.text.split('\n').find((line) => line.startsWith('인증 코드')) ?? ''}`);
      return true;
    },
  };
}

export function emailChangeSenderFromProvider(provider: EmailProvider): EmailChangeSender {
  return {
    provider: 'resend',
    async send(message) {
      const outcome = await provider.send({
        intentId: message.challengeId,
        idempotencyKey: `member-email-change:${message.challengeId}`,
        recipient: message.to,
        message: { subject: message.subject, text: message.text, html: message.html },
      });
      return outcome.kind === 'accepted';
    },
  };
}

export function emailChangeConfig(
  env: RuntimeEnvironment = process.env,
  provider: () => EmailProvider | null = resendEmailProviderFromEnvironment,
): EmailChangeConfig | null {
  /* 거래 메일 발송 기록(lib/email/supabase-dispatcher-repository.server.ts)과 같은 비밀값·같은 32자 기준이다. */
  const secret = env.EMAIL_DISPATCH_HMAC_SECRET;
  if (!secret || secret.length < 32) return null;
  const emailProvider = provider();
  if (emailProvider) return { secret, sender: emailChangeSenderFromProvider(emailProvider) };
  if (!env.VERCEL && !env.VERCEL_ENV) return { secret, sender: createConsoleEmailChangeSender() };
  return null;
}

function digest(secret: string, kind: 'email' | 'ip' | 'code', value: string) {
  return createHmac('sha256', secret).update(DIGEST_DOMAIN).update('\0').update(kind).update('\0').update(value).digest('base64url');
}

export function emailChangeCodeDigest(secret: string, challengeId: string, code: string) {
  return digest(secret, 'code', `${challengeId}\0${code}`);
}

export function generateEmailChangeCode(random: (maxExclusive: number) => number = randomInt): string {
  let code = '';
  for (let index = 0; index < EMAIL_CHANGE_CODE_LENGTH; index += 1) code += String(random(10));
  return code;
}

export function renderEmailChangeCodeEmail(code: string) {
  const minutes = Math.round(EMAIL_CHANGE_CODE_TTL_SECONDS / 60);
  const subject = '[ICONS] 이메일 변경 인증 코드';
  const text = [
    'ICONS 계정의 이메일을 이 주소로 바꾸려면 아래 인증 코드를 입력해주세요.',
    '',
    `인증 코드: ${code}`,
    '',
    `코드는 ${minutes}분 동안 쓸 수 있어요. 요청하지 않았다면 이 메일을 무시해주세요. 이메일은 바뀌지 않아요.`,
  ].join('\n');
  const html = `<p>ICONS 계정의 이메일을 이 주소로 바꾸려면 아래 인증 코드를 입력해주세요.</p>`
    + `<p style="font-size:24px;font-weight:700;letter-spacing:4px">${escapeHtml(code)}</p>`
    + `<p>코드는 ${minutes}분 동안 쓸 수 있어요. 요청하지 않았다면 이 메일을 무시해주세요. 이메일은 바뀌지 않아요.</p>`;
  return { subject, text, html };
}

type ServiceClient = ReturnType<typeof createServiceClient>;

export interface EmailChangeDependencies {
  config: EmailChangeConfig;
  service?: ServiceClient;
  newChallengeId?: () => string;
  newCode?: () => string;
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function retryAfterWords(seconds: unknown) {
  const value = typeof seconds === 'number' && Number.isFinite(seconds) ? Math.max(1, Math.ceil(seconds)) : null;
  if (value === null) return '잠시 후';
  return value < 60 ? `${value}초 후` : `${Math.ceil(value / 60)}분 후`;
}

const NOT_ELIGIBLE = '이 계정은 여기서 이메일을 바꿀 수 없어요.';
const EMAIL_TAKEN = '이 이메일로 가입된 다른 계정이 있어요. 그 계정으로 로그인하거나 다른 이메일을 입력해주세요.';

export type RequestEmailChangeResult =
  | { ok: true; challengeId: string; email: string }
  | { ok: false; field: 'email' | 'form'; error: string };

export async function requestEmailChangeCode(
  input: { userId: string; email: unknown; ip: string | null },
  deps: EmailChangeDependencies,
): Promise<RequestEmailChangeResult> {
  const normalized = normalizeEmailInput(input.email);
  if (!normalized.ok) return { ok: false, field: 'email', error: normalized.error };

  const { config } = deps;
  const service = deps.service ?? createServiceClient();
  const challengeId = (deps.newChallengeId ?? randomUUID)();
  const code = (deps.newCode ?? generateEmailChangeCode)();
  const { data, error } = await service.rpc('service_issue_member_email_change', {
    p_challenge_id: challengeId,
    p_user_id: input.userId,
    p_email: normalized.email,
    p_email_digest: digest(config.secret, 'email', normalized.email),
    p_ip_digest: input.ip ? digest(config.secret, 'ip', input.ip) : null,
    p_code_digest: emailChangeCodeDigest(config.secret, challengeId, code),
    p_ttl_seconds: EMAIL_CHANGE_CODE_TTL_SECONDS,
  });
  const result = record(data);
  if (error || !result) return { ok: false, field: 'form', error: '인증 코드를 보내지 못했어요. 잠시 후 다시 시도해주세요.' };
  if (result.ok !== true) {
    switch (result.reason) {
      case 'cooldown':
      case 'rate_limited':
        return { ok: false, field: 'form', error: `인증 코드 요청이 너무 잦아요. ${retryAfterWords(result.retryAfterSeconds)} 다시 시도해주세요.` };
      case 'email_unusable':
        return { ok: false, field: 'email', error: '실제로 메일을 받을 수 있는 이메일을 입력해주세요.' };
      case 'same_email':
        return { ok: false, field: 'email', error: '지금 쓰는 이메일과 같아요. 다른 이메일을 입력해주세요.' };
      case 'not_eligible':
        return { ok: false, field: 'form', error: NOT_ELIGIBLE };
      case 'account_unavailable':
        return { ok: false, field: 'form', error: '지금은 이 계정의 이메일을 바꿀 수 없어요.' };
      default:
        return { ok: false, field: 'form', error: '인증 코드를 보내지 못했어요. 잠시 후 다시 시도해주세요.' };
    }
  }

  const sent = await config.sender.send({ to: normalized.email, challengeId, ...renderEmailChangeCodeEmail(code) }).catch(() => false);
  if (!sent) {
    await service.rpc('service_fail_member_email_change', { p_challenge_id: challengeId, p_user_id: input.userId });
    return { ok: false, field: 'form', error: '인증 코드 메일을 보내지 못했어요. 이메일을 확인하고 잠시 후 다시 시도해주세요.' };
  }
  return { ok: true, challengeId, email: normalized.email };
}

export type VerifyEmailChangeResult =
  | { ok: true; email: string }
  | { ok: false; field: 'code' | 'form'; error: string; restart: boolean };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function verifyEmailChangeCode(
  input: { userId: string; challengeId: unknown; code: unknown },
  deps: EmailChangeDependencies,
): Promise<VerifyEmailChangeResult> {
  if (typeof input.challengeId !== 'string' || !UUID.test(input.challengeId)) {
    return { ok: false, field: 'form', error: '인증 코드를 다시 받아주세요.', restart: true };
  }
  const code = typeof input.code === 'string' ? input.code.replace(/\s+/g, '') : '';
  if (!new RegExp(`^\\d{${EMAIL_CHANGE_CODE_LENGTH}}$`).test(code)) {
    return { ok: false, field: 'code', error: '메일로 받은 6자리 숫자를 입력해주세요.', restart: false };
  }

  const service = deps.service ?? createServiceClient();
  const { data, error } = await service.rpc('service_verify_member_email_change', {
    p_challenge_id: input.challengeId,
    p_user_id: input.userId,
    p_code_digest: emailChangeCodeDigest(deps.config.secret, input.challengeId, code),
  });
  const result = record(data);
  if (error || !result) return { ok: false, field: 'form', error: '인증 코드를 확인하지 못했어요. 잠시 후 다시 시도해주세요.', restart: false };
  if (result.ok !== true || typeof result.email !== 'string') {
    switch (result.reason) {
      case 'mismatch':
        return {
          ok: false,
          field: 'code',
          error: `인증 코드가 맞지 않아요.${typeof result.remainingAttempts === 'number' ? ` ${result.remainingAttempts}번 더 입력할 수 있어요.` : ''}`,
          restart: false,
        };
      case 'expired':
        return { ok: false, field: 'form', error: '인증 코드 입력 시간이 지났어요. 인증 코드를 다시 받아주세요.', restart: true };
      case 'exhausted':
        return { ok: false, field: 'form', error: '인증 코드를 여러 번 틀렸어요. 인증 코드를 다시 받아주세요.', restart: true };
      case 'email_taken':
        return { ok: false, field: 'form', error: EMAIL_TAKEN, restart: true };
      case 'not_eligible':
        return { ok: false, field: 'form', error: NOT_ELIGIBLE, restart: true };
      case 'account_unavailable':
        return { ok: false, field: 'form', error: '지금은 이 계정의 이메일을 바꿀 수 없어요.', restart: true };
      default:
        return { ok: false, field: 'form', error: '인증 코드를 다시 받아주세요.', restart: true };
    }
  }

  /* 코드를 맞힌 뒤에만 로그인 이메일을 바꾼다. 확인 메일을 다시 보내지 않도록 email_confirm으로 확인된 주소로 둔다.
     그 사이 같은 주소로 다른 계정이 생겼으면 GoTrue가 email_exists로 거절한다. */
  const { error: updateError } = await service.auth.admin.updateUserById(input.userId, { email: result.email, email_confirm: true });
  if (updateError) {
    const code = (updateError as { code?: unknown }).code;
    return code === 'email_exists'
      ? { ok: false, field: 'form', error: EMAIL_TAKEN, restart: true }
      : { ok: false, field: 'form', error: '이메일을 바꾸지 못했어요. 잠시 후 인증 코드를 다시 받아주세요.', restart: true };
  }
  return { ok: true, email: result.email };
}
