import { readFile } from 'node:fs/promises';
import yaml from 'js-yaml';
import { describe, expect, it } from 'vitest';
import { stagingDeployArgs } from './deploy-staging.mjs';

const pipeline = yaml.load(await readFile(new URL('../.github/workflows/pipeline.yml', import.meta.url), 'utf8'));
const job = pipeline.jobs['deploy-staging'];
const steps = job.steps;

describe('staging release and preservation contract', () => {
  it('runs only after successful current-main preview synchronization', () => {
    expect(job.needs).toBe('sync-supabase-preview-main');
    expect(job.if).toBe("github.event_name == 'push' && github.ref == 'refs/heads/main'");
    const preflight = steps.find((step) => step.name === 'Check staging configuration and current main');
    expect(preflight.run).toContain('"$GITHUB_SHA" != "$(git rev-parse origin/main)"');
    expect(steps.indexOf(preflight)).toBeLessThan(steps.findIndex((step) => step.run === 'node scripts/staging-environment.mjs'));
  });

  it('preserves rehearsal data and operator passwords across app deployments', () => {
    const commands = steps.map(({ run }) => run || '').join('\n');
    expect(commands).toContain('db push --db-url "$POSTGRES_URL" --include-roles --yes');
    expect(commands).toContain('supabase/seeds/admin-ops-staging.sql');
    for (const prohibited of ['db reset', '--include-seed', '--with-data', 'staging-accounts.mjs', 'branches delete', '--prod']) {
      expect(commands).not.toContain(prohibited);
    }
  });

  it('completes database, functions and Auth URL changes before app and template activation', () => {
    const names = steps.map(({ name }) => name);
    const deploy = names.indexOf('Deploy and alias staging Preview');
    for (const name of ['Apply staging migrations without resetting rehearsal data',
      'Reconcile staging Supabase Edge Functions', 'Sync staging Auth URLs']) {
      expect(names.indexOf(name)).toBeLessThan(deploy);
    }
    expect(names.indexOf('Activate staging recovery template')).toBeGreaterThan(deploy);
  });

  it('passes the same selected credentials to build and runtime without a production target', () => {
    const ref = 'cdefghijklmnopqrstuv';
    const args = stagingDeployArgs({
      PROJECT_REF: ref,
      SUPABASE_PREVIEW_PROJECT_ID: 'abcdefghijklmnopqrst',
      SUPABASE_PRODUCTION_PROJECT_ID: 'bcdefghijklmnopqrstu',
      SUPABASE_URL: `https://${ref}.supabase.co`,
      SUPABASE_PUBLISHABLE_KEY: 'test-public', SUPABASE_SERVICE_ROLE_KEY: 'test-private',
      POSTGRES_URL: `postgres://postgres.${ref}:test@pooler.supabase.com/postgres`,
      STAGING_TOSS_CLIENT_KEY: 'test_gck_staging00000001', STAGING_TOSS_SECRET_KEY: 'test_gsk_staging00000001',
    });
    const build = args.flatMap((value, index) => value === '--build-env' ? [args[index + 1]] : []);
    const runtime = args.flatMap((value, index) => value === '--env' ? [args[index + 1]] : []);
    expect(build).toEqual(runtime);
    expect(args).not.toContain('--prod');
    expect(build).not.toContain(expect.stringMatching(/^POSTGRES_URL=/));
    expect(build).toContain('KORPAY_ORDER_CHECKOUT_ENABLED=false');
    expect(build).toContain('TOSS_ORDER_CHECKOUT_ENABLED=false');
  });
});
