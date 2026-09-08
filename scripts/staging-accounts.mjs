import { lstat, open, readFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { isAbsolute, relative, resolve } from 'node:path';
import { createClient } from '@supabase/supabase-js';

import { assertStagingBranch, invokeSupabase, stagingCredentials } from './staging-environment.mjs';

const MARKER = 'admin-ops-v1';
export const STAGING_OPERATORS = Object.freeze([
  { email: 'ops-admin@staging.icons.test', role: 'admin', nickname: '운영연습관리자' },
  ...[1, 2, 3, 4].map((number) => ({
    email: `ops-staff${number}@staging.icons.test`, role: 'staff', nickname: `운영연습담당자${number}`,
  })),
]);

export async function ensureStagingOperators(client, passwords) {
  for (const operator of STAGING_OPERATORS) {
    if (typeof passwords[operator.email] !== 'string' || passwords[operator.email].length < 24) {
      throw new Error('Missing generated operator password');
    }
  }
  const users = [];
  for (let page = 1; page <= 100; page += 1) {
    const { data, error } = await client.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw new Error('Could not inspect staging users');
    users.push(...data.users);
    if (data.users.length < 1000) break;
    if (page === 100) throw new Error('Staging account inventory limit exceeded');
  }
  // Complete collision preflight before creating or granting any account.
  for (const operator of STAGING_OPERATORS) {
    const user = users.find((entry) => entry.email?.toLowerCase() === operator.email);
    if (user && user.app_metadata?.staging_fixture !== MARKER) {
      throw new Error('Refusing to grant privileges to an unmarked account');
    }
  }
  const result = [];
  for (const operator of STAGING_OPERATORS) {
    let user = users.find((entry) => entry.email?.toLowerCase() === operator.email);
    const created = !user;
    if (!user) {
      const { data, error } = await client.auth.admin.createUser({
        email: operator.email, password: passwords[operator.email], email_confirm: true,
        app_metadata: { staging_fixture: MARKER, staging_bootstrap_complete: false },
      });
      if (error || !data.user) throw new Error('Could not create staging operator');
      user = data.user;
    }
    if (!user.app_metadata?.staging_bootstrap_complete) {
      const { error } = await client.from('profiles').upsert({
        id: user.id, email: operator.email, nickname: operator.nickname, role: operator.role,
        birth_date: '1990-01-01', consents: { terms: true, privacy: true, marketing: false },
        onboarded_at: new Date().toISOString(),
      }, { onConflict: 'id' });
      if (error) throw new Error('Could not initialize staging operator profile; rerun with the same password vault');
      const { error: markerError } = await client.auth.admin.updateUserById(user.id, {
        app_metadata: { staging_fixture: MARKER, staging_bootstrap_complete: true },
      });
      if (markerError) throw new Error('Could not finish staging operator bootstrap');
    }
    result.push({ id: user.id, email: operator.email, initialRole: operator.role, created });
  }
  return result;
}

export async function readOrCreateOperatorPasswords(filename) {
  if (!filename) throw new Error('STAGING_ACCOUNTS_FILE must name a private file outside Git');
  const location = relative(process.cwd(), resolve(filename));
  if (!isAbsolute(filename) || (!location.startsWith('..') && !isAbsolute(location))) {
    throw new Error('STAGING_ACCOUNTS_FILE must be an absolute path outside the checkout');
  }
  let file;
  try {
    file = await open(filename, 'wx', 0o600);
    const passwords = Object.fromEntries(STAGING_OPERATORS.map(({ email }) => [email, randomBytes(32).toString('base64url')]));
    await file.writeFile(`${JSON.stringify(passwords, null, 2)}\n`);
    await file.sync();
    return passwords;
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
    const info = await lstat(filename);
    if (!info.isFile() || (info.mode & 0o077) !== 0) throw new Error('Staging password vault must be a regular private file (0600)');
    return JSON.parse(await readFile(filename, 'utf8'));
  } finally {
    await file?.close();
  }
}

async function main() {
  const previewRef = process.env.SUPABASE_PREVIEW_PROJECT_ID;
  const productionRef = process.env.SUPABASE_PRODUCTION_PROJECT_ID;
  // Account creation never creates or reinitializes a branch.
  const branches = JSON.parse(invokeSupabase(['branches', 'list', '--project-ref', previewRef, '--output', 'json']));
  const branch = branches.find((entry) => entry.name === 'staging');
  const ref = assertStagingBranch(branch, { previewRef, productionRef });
  const credentials = stagingCredentials(JSON.parse(invokeSupabase([
    'branches', 'get', 'staging', '--project-ref', previewRef, '--output', 'json',
  ])), ref);
  const passwords = await readOrCreateOperatorPasswords(process.env.STAGING_ACCOUNTS_FILE);
  const client = createClient(credentials.SUPABASE_URL, credentials.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { persistSession: false, autoRefreshToken: false } });
  const accounts = await ensureStagingOperators(client, passwords);
  console.log(JSON.stringify({ projectRef: ref, accounts }, null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => { console.error(error.message); process.exitCode = 1; });
}
