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
 */

import { readFile } from 'node:fs/promises';

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

export function mailerPatch({ enforceMailer }) {
  if (!enforceMailer) return {};
  return {
    mailer_autoconfirm: false,
    mailer_secure_email_change_enabled: true,
    rate_limit_email_sent: 30,
  };
}

function normalizedTemplate(value) {
  return typeof value === 'string' ? value.trim() : '';
}

export function isSafeRecoveryTemplate(value) {
  return /{{\s*\.ConfirmationURL\s*}}/.test(normalizedTemplate(value));
}

export function isSatisfied({
  config,
  siteUrl,
  allowList,
  enforceMailer,
  recoveryTemplate = null,
  emailOtpExpirySeconds = null,
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
  if (!enforceMailer) return true;
  /* 갓 만든 프로젝트는 mailer_autoconfirm을 아예 돌려주지 않는다 — 빈 값은 통과시킨다. */
  const autoconfirm = config.mailer_autoconfirm;
  if (autoconfirm !== false && autoconfirm !== null && autoconfirm !== undefined) return false;
  if (config.mailer_secure_email_change_enabled !== true) return false;
  if (Number(config.rate_limit_email_sent) !== 30) return false;
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

export async function syncSupabaseAuth(env = process.env, log = console.log) {
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
    throw new Error('recovery email template must contain {{ .ConfirmationURL }}');
  }

  const config = await readConfig({ token, projectRef });

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

  if (isSatisfied({
    config,
    siteUrl,
    allowList: allow.list,
    enforceMailer,
    recoveryTemplate,
    emailOtpExpirySeconds,
  })) {
    log(`Supabase Auth configuration for ${projectRef} is already up to date.`);
    return { patched: false };
  }

  const patch = {
    site_url: siteUrl,
    uri_allow_list: allow.list,
    ...mailerPatch({ enforceMailer }),
    ...(emailOtpExpirySeconds === null ? {} : { mailer_otp_exp: emailOtpExpirySeconds }),
    ...(recoveryTemplate === null ? {} : { mailer_templates_recovery_content: recoveryTemplate }),
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
  for (let attempt = 1; attempt <= 5; attempt += 1) {
    const verified = await readConfig({ token, projectRef });
    if (isSatisfied({
      config: verified,
      siteUrl,
      allowList: allow.list,
      enforceMailer,
      recoveryTemplate,
      emailOtpExpirySeconds,
    })) {
      log(`Supabase Auth configuration for ${projectRef} updated.`);
      return { patched: true };
    }
    await sleep(attempt * 1000);
  }

  const final = await readConfig({ token, projectRef });
  throw new Error(
    'Auth config verification failed: '
    + `site_url=${final.site_url}, uri_allow_list=${final.uri_allow_list}, `
    + `mailer_autoconfirm=${final.mailer_autoconfirm}, `
    + `mailer_secure_email_change_enabled=${final.mailer_secure_email_change_enabled}, `
    + `rate_limit_email_sent=${final.rate_limit_email_sent}, `
    + `mailer_otp_exp=${final.mailer_otp_exp}, `
    + `recovery_template=${recoveryTemplate === null ? 'not-managed' : 'mismatch'}`,
  );
}

/* 직접 실행할 때만 동작한다 — 테스트가 import해도 네트워크를 타지 않는다. */
if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  syncSupabaseAuth().catch((error) => {
    console.error(`::error title=Supabase Auth sync failed::${error.message}`);
    process.exit(1);
  });
}
