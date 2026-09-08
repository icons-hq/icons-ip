import { spawnSync } from 'node:child_process';
import { appendFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { pathToFileURL } from 'node:url';

import { isTossKeyPairAligned, tossKeyMode } from '../lib/payments/toss-config.mjs';

const REF = /^[a-z]{20}$/;
const ALIAS = /^icons-ip-staging(?:-[a-z0-9]+)*\.vercel\.app$/;
export const STAGING_BUILD_MARKER = 'admin-ops-v1';
const STAGING_BUILD_REF_NAMES = [
  'ICONS_STAGING_PROJECT_REF', 'ICONS_STAGING_PREVIEW_PROJECT_REF', 'ICONS_STAGING_PRODUCTION_PROJECT_REF',
];

/** Sensitive Preview values are available inside Vercel's remote build, never pulled into Actions. */
export function validateStagingBuildEnvironment(environment) {
  const stagingSite = /^https?:\/\/icons-ip-staging(?:-[a-z0-9]+)*\.vercel\.app(?:[/?#:]|$)/
    .test(environment.SITE_URL ?? '');
  if (environment.ICONS_STAGING_BUILD === undefined && !stagingSite
    && !STAGING_BUILD_REF_NAMES.some((name) => environment[name] !== undefined)) return false;
  if (environment.ICONS_STAGING_BUILD !== STAGING_BUILD_MARKER || environment.VERCEL_ENV !== 'preview') {
    throw new Error('Staging build marker requires the Vercel preview target');
  }
  const alias = environment.SITE_URL?.slice('https://'.length);
  if (!environment.SITE_URL?.startsWith('https://') || !ALIAS.test(alias ?? '')) {
    throw new Error('Staging SITE_URL must be an HTTPS staging alias origin');
  }
  const projectRef = environment.ICONS_STAGING_PROJECT_REF;
  if (!REF.test(projectRef ?? '')) throw new Error('Staging build requires the selected project ref');
  assertProjects(environment.ICONS_STAGING_PREVIEW_PROJECT_REF,
    environment.ICONS_STAGING_PRODUCTION_PROJECT_REF, projectRef);
  if (environment.NEXT_PUBLIC_SUPABASE_URL !== `https://${projectRef}.supabase.co`) {
    throw new Error('Staging build API URL must match the selected project ref');
  }
  for (const name of ['KORPAY_ORDER_CHECKOUT_ENABLED', 'KORPAY_TICKET_CHECKOUT_ENABLED',
    'TOSS_ORDER_CHECKOUT_ENABLED', 'TOSS_TICKET_CHECKOUT_ENABLED']) {
    if (environment[name] !== 'false') throw new Error(`Staging ${name} must be false`);
  }
  const clientKey = environment.NEXT_PUBLIC_TOSS_CLIENT_KEY?.trim() ?? '';
  const secretKey = environment.TOSS_SECRET_KEY?.trim() ?? '';
  if (!isTossKeyPairAligned(clientKey, secretKey) || tossKeyMode(secretKey) !== 'test') {
    throw new Error('Staging requires an inherited Toss test widget key pair');
  }
  return true;
}

function assertProjects(previewRef, productionRef, stagingRef) {
  if (!REF.test(previewRef ?? '') || !REF.test(productionRef ?? '') || previewRef === productionRef) {
    throw new Error('Staging requires distinct preview and production project refs');
  }
  if (stagingRef !== undefined && (!REF.test(stagingRef) || [previewRef, productionRef].includes(stagingRef))) {
    throw new Error('Staging must be a separate preview child project');
  }
}

export function assertStagingBranch(branch, { previewRef, productionRef }) {
  assertProjects(previewRef, productionRef, branch?.project_ref);
  if (!branch || branch.name !== 'staging' || branch.is_default !== false
    || branch.persistent !== true || branch.with_data !== false
    || branch.parent_project_ref !== previewRef
    || branch.preview_project_status !== 'ACTIVE_HEALTHY') {
    throw new Error('Expected healthy persistent no-data staging branch of preview project');
  }
  return branch.project_ref;
}

export function stagingCredentials(credentials, projectRef) {
  if (!REF.test(projectRef ?? '')) throw new Error('Invalid staging project ref');
  const result = {
    PROJECT_REF: projectRef,
    SUPABASE_URL: credentials.SUPABASE_URL,
    SUPABASE_PUBLISHABLE_KEY: credentials.SUPABASE_PUBLISHABLE_KEY || credentials.SUPABASE_ANON_KEY,
    SUPABASE_SERVICE_ROLE_KEY: credentials.SUPABASE_SERVICE_ROLE_KEY,
    POSTGRES_URL: credentials.POSTGRES_URL,
  };
  for (const [name, value] of Object.entries(result)) {
    if (typeof value !== 'string' || !value || /[\r\n]/.test(value)) {
      throw new Error(`Missing or unsafe staging credential: ${name}`);
    }
  }
  if (result.SUPABASE_URL !== `https://${projectRef}.supabase.co`) {
    throw new Error('Staging API credential does not match the selected branch');
  }
  let database;
  try { database = new URL(result.POSTGRES_URL); } catch { throw new Error('Invalid staging database URL'); }
  if (!['postgres:', 'postgresql:'].includes(database.protocol)
    || !(database.hostname === `db.${projectRef}.supabase.co`
      || (database.hostname.endsWith('.pooler.supabase.com')
        && decodeURIComponent(database.username) === `postgres.${projectRef}`))) {
    // Some CLI releases use the shorter managed pooler hostname.
    if (!(database.hostname === 'pooler.supabase.com'
      && decodeURIComponent(database.username) === `postgres.${projectRef}`
      && ['postgres:', 'postgresql:'].includes(database.protocol))) {
      throw new Error('Staging database credential does not match the selected branch');
    }
  }
  return result;
}

export function invokeSupabase(args) {
  const result = spawnSync('supabase', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  // Never echo CLI output or command arguments: branch get returns credentials.
  if (result.error || result.status !== 0) throw new Error(`Supabase ${args.slice(0, 2).join(' ')} failed`);
  return result.stdout;
}

export async function prepareStagingBranch({
  previewRef, productionRef, invoke = invokeSupabase,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
} = {}) {
  assertProjects(previewRef, productionRef);
  const list = () => {
    const branches = JSON.parse(invoke(['branches', 'list', '--project-ref', previewRef, '--output', 'json']));
    if (!Array.isArray(branches)) throw new Error('Invalid Supabase branch list');
    const matches = branches.filter((entry) => entry.name === 'staging');
    if (matches.length > 1) throw new Error('Ambiguous staging branches');
    return matches[0];
  };
  let branch = list();
  if (!branch) {
    invoke(['branches', 'create', 'staging', '--project-ref', previewRef, '--persistent',
      '--region', 'ap-northeast-2', '--size', 'micro', '--yes', '--output', 'json']);
    for (let attempt = 0; attempt < 60; attempt += 1) {
      branch = list();
      if (branch?.preview_project_status === 'ACTIVE_HEALTHY') break;
      if (/FAILED|ERROR/.test(branch?.preview_project_status ?? '')) throw new Error('Staging provisioning failed');
      await sleep(10000);
    }
  }
  const projectRef = assertStagingBranch(branch, { previewRef, productionRef });
  return stagingCredentials(JSON.parse(invoke([
    'branches', 'get', 'staging', '--project-ref', previewRef, '--output', 'json',
  ])), projectRef);
}

export function stagingDeploymentEnvironment(environment) {
  assertProjects(environment.SUPABASE_PREVIEW_PROJECT_ID,
    environment.SUPABASE_PRODUCTION_PROJECT_ID, environment.PROJECT_REF);
  const credentials = stagingCredentials(environment, environment.PROJECT_REF);
  const alias = environment.STAGING_ALIAS || 'icons-ip-staging.vercel.app';
  if (!ALIAS.test(alias)) throw new Error('STAGING_ALIAS must be an icons-ip-staging Vercel hostname');
  return {
    NEXT_PUBLIC_SUPABASE_URL: credentials.SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: credentials.SUPABASE_PUBLISHABLE_KEY,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: '',
    SUPABASE_SERVICE_ROLE_KEY: credentials.SUPABASE_SERVICE_ROLE_KEY,
    ICONS_CATALOG_SOURCE: 'supabase', SITE_URL: `https://${alias}`,
    AUTH_SIGNUP_RESEND_SECRET: environment.STAGING_AUTH_RESEND_SECRET || randomBytes(32).toString('base64url'),
    KORPAY_MID: '', KORPAY_KEY: '',
    KORPAY_ORDER_CHECKOUT_ENABLED: 'false', KORPAY_TICKET_CHECKOUT_ENABLED: 'false',
    KORPAY_ORDER_CANARY_USER_ID: '', KORPAY_TICKET_CANARY_USER_ID: '',
    TOSS_ORDER_CHECKOUT_ENABLED: 'false', TOSS_TICKET_CHECKOUT_ENABLED: 'false',
    TOSS_ORDER_CANARY_USER_ID: '', TOSS_TICKET_CANARY_USER_ID: '',
    EMAIL_PROVIDER_API_KEY: '', RESEND_API_KEY: '',
  };
}

async function main() {
  if (!process.env.GITHUB_ENV) throw new Error('Use this preparation command in the staging Actions job');
  const values = await prepareStagingBranch({
    previewRef: process.env.SUPABASE_PREVIEW_PROJECT_ID,
    productionRef: process.env.SUPABASE_PRODUCTION_PROJECT_ID,
  });
  for (const [name, value] of Object.entries(values)) {
    console.log(`::add-mask::${value}`);
    await appendFile(process.env.GITHUB_ENV, `${name}=${value}\n`);
  }
  console.log('Persistent staging target verified; credentials passed within this job only.');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => { console.error(error.message); process.exitCode = 1; });
}
