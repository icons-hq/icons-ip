import { spawnSync } from 'node:child_process';
import { appendFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

import { stagingDeploymentEnvironment } from './staging-environment.mjs';

export function stagingDeployArgs(environment) {
  const values = stagingDeploymentEnvironment(environment);
  return ['deploy', '--yes', '--archive=tgz', ...Object.entries(values).flatMap(([name, value]) => [
    '--build-env', `${name}=${value}`, '--env', `${name}=${value}`,
  ])];
}

function vercel(args) {
  const result = spawnSync('vercel', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  if (result.error || result.status !== 0) throw new Error(`Vercel ${args[0]} failed; inspect the Vercel deployment log`);
  return result.stdout.trim();
}

async function main() {
  const args = stagingDeployArgs(process.env);
  const manifest = JSON.parse(vercel(['deploy', '--dry', '--format=json']));
  if (!Number.isFinite(manifest.totalSize) || !Number.isFinite(manifest.fileCount)
    || manifest.totalSize >= 900000000 || manifest.fileCount >= 15000
    || manifest.files?.some(({ path }) => path === 'outputs' || path.startsWith('outputs/'))) {
    throw new Error('Unsafe staging upload manifest; inspect .vercelignore and source size');
  }
  const url = vercel(args).split(/\r?\n/).at(-1);
  if (!/^https:\/\/[a-z0-9-]+\.vercel\.app$/.test(url)) throw new Error('Vercel did not return a deployment URL');
  const alias = process.env.STAGING_ALIAS || 'icons-ip-staging.vercel.app';
  vercel(['alias', 'set', url, alias]);
  if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY,
    `\n### 운영 스테이징\n- URL: https://${alias}\n- 배포: ${url}\n- Supabase: ${process.env.PROJECT_REF}\n- 신규 결제 gate closed / Toss test keys / 운영 데이터 복제 없음\n`);
  console.log(`Staging deployed: https://${alias}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => { console.error(error.message); process.exitCode = 1; });
}
