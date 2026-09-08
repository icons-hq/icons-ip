import { describe, expect, it } from 'vitest';

import {
  assertStagingBranch,
  stagingDeploymentEnvironment,
  stagingCredentials,
  prepareStagingBranch,
} from './staging-environment.mjs';

const previewRef = 'abcdefghijklmnopqrst';
const productionRef = 'bcdefghijklmnopqrstu';
const stagingRef = 'cdefghijklmnopqrstuv';
const branch = {
  name: 'staging', is_default: false, persistent: true, with_data: false,
  project_ref: stagingRef, parent_project_ref: previewRef,
  preview_project_status: 'ACTIVE_HEALTHY',
};
const credentials = {
  SUPABASE_URL: `https://${stagingRef}.supabase.co`,
  SUPABASE_PUBLISHABLE_KEY: 'test-publishable',
  SUPABASE_SERVICE_ROLE_KEY: 'test-service',
  POSTGRES_URL: `postgresql://postgres.${stagingRef}:test@pooler.supabase.com/postgres`,
};

describe('persistent staging isolation', () => {
  it('accepts only the no-data persistent child of the preview project', () => {
    expect(assertStagingBranch(branch, { previewRef, productionRef })).toBe(stagingRef);
    for (const change of [
      { name: 'main' }, { is_default: true }, { persistent: false },
      { with_data: true }, { parent_project_ref: productionRef },
      { project_ref: productionRef }, { project_ref: previewRef },
      { preview_project_status: 'INACTIVE' },
    ]) {
      expect(() => assertStagingBranch({ ...branch, ...change }, { previewRef, productionRef })).toThrow();
    }
    expect(() => assertStagingBranch(branch, { previewRef, productionRef: previewRef })).toThrow();
  });

  it('binds credentials to the selected project and rejects env-file injection', () => {
    expect(stagingCredentials(credentials, stagingRef).PROJECT_REF).toBe(stagingRef);
    for (const change of [
      { SUPABASE_URL: `https://${productionRef}.supabase.co` },
      { POSTGRES_URL: `postgresql://postgres.${productionRef}:test@pooler.supabase.com/postgres` },
      { SUPABASE_SERVICE_ROLE_KEY: 'secret\nPROJECT_REF=wrong' },
      { SUPABASE_SERVICE_ROLE_KEY: '' },
    ]) expect(() => stagingCredentials({ ...credentials, ...change }, stagingRef)).toThrow();
  });

  it('reuses a persistent branch without delete, reset, seed or account rotation', async () => {
    const calls = [];
    const invoke = (args) => {
      calls.push(args);
      return JSON.stringify(args[1] === 'list' ? [branch] : credentials);
    };
    const result = await prepareStagingBranch({ previewRef, productionRef, invoke });
    expect(result.PROJECT_REF).toBe(stagingRef);
    expect(calls.map((call) => call.slice(0, 2))).toEqual([['branches', 'list'], ['branches', 'get']]);
  });

  it('creates missing staging once without data and waits for actual health', async () => {
    const calls = [];
    let lists = 0;
    const invoke = (args) => {
      calls.push(args);
      if (args[1] === 'list') return JSON.stringify(++lists === 1 ? [] : [branch]);
      return JSON.stringify(args[1] === 'get' ? credentials : {});
    };
    await prepareStagingBranch({ previewRef, productionRef, invoke, sleep: async () => {} });
    const create = calls.find((call) => call[1] === 'create');
    expect(create).toContain('--persistent');
    expect(create).not.toContain('--with-data');
    expect(calls.some((call) => call.includes('delete'))).toBe(false);
  });

  it('pins alias, both Supabase scopes and closed payment gates; rejects live test keys', () => {
    const input = {
      ...stagingCredentials(credentials, stagingRef),
      SUPABASE_PREVIEW_PROJECT_ID: previewRef,
      SUPABASE_PRODUCTION_PROJECT_ID: productionRef,
      STAGING_ALIAS: 'icons-ip-staging.vercel.app',
      STAGING_TOSS_CLIENT_KEY: 'test_gck_staging00000001',
      STAGING_TOSS_SECRET_KEY: 'test_gsk_staging00000001',
    };
    const env = stagingDeploymentEnvironment(input);
    expect(env.SITE_URL).toBe('https://icons-ip-staging.vercel.app');
    expect(env.NEXT_PUBLIC_SUPABASE_URL).toBe(credentials.SUPABASE_URL);
    expect(env.KORPAY_ORDER_CHECKOUT_ENABLED).toBe('false');
    expect(env.TOSS_ORDER_CHECKOUT_ENABLED).toBe('false');
    expect(env.KORPAY_KEY).toBe('');
    expect(env.RESEND_API_KEY).toBe('');
    expect(() => stagingDeploymentEnvironment({ ...input, STAGING_TOSS_SECRET_KEY: 'live_gsk_staging00000001' })).toThrow();
    expect(() => stagingDeploymentEnvironment({ ...input, STAGING_ALIAS: 'icons-ip.vercel.app' })).toThrow();
    expect(() => stagingDeploymentEnvironment({ ...input, PROJECT_REF: productionRef })).toThrow();
  });
});
