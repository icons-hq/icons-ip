import { readFile } from 'node:fs/promises';

import yaml from 'js-yaml';
import { describe, expect, it } from 'vitest';

import { checkTurnstileSiteKey, fingerprint, readDotenvValue } from './verify-turnstile-site-key.mjs';

const workflow = yaml.load(await readFile(new URL('../.github/workflows/pipeline.yml', import.meta.url), 'utf8'));

function stepIndex(job, name) {
  return workflow.jobs[job].steps.findIndex((step) => step.name === name);
}

describe('Auth CAPTCHA(Turnstile)는 앱 배포 뒤에만 켠다', () => {
  it('migration·DB 단계의 Auth 동기화(deploy-supabase)에는 CAPTCHA 키를 넘기지 않는다', () => {
    for (const step of workflow.jobs['deploy-supabase'].steps) {
      expect(Object.keys(step.env ?? {}).filter((name) => /TURNSTILE/.test(name))).toEqual([]);
    }
  });

  it('preview·staging 동기화는 CAPTCHA를 켜지 않는다', () => {
    for (const job of ['deploy-supabase-preview', 'deploy-vercel-preview', 'sync-supabase-preview-main', 'deploy-staging']) {
      for (const step of workflow.jobs[job].steps) {
        expect(Object.keys(step.env ?? {}).filter((name) => /TURNSTILE/.test(name))).toEqual([]);
      }
    }
  });

  it('deploy-vercel에서 Vercel 배포 → 사이트 키 대조 → CAPTCHA 켜기 순서이고 push/main에서만 돈다', () => {
    const deploy = stepIndex('deploy-vercel', 'Deploy Vercel production');
    const verify = stepIndex('deploy-vercel', 'Verify Turnstile site key matches the deployed app');
    const activate = stepIndex('deploy-vercel', 'Activate recovery token-hash template in production');
    expect(deploy).toBeGreaterThan(-1);
    expect(verify).toBeGreaterThan(deploy);
    expect(activate).toBeGreaterThan(verify);

    const steps = workflow.jobs['deploy-vercel'].steps;
    // 대조는 키를 관리할 때(변수가 있을 때)만 운영 env를 내려받는다. 켜기 단계는 스크립트가 두 값이 다 있을 때만 CAPTCHA를 건드린다.
    expect(steps[verify].if).toBe("github.event_name == 'push' && github.ref == 'refs/heads/main' && vars.NEXT_PUBLIC_TURNSTILE_SITE_KEY != ''");
    expect(steps[verify].run).toContain("trap 'rm -f \"$env_file\"' EXIT");
    expect(steps[activate].if).toBe("github.event_name == 'push' && github.ref == 'refs/heads/main'");
    expect(steps[activate].env).toMatchObject({
      TURNSTILE_SECRET_KEY: '${{ secrets.TURNSTILE_SECRET_KEY }}',
      TURNSTILE_SITE_KEY: '${{ vars.NEXT_PUBLIC_TURNSTILE_SITE_KEY }}',
    });
  });

  it('대조 단계는 값을 로그에 찍지 않고 Vercel production env를 당겨 와 같은 변수와 비교한다', () => {
    const step = workflow.jobs['deploy-vercel'].steps[stepIndex('deploy-vercel', 'Verify Turnstile site key matches the deployed app')];
    expect(step.env).toEqual({ EXPECTED_TURNSTILE_SITE_KEY: '${{ vars.NEXT_PUBLIC_TURNSTILE_SITE_KEY }}' });
    expect(step.run).toContain('vercel env pull');
    expect(step.run).toContain('--environment=production');
    expect(step.run).toContain('node scripts/verify-turnstile-site-key.mjs');
    expect(step.run).not.toMatch(/\becho\b|\bcat\b/);
  });
});

describe('checkTurnstileSiteKey', () => {
  it('GitHub 변수가 없으면 키를 관리하지 않는 것이라 통과한다', () => {
    expect(checkTurnstileSiteKey({ expected: '', actual: 'whatever' })).toEqual({ ok: true, managed: false });
    expect(checkTurnstileSiteKey({ expected: undefined, actual: '' })).toEqual({ ok: true, managed: false });
  });

  it('같으면 통과하고 값 대신 해시 앞 8자만 돌려준다', () => {
    const result = checkTurnstileSiteKey({ expected: '0x4AAA-site', actual: '0x4AAA-site' });
    expect(result).toEqual({ ok: true, managed: true, fingerprint: fingerprint('0x4AAA-site') });
    expect(result.fingerprint).toMatch(/^[0-9a-f]{8}$/);
  });

  it('Vercel에 없거나 다르면 실패하고 사유에 키 값이 들어가지 않는다', () => {
    const missing = checkTurnstileSiteKey({ expected: '0x4AAA-new', actual: '' });
    const different = checkTurnstileSiteKey({ expected: '0x4AAA-new', actual: '0x4AAA-old' });
    for (const result of [missing, different]) {
      expect(result.ok).toBe(false);
      expect(result.reason).not.toContain('0x4AAA');
    }
  });
});

describe('readDotenvValue', () => {
  it('vercel env pull 형식의 따옴표 값을 읽고 없으면 빈 문자열이다', () => {
    const source = 'FOO="bar"\nNEXT_PUBLIC_TURNSTILE_SITE_KEY="0x4AAA-site"\n# comment\n';
    expect(readDotenvValue(source, 'NEXT_PUBLIC_TURNSTILE_SITE_KEY')).toBe('0x4AAA-site');
    expect(readDotenvValue('A=1\nNEXT_PUBLIC_TURNSTILE_SITE_KEY=plain', 'NEXT_PUBLIC_TURNSTILE_SITE_KEY')).toBe('plain');
    expect(readDotenvValue(source, 'MISSING')).toBe('');
    expect(readDotenvValue('NEXT_PUBLIC_TURNSTILE_SITE_KEY_OTHER="x"', 'NEXT_PUBLIC_TURNSTILE_SITE_KEY')).toBe('');
  });
});
