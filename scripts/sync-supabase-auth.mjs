/*
 * Supabase Auth URL 설정을 선언적으로 맞춘다.
 *
 * production과 preview 두 프로젝트가 같은 절차를 필요로 한다 — 설정을 읽고, 필요한
 * redirect를 더하고, 폐기된 redirect를 빼고, PATCH한 뒤 반영을 확인한다. 워크플로에
 * 인라인 bash로 두면 프로젝트마다 복제되므로 스크립트 하나로 모은다.
 *
 * 사용법 (환경변수로 받는다):
 *   SUPABASE_ACCESS_TOKEN   필수. Management API PAT.
 *   PROJECT_REF             필수. 대상 프로젝트 ref.
 *   SITE_URL                필수. Auth Site URL.
 *   REDIRECT_URLS           줄바꿈 구분. 반드시 allow-list에 있어야 하는 항목.
 *   PRUNE_REDIRECT_URLS     줄바꿈 구분(선택). allow-list에서 반드시 빠져야 하는 항목.
 *   REQUIRE_SMTP            'true'면 custom SMTP 미설정 시 실패한다.
 *   ENFORCE_MAILER          'true'면 confirmation·rate limit 설정까지 강제한다.
 *   EMAIL_OTP_EXPIRY_SECONDS 선택. email link/OTP TTL을 숫자로 일치시키고 read-back한다.
 *   RECOVERY_TEMPLATE_PATH  선택. recovery 메일 본문을 파일과 일치시키고 read-back한다.
 *   RECOVERY_SUBJECT        선택. recovery(비밀번호 재설정) 메일 제목을 이 값과 일치시키고 read-back한다.
 *   PASSWORD_UPDATE_GUARDS  'true'면 비밀번호 변경에 현재 비밀번호·24시간 재인증을 요구한다.
 *   PASSWORD_CHANGED_TEMPLATE_PATH 선택. 비밀번호 변경 알림을 켜고 본문을 파일과 일치시킨다.
 *   PASSWORD_CHANGED_SUBJECT 위 경로를 줄 때 필수. 알림 메일 제목.
 *   CONFIRMATION_TEMPLATE_PATH 선택. 가입 확인 메일(코드 + 확인 링크, 1014-004) 본문을 파일과 일치시키고 read-back한다.
 *   CONFIRMATION_SUBJECT     위 경로를 줄 때 필수. 가입 확인 메일 제목.
 *   TURNSTILE_SECRET_KEY·TURNSTILE_SITE_KEY 선택, 둘 다 있거나 둘 다 없어야 한다(하나만 있으면 실패). 있으면 Auth CAPTCHA를
 *                          Cloudflare Turnstile로 켜고 비밀 키를 PATCH한다. 비밀 키는 읽을 수 없어 매번 PATCH한다. 없으면 건드리지 않는다.
 *                          사이트 키는 앱(Vercel)의 NEXT_PUBLIC_TURNSTILE_SITE_KEY와 같은 값이다(공개 값) — 짝이 맞는지 보려고 받는다.
 *                          앱 배포 전에 켜면 모든 로그인이 막히므로 파이프라인은 deploy-vercel의 배포·사이트 키 대조(scripts/verify-turnstile-site-key.mjs) 뒤에만 넘긴다.
 */

import { readFile } from 'node:fs/promises';
import { supportsSignupCodeLength } from '../lib/auth/signup-code.mjs';

const API_ROOT = 'https://api.supabase.com/v1/projects';

/** Supabase는 allow-list를 콤마 문자열로 돌려준다. */
export function parseAllowList(raw) {
  if (!raw) return [];
  return String(raw)
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

export function parseLines(raw) {
  if (!raw) return [];
  return String(raw)
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

/*
 * 더하기만 하면 폐기된 redirect가 영구히 남는다 — Supabase 설정은 한 번 들어간 값을
 * 스스로 지우지 않는다. prune은 **정확히 일치**할 때만 제거한다. 패턴 매칭으로 지우면
 * 손으로 추가한 정당한 항목까지 날아간다.
 */
export function resolveRedirectAllowList({ current, required = [], prune = [] }) {
  const overlap = required.filter((url) => prune.includes(url));
  if (overlap.length > 0) {
    throw new Error(`redirect URL is both required and pruned: ${overlap.join(', ')}`);
  }

  const existing = parseAllowList(current);
  const pruneSet = new Set(prune);
  const kept = existing.filter((url) => !pruneSet.has(url));
  const removed = existing.filter((url) => pruneSet.has(url));

  const next = [...kept];
  const added = [];
  for (const url of required) {
    if (next.includes(url)) continue;
    next.push(url);
    added.push(url);
  }

  return {
    list: next.join(','),
    added,
    removed,
    changed: added.length > 0 || removed.length > 0,
  };
}

/** custom SMTP 없이는 확인·재설정 메일이 나가지 않는다. */
export function missingSmtpSettings(config) {
  const missing = [];
  if (config.external_email_enabled !== true) missing.push('external_email_enabled');
  for (const field of ['smtp_host', 'smtp_port', 'smtp_user', 'smtp_admin_email']) {
    if (!config[field]) missing.push(field);
  }
  return missing;
}

/*
 * 운영 Auth가 한 시간에 보낼 수 있는 메일(가입 확인·재설정·변경 알림) 수. 프로젝트 전체가 나눠 쓴다.
 * 배포 파이프라인이 이 값으로 강제하고 검증한다 — 값을 바꿀 곳은 여기 한 곳이다.
 * 앱 서버의 IP 시도 한도(supabase/migrations/20261119106000_auth_mail_abuse_limits.sql, IP당 시간 15)는 이 값의 5%라
 * 접속 IP 하나가 한도를 독점하지 못한다. 이 값을 올리거나 내리면 런북(docs/runbooks/signup-contact-channels.md 봇 차단 절)과 같이 본다.
 */
export const AUTH_EMAIL_RATE_LIMIT_PER_HOUR = 300;

/*
 * Auth CAPTCHA(Turnstile). GoTrue는 /signup·/recover·/resend·/magiclink·/otp·/token(password·web3)·/sso·패스키 options에서
 * 토큰을 요구한다(supabase/auth internal/api/api.go의 verifyCaptcha; /token의 pkce·refresh_token·id_token은 면제).
 * 켜면 공개 publishable 키로 이 엔드포인트를 직접 부르는 우회도 막힌다 — 앱 서버 한도는 그 우회를 못 막는다.
 */
export function captchaPatch({ captcha }) {
  if (captcha === null) return {};
  return {
    security_captcha_enabled: true,
    security_captcha_provider: 'turnstile',
    security_captcha_secret: captcha.secret,
  };
}

export function mailerPatch({ enforceMailer }) {
  if (!enforceMailer) return {};
  return {
    mailer_autoconfirm: false,
    mailer_secure_email_change_enabled: true,
    rate_limit_email_sent: AUTH_EMAIL_RATE_LIMIT_PER_HOUR,
  };
}

function normalizedTemplate(value) {
  return typeof value === 'string' ? value.trim() : '';
}

export function isSafeRecoveryTemplate(value) {
  const normalized = normalizedTemplate(value);
  if (/<!--|-->|<(?:script|style|template|textarea)\b/i.test(normalized)) return false;

  const recoveryAnchor = /<a\s+href\s*=\s*(["']){{\s*\.RedirectTo\s*}}\?token_hash={{\s*\.TokenHash\s*}}(?:&amp;|&)type=recovery\1\s*>/g;
  const matches = [...normalized.matchAll(recoveryAnchor)];
  if (matches.length !== 1) return false;

  const remaining = normalized.replace(recoveryAnchor, '<a>');
  return !/{{[\s\S]*?}}/.test(remaining);
}

/*
 * GoTrue는 recovery·magic link 세션(AMR otp)에는 현재 비밀번호를 요구하지 않고, 재인증은 세션 생성
 * 24시간 뒤부터만 요구한다. 재설정 메일 흐름은 그대로 두고, access token만 쥔 직접 호출
 * PUT /auth/v1/user를 막는다 — 실측과 남은 빈틈은 docs/runbooks/supabase-auth-password-update-guards.md.
 */
export function passwordGuardPatch({ enforcePasswordGuards }) {
  if (!enforcePasswordGuards) return {};
  return {
    security_update_password_require_current_password: true,
    security_update_password_require_reauthentication: true,
  };
}

/* 알림 메일은 링크 하나로 재설정 화면만 가리킨다. 토큰·리디렉트 값은 이 메일에 존재하지 않는다. */
export function isSafePasswordChangedTemplate(value) {
  const normalized = normalizedTemplate(value);
  if (/<!--|-->|<(?:script|style|template|textarea|img|form)\b/i.test(normalized)) return false;

  const resetAnchor = /<a\s+href\s*=\s*(["']){{\s*\.SiteURL\s*}}\/login\?mode=reset\1\s*>/g;
  if ([...normalized.matchAll(resetAnchor)].length !== 1) return false;

  const remaining = normalized.replace(resetAnchor, '<a>').replace(/{{\s*\.Email\s*}}/g, '');
  return !/{{[\s\S]*?}}/.test(remaining) && !/\bhref\s*=/i.test(remaining);
}

/*
 * 가입 확인 메일(1014-004): 가입 화면에 그대로 입력할 6자리 코드({{ .Token }}) 하나와, 가입을 시작한 브라우저에서 누를
 * 확인 링크({{ .ConfirmationURL }}) 하나만 둔다. 링크는 지금 화면(링크만 안내)에서도 그대로 동작하므로 앱 배포 전에 반영해도 된다.
 */
export function isSafeConfirmationTemplate(value) {
  const normalized = normalizedTemplate(value);
  if (/<!--|-->|<(?:script|style|template|textarea|img|form)\b/i.test(normalized)) return false;

  const token = /{{\s*\.Token\s*}}/g;
  if ([...normalized.matchAll(token)].length !== 1) return false;
  const confirmAnchor = /<a\s+href\s*=\s*(["']){{\s*\.ConfirmationURL\s*}}\1\s*>/g;
  if ([...normalized.matchAll(confirmAnchor)].length !== 1) return false;

  const remaining = normalized.replace(confirmAnchor, '<a>').replace(token, '');
  return !/{{[\s\S]*?}}/.test(remaining) && !/\bhref\s*=/i.test(remaining);
}

export function isSatisfied({
  config,
  siteUrl,
  allowList,
  enforceMailer,
  recoveryTemplate = null,
  recoverySubject = null,
  emailOtpExpirySeconds = null,
  enforcePasswordGuards = false,
  passwordChanged = null,
  confirmation = null,
  captcha = null,
}) {
  if ((config.site_url ?? '') !== siteUrl) return false;
  if ((config.uri_allow_list ?? '') !== allowList) return false;
  if (
    emailOtpExpirySeconds !== null
    && Number(config.mailer_otp_exp) !== emailOtpExpirySeconds
  ) return false;
  if (
    recoveryTemplate !== null
    && normalizedTemplate(config.mailer_templates_recovery_content) !== recoveryTemplate
  ) return false;
  if (recoverySubject !== null && (config.mailer_subjects_recovery ?? '') !== recoverySubject) return false;
  if (
    enforcePasswordGuards
    && (config.security_update_password_require_current_password !== true
      || config.security_update_password_require_reauthentication !== true)
  ) return false;
  if (
    passwordChanged !== null
    && (config.mailer_notifications_password_changed_enabled !== true
      || (config.mailer_subjects_password_changed_notification ?? '') !== passwordChanged.subject
      || normalizedTemplate(config.mailer_templates_password_changed_notification_content)
        !== passwordChanged.template)
  ) return false;
  if (
    confirmation !== null
    && (!supportsSignupCodeLength(Number(config.mailer_otp_length))
      || (config.mailer_subjects_confirmation ?? '') !== confirmation.subject
      || normalizedTemplate(config.mailer_templates_confirmation_content) !== confirmation.template)
  ) return false;
  if (
    captcha !== null
    && (config.security_captcha_enabled !== true || config.security_captcha_provider !== 'turnstile')
  ) return false;
  if (!enforceMailer) return true;
  /* 갓 만든 프로젝트는 mailer_autoconfirm을 아예 돌려주지 않는다 — 빈 값은 통과시킨다. */
  const autoconfirm = config.mailer_autoconfirm;
  if (autoconfirm !== false && autoconfirm !== null && autoconfirm !== undefined) return false;
  if (config.mailer_secure_email_change_enabled !== true) return false;
  if (Number(config.rate_limit_email_sent) !== AUTH_EMAIL_RATE_LIMIT_PER_HOUR) return false;
  return true;
}

async function readConfig({ token, projectRef }) {
  const response = await fetch(`${API_ROOT}/${projectRef}/config/auth`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = body.message ?? body.error ?? 'unknown error';
    throw new Error(`Auth config read failed: HTTP ${response.status} ${message}`);
  }
  return body;
}

function requireEnv(env, name) {
  const value = env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/*
 * PATCH 뒤 read-back 사이의 대기(ms). Supabase Auth는 메일 템플릿처럼 큰 값을 바꾸면 반영이 15초를 넘길 수 있다 —
 * 2026-11-24 재설정 메일 템플릿을 처음 바꾼 운영 배포에서 옛 대기(1~5초, 합 15초)가 끝날 때까지 새 템플릿이 읽히지 않아
 * job이 실패했고, 같은 커밋을 다시 돌리자 "already up to date"로 통과했다(run 45323173698). 짧게 시작해 늘리고 합 90초에서 멈춘다.
 */
export const AUTH_READBACK_DELAYS_MS = Object.freeze([1000, 2000, 3000, 5000, 8000, 10000, 15000, 15000, 15000, 16000]);

/** 관리 중인 템플릿이 읽어 온 값과 같은지 — 실패 메시지가 어느 템플릿이 어긋났는지 말하게 한다. */
function templateState(managed, actual) {
  if (managed === null) return 'not-managed';
  return normalizedTemplate(actual) === managed ? 'ok' : 'mismatch';
}

export async function syncSupabaseAuth(env = process.env, log = console.log, { wait = sleep } = {}) {
  const token = requireEnv(env, 'SUPABASE_ACCESS_TOKEN');
  const projectRef = requireEnv(env, 'PROJECT_REF');
  const siteUrl = requireEnv(env, 'SITE_URL');
  const required = parseLines(env.REDIRECT_URLS);
  const prune = parseLines(env.PRUNE_REDIRECT_URLS);
  const requireSmtp = env.REQUIRE_SMTP === 'true';
  const enforceMailer = env.ENFORCE_MAILER === 'true';
  const emailOtpExpiryRaw = env.EMAIL_OTP_EXPIRY_SECONDS?.trim();
  const emailOtpExpirySeconds = emailOtpExpiryRaw ? Number(emailOtpExpiryRaw) : null;
  if (
    emailOtpExpirySeconds !== null
    && (!Number.isInteger(emailOtpExpirySeconds) || emailOtpExpirySeconds <= 0)
  ) {
    throw new Error('EMAIL_OTP_EXPIRY_SECONDS must be a positive integer');
  }
  const recoveryTemplatePath = env.RECOVERY_TEMPLATE_PATH?.trim();
  const recoveryTemplate = recoveryTemplatePath
    ? normalizedTemplate(await readFile(recoveryTemplatePath, 'utf8'))
    : null;
  if (recoveryTemplate !== null && !isSafeRecoveryTemplate(recoveryTemplate)) {
    throw new Error(
      'recovery email template must use one exact {{ .RedirectTo }}?token_hash={{ .TokenHash }}&type=recovery href',
    );
  }
  const recoverySubject = env.RECOVERY_SUBJECT?.trim() || null;
  const enforcePasswordGuards = env.PASSWORD_UPDATE_GUARDS === 'true';
  const passwordChangedTemplatePath = env.PASSWORD_CHANGED_TEMPLATE_PATH?.trim();
  const passwordChangedSubject = env.PASSWORD_CHANGED_SUBJECT?.trim();
  if (passwordChangedTemplatePath && !passwordChangedSubject) {
    throw new Error('PASSWORD_CHANGED_SUBJECT is required with PASSWORD_CHANGED_TEMPLATE_PATH');
  }
  const passwordChanged = passwordChangedTemplatePath
    ? {
      subject: passwordChangedSubject,
      template: normalizedTemplate(await readFile(passwordChangedTemplatePath, 'utf8')),
    }
    : null;
  if (passwordChanged !== null && !isSafePasswordChangedTemplate(passwordChanged.template)) {
    throw new Error(
      'password changed email template must link only {{ .SiteURL }}/login?mode=reset once and use no other variables than {{ .Email }}',
    );
  }
  const confirmationTemplatePath = env.CONFIRMATION_TEMPLATE_PATH?.trim();
  const confirmationSubject = env.CONFIRMATION_SUBJECT?.trim();
  if (confirmationTemplatePath && !confirmationSubject) {
    throw new Error('CONFIRMATION_SUBJECT is required with CONFIRMATION_TEMPLATE_PATH');
  }
  const confirmation = confirmationTemplatePath
    ? {
      subject: confirmationSubject,
      template: normalizedTemplate(await readFile(confirmationTemplatePath, 'utf8')),
    }
    : null;
  if (confirmation !== null && !isSafeConfirmationTemplate(confirmation.template)) {
    throw new Error(
      'signup confirmation email template must show {{ .Token }} once, link only {{ .ConfirmationURL }} once and use no other variables',
    );
  }

  const turnstileSecret = env.TURNSTILE_SECRET_KEY?.trim() ?? '';
  const turnstileSiteKey = env.TURNSTILE_SITE_KEY?.trim() ?? '';
  if (Boolean(turnstileSecret) !== Boolean(turnstileSiteKey)) {
    throw new Error(
      'TURNSTILE_SECRET_KEY and TURNSTILE_SITE_KEY must be set together: Auth CAPTCHA without the app widget blocks every sign-in, '
      + 'and the widget without Auth CAPTCHA protects nothing (docs/runbooks/signup-contact-channels.md)',
    );
  }
  const captcha = turnstileSecret ? { secret: turnstileSecret } : null;

  const config = await readConfig({ token, projectRef });
  // 발급 길이는 비밀번호 복구와 공유한다. 가입 UI와의 호환성만 검사한다.
  if (confirmation && !supportsSignupCodeLength(Number(config.mailer_otp_length))) {
    throw new Error('Unsupported signup email OTP length. Expected mailer_otp_length between 6 and 10.');
  }

  if (requireSmtp) {
    const missing = missingSmtpSettings(config);
    if (missing.length > 0) {
      throw new Error(
        `custom SMTP is required but missing or disabled: ${missing.join(', ')}. `
        + 'Configure Auth SMTP before deploying. Do not commit SMTP credentials.',
      );
    }
  }

  const allow = resolveRedirectAllowList({ current: config.uri_allow_list, required, prune });
  if (allow.added.length > 0) log(`adding redirect URLs: ${allow.added.join(', ')}`);
  if (allow.removed.length > 0) log(`removing redirect URLs: ${allow.removed.join(', ')}`);

  const desired = {
    siteUrl,
    allowList: allow.list,
    enforceMailer,
    recoveryTemplate,
    recoverySubject,
    emailOtpExpirySeconds,
    enforcePasswordGuards,
    passwordChanged,
    confirmation,
    captcha,
  };
  /* 비밀 키는 읽어 볼 수 없다 — 키가 있으면 교체(회전)를 놓치지 않도록 매번 PATCH한다. */
  if (captcha === null && isSatisfied({ config, ...desired })) {
    log(`Supabase Auth configuration for ${projectRef} is already up to date.`);
    return { patched: false };
  }

  const patch = {
    site_url: siteUrl,
    uri_allow_list: allow.list,
    ...mailerPatch({ enforceMailer }),
    ...captchaPatch({ captcha }),
    ...(emailOtpExpirySeconds === null ? {} : { mailer_otp_exp: emailOtpExpirySeconds }),
    ...(recoveryTemplate === null ? {} : { mailer_templates_recovery_content: recoveryTemplate }),
    ...(recoverySubject === null ? {} : { mailer_subjects_recovery: recoverySubject }),
    ...passwordGuardPatch({ enforcePasswordGuards }),
    ...(passwordChanged === null ? {} : {
      mailer_notifications_password_changed_enabled: true,
      mailer_subjects_password_changed_notification: passwordChanged.subject,
      mailer_templates_password_changed_notification_content: passwordChanged.template,
    }),
    ...(confirmation === null ? {} : {
      mailer_subjects_confirmation: confirmation.subject,
      mailer_templates_confirmation_content: confirmation.template,
    }),
  };
  const response = await fetch(`${API_ROOT}/${projectRef}/config/auth`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    const message = body.message ?? body.error ?? 'unknown error';
    throw new Error(`Auth config update failed: HTTP ${response.status} ${message}`);
  }

  /* PATCH가 200이어도 반영은 곧바로 읽히지 않는다 — 확인까지 해야 동기화라고 말할 수 있다. */
  for (const delay of AUTH_READBACK_DELAYS_MS) {
    const verified = await readConfig({ token, projectRef });
    if (isSatisfied({ config: verified, ...desired })) {
      log(`Supabase Auth configuration for ${projectRef} updated.`);
      return { patched: true };
    }
    log(`Supabase Auth configuration for ${projectRef} not reflected yet; checking again in ${delay / 1000}s.`);
    await wait(delay);
  }

  const final = await readConfig({ token, projectRef });
  throw new Error(
    'Auth config verification failed: '
    + `site_url=${final.site_url}, uri_allow_list=${final.uri_allow_list}, `
    + `mailer_autoconfirm=${final.mailer_autoconfirm}, `
    + `mailer_secure_email_change_enabled=${final.mailer_secure_email_change_enabled}, `
    + `rate_limit_email_sent=${final.rate_limit_email_sent}, `
    + `mailer_otp_exp=${final.mailer_otp_exp}, `
    + `mailer_otp_length=${final.mailer_otp_length}, `
    + `recovery_template=${templateState(recoveryTemplate, final.mailer_templates_recovery_content)}, `
    + `recovery_subject=${recoverySubject === null ? 'not-managed' : final.mailer_subjects_recovery}, `
    + `security_update_password_require_current_password=${final.security_update_password_require_current_password}, `
    + `security_update_password_require_reauthentication=${final.security_update_password_require_reauthentication}, `
    + `mailer_notifications_password_changed_enabled=${final.mailer_notifications_password_changed_enabled}, `
    + `password_changed_template=${templateState(passwordChanged?.template ?? null, final.mailer_templates_password_changed_notification_content)}, `
    + `confirmation_template=${templateState(confirmation?.template ?? null, final.mailer_templates_confirmation_content)}, `
    + `security_captcha=${captcha === null ? 'not-managed' : `${final.security_captcha_enabled}/${final.security_captcha_provider}`}`,
  );
}

/* 직접 실행할 때만 동작한다 — 테스트가 import해도 네트워크를 타지 않는다. */
if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  syncSupabaseAuth().catch((error) => {
    console.error(`::error title=Supabase Auth sync failed::${error.message}`);
    process.exit(1);
  });
}
