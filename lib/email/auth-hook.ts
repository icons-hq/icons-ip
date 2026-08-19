import type { DispatchEmailInput, EnqueueEmailInput } from './dispatcher';
import { trustedAuthOrigin } from '@/lib/auth/trusted-origin';

export interface PlannedAuthEmail extends EnqueueEmailInput {
  message: DispatchEmailInput['message'];
}

interface AuthHookUser {
  id: string;
  email: string;
  newEmail: string | null;
}

interface AuthHookEmailData {
  token: string;
  tokenHash: string;
  tokenNew: string;
  tokenHashNew: string;
  redirectTo: string;
  action: string;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const TOKEN_PATTERN = /^[A-Za-z0-9_+/=-]{1,512}$/;

function invalid(): never {
  throw new Error('invalid_auth_hook_payload');
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid();
  return value as Record<string, unknown>;
}

function string(value: unknown, max: number, allowEmpty = false): string {
  if (typeof value !== 'string' || value.length > max || (!allowEmpty && value.length === 0)) invalid();
  return value;
}

function email(value: unknown): string {
  const candidate = string(value, 320).trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(candidate)) invalid();
  return candidate;
}

function token(value: unknown, allowEmpty = false): string {
  const candidate = string(value, 512, allowEmpty);
  if (!allowEmpty || candidate.length > 0) {
    if (!TOKEN_PATTERN.test(candidate)) invalid();
  }
  return candidate;
}

function callbackRedirect(value: string, expectedPath: '/auth/callback' | '/auth/recovery/callback'): string {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    invalid();
  }
  if (!trustedAuthOrigin(parsed.origin)
    || parsed.username
    || parsed.password
    || parsed.pathname !== expectedPath
    || parsed.search
    || parsed.hash) invalid();
  return parsed.toString();
}

function parsePayload(payload: unknown): { user: AuthHookUser; emailData: AuthHookEmailData } {
  const root = record(payload);
  const rawUser = record(root.user);
  const rawEmail = record(root.email_data);
  const id = string(rawUser.id, 64).toLowerCase();
  if (!UUID_PATTERN.test(id)) invalid();

  return {
    user: {
      id,
      email: email(rawUser.email),
      newEmail: typeof rawUser.new_email === 'string' && rawUser.new_email.length > 0
        ? email(rawUser.new_email)
        : null,
    },
    emailData: {
      token: token(rawEmail.token, true),
      tokenHash: token(rawEmail.token_hash, true),
      tokenNew: token(rawEmail.token_new, true),
      tokenHashNew: token(rawEmail.token_hash_new, true),
      // Redirect is untrusted request input even inside a signed Hook payload.
      // It is parsed against the action-specific callback only when a link uses it.
      redirectTo: string(rawEmail.redirect_to, 2_048, true),
      action: string(rawEmail.email_action_type, 40),
    },
  };
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function verificationUrl(
  supabaseUrl: string,
  tokenHash: string,
  type: 'signup' | 'email_change',
  redirectTo: string,
): string {
  const url = new URL('/auth/v1/verify', supabaseUrl);
  url.searchParams.set('token', tokenHash);
  url.searchParams.set('type', type);
  url.searchParams.set('redirect_to', redirectTo);
  return url.toString();
}

function recoveryUrl(redirectTo: string, tokenHash: string): string {
  const url = new URL(redirectTo);
  if (url.pathname !== '/auth/recovery/callback') invalid();
  url.search = '';
  url.hash = '';
  url.searchParams.set('token_hash', tokenHash);
  url.searchParams.set('type', 'recovery');
  return url.toString();
}

function linkedMessage(subject: string, lead: string, url: string, label: string) {
  return {
    subject,
    text: `${lead}\n\n${url}\n\n본인이 요청하지 않았다면 이 메일을 무시해 주세요.`,
    html: [
      '<div style="font-family:Arial,sans-serif;color:#171717;background:#ffffff;padding:24px">',
      `<h1 style="font-size:20px">${escapeHtml(subject.replace('[ICONS] ', ''))}</h1>`,
      `<p>${escapeHtml(lead)}</p>`,
      `<p><a href="${escapeHtml(url)}">${escapeHtml(label)}</a></p>`,
      '<p style="color:#666">본인이 요청하지 않았다면 이 메일을 무시해 주세요.</p>',
      '</div>',
    ].join(''),
  };
}

function otpMessage(subject: string, lead: string, otp: string) {
  return {
    subject,
    text: `${lead}\n\n인증 코드: ${otp}\n\n본인이 요청하지 않았다면 이 메일을 무시해 주세요.`,
    html: [
      '<div style="font-family:Arial,sans-serif;color:#171717;background:#ffffff;padding:24px">',
      `<h1 style="font-size:20px">${escapeHtml(subject.replace('[ICONS] ', ''))}</h1>`,
      `<p>${escapeHtml(lead)}</p>`,
      `<p style="font-size:24px;font-weight:700;letter-spacing:4px">${escapeHtml(otp)}</p>`,
      '<p style="color:#666">본인이 요청하지 않았다면 이 메일을 무시해 주세요.</p>',
      '</div>',
    ].join(''),
  };
}

function plan(input: EnqueueEmailInput, message: DispatchEmailInput['message']): PlannedAuthEmail {
  return { ...input, message };
}

export function planAuthHookEmails(
  payload: unknown,
  config: { supabaseUrl: string },
): PlannedAuthEmail[] {
  const { user, emailData } = parsePayload(payload);

  if (emailData.action === 'signup') {
    if (!emailData.tokenHash) invalid();
    const redirectTo = callbackRedirect(emailData.redirectTo, '/auth/callback');
    const url = verificationUrl(config.supabaseUrl, emailData.tokenHash, 'signup', redirectTo);
    return [plan({
      source: 'auth_hook',
      sourceReference: `signup:${user.id}:${emailData.tokenHash}:primary`,
      recipient: user.email,
      messageKind: 'auth_signup',
      contentRevision: 'auth_signup_v1',
    }, linkedMessage('[ICONS] 이메일을 확인해 주세요', 'ICONS 가입을 완료하려면 이메일을 확인해 주세요.', url, '이메일 확인하기'))];
  }

  if (emailData.action === 'recovery') {
    if (!emailData.tokenHash) invalid();
    const redirectTo = callbackRedirect(emailData.redirectTo, '/auth/recovery/callback');
    const url = recoveryUrl(redirectTo, emailData.tokenHash);
    return [plan({
      source: 'auth_hook',
      sourceReference: `recovery:${user.id}:${emailData.tokenHash}:primary`,
      recipient: user.email,
      messageKind: 'auth_recovery',
      contentRevision: 'auth_recovery_v1',
    }, linkedMessage('[ICONS] 비밀번호를 재설정해 주세요', '아래 링크에서 ICONS 비밀번호를 재설정해 주세요.', url, '비밀번호 재설정하기'))];
  }

  if (emailData.action === 'email_change') {
    if (!user.newEmail || !emailData.tokenHash || !emailData.tokenHashNew) invalid();
    const redirectTo = callbackRedirect(emailData.redirectTo, '/auth/callback');
    const currentUrl = verificationUrl(
      config.supabaseUrl,
      emailData.tokenHashNew,
      'email_change',
      redirectTo,
    );
    const newUrl = verificationUrl(
      config.supabaseUrl,
      emailData.tokenHash,
      'email_change',
      redirectTo,
    );
    return [
      plan({
        source: 'auth_hook',
        sourceReference: `email_change:${user.id}:${emailData.tokenHashNew}:current`,
        recipient: user.email,
        messageKind: 'auth_email_change_current',
        contentRevision: 'auth_email_change_current_v1',
      }, linkedMessage('[ICONS] 이메일 변경을 확인해 주세요', '현재 이메일 주소에서 변경 요청을 확인해 주세요.', currentUrl, '현재 이메일에서 확인하기')),
      plan({
        source: 'auth_hook',
        sourceReference: `email_change:${user.id}:${emailData.tokenHash}:new`,
        recipient: user.newEmail,
        messageKind: 'auth_email_change_new',
        contentRevision: 'auth_email_change_new_v1',
      }, linkedMessage('[ICONS] 새 이메일 주소를 확인해 주세요', '새 이메일 주소에서 변경 요청을 확인해 주세요.', newUrl, '새 이메일에서 확인하기')),
    ];
  }

  if (emailData.action === 'reauthentication') {
    if (!emailData.token || !emailData.tokenHash) invalid();
    return [plan({
      source: 'auth_hook',
      sourceReference: `reauthentication:${user.id}:${emailData.tokenHash}:primary`,
      recipient: user.email,
      messageKind: 'auth_reauthentication',
      contentRevision: 'auth_reauthentication_v1',
    }, otpMessage('[ICONS] 본인 확인 코드', '본인 확인 화면에 아래 코드를 입력해 주세요.', emailData.token))];
  }

  invalid();
}
