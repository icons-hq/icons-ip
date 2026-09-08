import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const script = fileURLToPath(new URL('./deploy-staging.mjs', import.meta.url));
const checker = new URL('./check-vercel-build-env.mjs', import.meta.url).href;
const inheritedSecret = 'test_gsk_inherited_preview000001';

// Exercise the real deployment entry point through a local CLI double. No Vercel/Supabase call is made.
async function deploy(mode) {
  const directory = await mkdtemp(join(tmpdir(), 'icons-staging-deploy-test-'));
  const aliasFile = join(directory, 'alias.json');
  const callsFile = join(directory, 'calls.jsonl');
  const oldAlias = 'https://previous-staging.vercel.app';
  try {
    await writeFile(aliasFile, JSON.stringify(oldAlias));
    await writeFile(join(directory, 'vercel'), `#!${process.execPath}
const { appendFileSync, writeFileSync } = require('node:fs');
(async () => {
  const args = process.argv.slice(2);
  appendFileSync(process.env.TEST_CALLS_FILE, JSON.stringify(args.slice(0, 2)) + '\\n');
  if (args[0] === 'alias') {
    writeFileSync(process.env.TEST_ALIAS_FILE, JSON.stringify(args[2]));
  } else if (args.includes('--dry')) {
    console.log(JSON.stringify({ totalSize: 100, fileCount: 1, files: [{ path: 'package.json' }] }));
  } else {
    const environment = {
      VERCEL_ENV: 'preview',
      NEXT_PUBLIC_TOSS_CLIENT_KEY: 'test_gck_inherited_preview000001',
      TOSS_SECRET_KEY: process.env.TEST_MODE === 'invalid-key' ? 'live_gsk_inherited_preview000001' : ${JSON.stringify(inheritedSecret)},
    };
    for (let index = 0; index < args.length; index++) {
      if (args[index] !== '--build-env') continue;
      const entry = args[++index];
      const separator = entry.indexOf('=');
      environment[entry.slice(0, separator)] = entry.slice(separator + 1);
    }
    try {
      const { validateVercelBuildEnvironment } = await import(${JSON.stringify(checker)});
      validateVercelBuildEnvironment(environment);
    } catch {
      // A provider can return credential material on failure; the entry point must never echo it.
      console.error(${JSON.stringify(inheritedSecret)});
      process.exitCode = 1;
      return;
    }
    console.log(process.env.TEST_MODE === 'invalid-url' ? 'https://iconsip.com' : 'https://new-staging.vercel.app');
  }
})();
`, { mode: 0o700 });
    const result = spawnSync(process.execPath, [script], {
      encoding: 'utf8',
      env: {
        PATH: `${directory}:${process.env.PATH}`,
        PROJECT_REF: 'cdefghijklmnopqrstuv',
        SUPABASE_PREVIEW_PROJECT_ID: 'abcdefghijklmnopqrst',
        SUPABASE_PRODUCTION_PROJECT_ID: 'bcdefghijklmnopqrstu',
        SUPABASE_URL: 'https://cdefghijklmnopqrstuv.supabase.co',
        SUPABASE_PUBLISHABLE_KEY: 'test-public', SUPABASE_SERVICE_ROLE_KEY: 'test-private',
        POSTGRES_URL: 'postgres://postgres.cdefghijklmnopqrstuv:test@pooler.supabase.com/postgres',
        TEST_MODE: mode, TEST_ALIAS_FILE: aliasFile, TEST_CALLS_FILE: callsFile,
      },
    });
    return {
      ...result,
      alias: JSON.parse(await readFile(aliasFile, 'utf8')),
      calls: (await readFile(callsFile, 'utf8')).trim().split('\n').map((line) => JSON.parse(line)),
      oldAlias,
    };
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

describe('staging deployment activation', () => {
  it.each(['invalid-key', 'invalid-url'])('keeps the previous alias after %s and excludes provider output from logs', async (mode) => {
    const result = await deploy(mode);
    expect(result.status).toBe(1);
    expect(result.alias).toBe(result.oldAlias);
    expect(result.calls.some(([command]) => command === 'alias')).toBe(false);
    expect(result.stdout + result.stderr).not.toContain(inheritedSecret);
    expect(result.stderr).toContain(mode === 'invalid-key'
      ? 'Vercel deploy failed; inspect the Vercel deployment log'
      : 'Vercel did not return a deployment URL');
  });

  it('activates the alias only after the remote prebuild accepts inherited keys and isolated settings', async () => {
    const result = await deploy('valid');
    expect(result.status).toBe(0);
    expect(result.alias).toBe('https://new-staging.vercel.app');
    expect(result.calls).toEqual([['deploy', '--dry'], ['deploy', '--yes'], ['alias', 'set']]);
    expect(result.stdout).toContain('Staging deployed: https://icons-ip-staging.vercel.app');
    expect(result.stdout + result.stderr).not.toContain(inheritedSecret);
  });
});
