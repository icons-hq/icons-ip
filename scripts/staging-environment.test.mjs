import { describe, expect, it } from 'vitest';

import {
  assertStagingBranch,
  stagingDeploymentEnvironment,
  stagingCredentials,
  prepareStagingBranch,
  selectBranchApiKeys,
  loadStagingCredentials,
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
  SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_staging_test',
  SUPABASE_SERVICE_ROLE_KEY: 'sb_secret_staging_test',
  POSTGRES_URL: `postgresql://postgres.${stagingRef}:test@pooler.supabase.com/postgres`,
};
const legacyJwt = 'eyJhbGciOiJIUzI1NiJ9.legacy.signature';
// `supabase branches get` 실측 형태: legacy JWT가 그대로 오고 secret 키는 마스킹된다.
const branchGet = {
  SUPABASE_URL: credentials.SUPABASE_URL,
  POSTGRES_URL: credentials.POSTGRES_URL,
  SUPABASE_ANON_KEY: legacyJwt,
  SUPABASE_SERVICE_ROLE_KEY: legacyJwt,
  SUPABASE_PUBLISHABLE_KEY: credentials.SUPABASE_PUBLISHABLE_KEY,
  SUPABASE_DEFAULT_KEY: 'sb_secret_stagi\u00b7\u00b7\u00b7\u00b7\u00b7\u00b7',
};
const revealedKeys = [
  { name: 'anon', type: 'legacy', api_key: legacyJwt },
  { name: 'service_role', type: 'legacy', api_key: legacyJwt },
  { name: 'default', type: 'publishable', api_key: credentials.SUPABASE_PUBLISHABLE_KEY },
  { name: 'default', type: 'secret', api_key: credentials.SUPABASE_SERVICE_ROLE_KEY },
];
function supabaseCli({ lists = () => [branch], keys = revealedKeys, calls = [] } = {}) {
  return (args) => {
    calls.push(args);
    if (args[0] === 'projects' && args[1] === 'api-keys') return JSON.stringify(keys);
    if (args[1] === 'list') return JSON.stringify(lists());
    return JSON.stringify(args[1] === 'get' ? branchGet : {});
  };
}

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
      { SUPABASE_SERVICE_ROLE_KEY: legacyJwt },
      { SUPABASE_SERVICE_ROLE_KEY: branchGet.SUPABASE_DEFAULT_KEY },
      { SUPABASE_PUBLISHABLE_KEY: legacyJwt },
      { SUPABASE_PUBLISHABLE_KEY: undefined, SUPABASE_ANON_KEY: legacyJwt },
    ]) expect(() => stagingCredentials({ ...credentials, ...change }, stagingRef)).toThrow();
  });

  it('selects only the enabled default publishable and secret keys', () => {
    expect(selectBranchApiKeys(revealedKeys)).toEqual({
      SUPABASE_PUBLISHABLE_KEY: credentials.SUPABASE_PUBLISHABLE_KEY,
      SUPABASE_SERVICE_ROLE_KEY: credentials.SUPABASE_SERVICE_ROLE_KEY,
    });
    expect(selectBranchApiKeys([
      ...revealedKeys.slice(0, 2),
      { name: 'default', type: 'secret', api_key: 'sb_secret_disabled', disabled: true },
      { name: 'ci', type: 'secret', api_key: 'sb_secret_other_component' },
    ])).toEqual({ SUPABASE_PUBLISHABLE_KEY: undefined, SUPABASE_SERVICE_ROLE_KEY: undefined });
    expect(() => selectBranchApiKeys({})).toThrow('Invalid Supabase API key list');
  });

  it('reads revealed new keys for the staging ref and never falls back to branch legacy keys', () => {
    const calls = [];
    const result = loadStagingCredentials({
      previewRef, projectRef: stagingRef, invoke: supabaseCli({ calls }),
    });
    expect(result.SUPABASE_SERVICE_ROLE_KEY).toBe(credentials.SUPABASE_SERVICE_ROLE_KEY);
    expect(result.SUPABASE_PUBLISHABLE_KEY).toBe(credentials.SUPABASE_PUBLISHABLE_KEY);
    expect(calls).toContainEqual(['projects', 'api-keys', '--project-ref', stagingRef, '--reveal', '--output', 'json']);
    for (const [keys, message] of [
      [revealedKeys.slice(0, 2), 'Missing or unsafe staging credential: SUPABASE_PUBLISHABLE_KEY'],
      [[...revealedKeys.slice(0, 3), { name: 'default', type: 'secret', api_key: branchGet.SUPABASE_DEFAULT_KEY }],
        'not legacy JWT or masked keys'],
    ]) {
      expect(() => loadStagingCredentials({
        previewRef, projectRef: stagingRef, invoke: supabaseCli({ keys }),
      })).toThrow(message);
    }
  });

  it('reuses a persistent branch without delete, reset, seed or account rotation', async () => {
    const calls = [];
    const invoke = supabaseCli({ calls });
    const result = await prepareStagingBranch({ previewRef, productionRef, invoke });
    expect(result.PROJECT_REF).toBe(stagingRef);
    expect(result.SUPABASE_SERVICE_ROLE_KEY).toBe(credentials.SUPABASE_SERVICE_ROLE_KEY);
    expect(calls.map((call) => call.slice(0, 2))).toEqual([
      ['branches', 'list'], ['branches', 'get'], ['projects', 'api-keys'],
    ]);
  });

  it('creates missing staging once without data and waits for actual health', async () => {
    const calls = [];
    let lists = 0;
    const invoke = supabaseCli({ calls, lists: () => (++lists === 1 ? [] : [branch]) });
    await prepareStagingBranch({ previewRef, productionRef, invoke, sleep: async () => {} });
    const create = calls.find((call) => call[1] === 'create');
    expect(create).toContain('--persistent');
    expect(create).not.toContain('--with-data');
    expect(calls.some((call) => call.includes('delete'))).toBe(false);
  });

  it('pins alias, both Supabase scopes and closed payment gates while inheriting remote Toss credentials', () => {
    const input = {
      ...stagingCredentials(credentials, stagingRef),
      SUPABASE_PREVIEW_PROJECT_ID: previewRef,
      SUPABASE_PRODUCTION_PROJECT_ID: productionRef,
      STAGING_ALIAS: 'icons-ip-staging.vercel.app',
    };
    const env = stagingDeploymentEnvironment(input);
    expect(env.SITE_URL).toBe('https://icons-ip-staging.vercel.app');
    expect(env.NEXT_PUBLIC_SUPABASE_URL).toBe(credentials.SUPABASE_URL);
    expect(env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY).toBe(credentials.SUPABASE_PUBLISHABLE_KEY);
    expect(env.SUPABASE_SERVICE_ROLE_KEY).toBe(credentials.SUPABASE_SERVICE_ROLE_KEY);
    expect(env).not.toHaveProperty('NEXT_PUBLIC_SUPABASE_ANON_KEY');
    expect(env.KORPAY_ORDER_CHECKOUT_ENABLED).toBe('false');
    expect(env.TOSS_ORDER_CHECKOUT_ENABLED).toBe('false');
    expect(env.KORPAY_KEY).toBe('');
    expect(env.RESEND_API_KEY).toBe('');
    expect(env).not.toHaveProperty('NEXT_PUBLIC_TOSS_CLIENT_KEY');
    expect(env).not.toHaveProperty('TOSS_SECRET_KEY');
    expect(() => stagingDeploymentEnvironment({ ...input, STAGING_ALIAS: 'icons-ip.vercel.app' })).toThrow();
    expect(() => stagingDeploymentEnvironment({ ...input, PROJECT_REF: productionRef })).toThrow();
  });
});
