import { existsSync, readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import yaml from 'js-yaml';
import { describe, expect, it } from 'vitest';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const workflow = yaml.load(
  await readFile(path.join(repoRoot, '.github/workflows/pipeline.yml'), 'utf8'),
);
const jobs = workflow.jobs;

// Vercel이 원격에서 설치·빌드하므로 로컬 의존성이 필요 없는 배포 job.
const NO_INSTALL_DEPLOY_JOBS = ['deploy-vercel', 'deploy-vercel-preview', 'deploy-staging'];

const runText = (job) => (job.steps ?? []).map((step) => step.run ?? '').join('\n');
const installsDependencies = (job) => /(^|\s)npm ci(\s|$)/m.test(runText(job));
const normalize = (expression) => String(expression ?? '').replace(/\s+/g, ' ').trim();

function referencedScripts(job) {
  const found = new Set();
  for (const match of runText(job).matchAll(/(?:^|[\s"'(])(?:\.\/)?(scripts\/[\w./-]+\.m?js)\b/g)) {
    found.add(match[1]);
  }
  return [...found];
}

function importSpecifiers(source) {
  const patterns = [
    /(?:^|\n)\s*(?:import|export)\s[^'"`;]*?\sfrom\s*['"]([^'"]+)['"]/g,
    /(?:^|\n)\s*import\s*['"]([^'"]+)['"]/g,
    /\bimport\(\s*['"]([^'"]+)['"]\s*\)/g,
  ];
  return patterns.flatMap((pattern) => [...source.matchAll(pattern)].map((match) => match[1]));
}

// 상대 import를 따라가며 npm 패키지(node_modules) import를 찾는다.
function packageImports(entry) {
  const seen = new Set();
  const offenders = [];
  const visit = (file) => {
    if (seen.has(file)) return;
    seen.add(file);
    for (const specifier of importSpecifiers(readFileSync(file, 'utf8'))) {
      if (specifier.startsWith('node:')) continue;
      if (specifier.startsWith('./') || specifier.startsWith('../')) {
        const target = path.resolve(path.dirname(file), specifier);
        expect(existsSync(target), `${path.relative(repoRoot, file)} -> ${specifier}`).toBe(true);
        visit(target);
        continue;
      }
      offenders.push(`${path.relative(repoRoot, file)} imports ${specifier}`);
    }
  };
  visit(path.join(repoRoot, entry));
  return offenders;
}

describe('deployment job speed contract', () => {
  it('does not install repository dependencies in jobs that deploy through Vercel', () => {
    for (const name of NO_INSTALL_DEPLOY_JOBS) {
      const job = jobs[name];
      expect(installsDependencies(job), `${name} npm ci`).toBe(false);
      const setupNode = job.steps.find((step) => step.uses?.startsWith('actions/setup-node@'));
      // 설치가 없는 job이 npm 캐시를 저장하면 lockfile 키에 Vercel CLI만 든 캐시가 남는다.
      expect(setupNode.with, `${name} setup-node`).toEqual({ 'node-version': '${{ env.NODE_VERSION }}' });
      const vercelInstall = job.steps.find((step) => step.name === 'Install Vercel CLI');
      expect(vercelInstall.run).toBe('npm install --global "vercel@${VERCEL_CLI_VERSION}"');
    }
  });

  it('runs only Node built-in scripts in jobs without npm ci', () => {
    const checked = new Set();
    for (const [name, job] of Object.entries(jobs)) {
      if (installsDependencies(job)) continue;
      for (const script of referencedScripts(job)) {
        checked.add(script);
        expect(packageImports(script), `${name} ${script}`).toEqual([]);
      }
    }
    // 배포 job이 실제로 쓰는 스크립트가 검사 대상에 들어 있어야 의미가 있다.
    expect([...checked]).toEqual(expect.arrayContaining([
      'scripts/sync-supabase-auth.mjs',
      'scripts/reconcile-supabase-functions.mjs',
      'scripts/staging-environment.mjs',
      'scripts/deploy-staging.mjs',
      'scripts/preview-supabase-mode.mjs',
      'scripts/wait-supabase-branch-deployment.mjs',
    ]));
  });

  it('flags a script that imports an npm package', () => {
    expect(importSpecifiers([
      "import yaml from 'js-yaml';",
      "import { readFile } from 'node:fs/promises';",
      "import {\n  a,\n  b,\n} from '../lib/x.mjs';",
      "const m = await import('@supabase/supabase-js');",
    ].join('\n'))).toEqual(['js-yaml', 'node:fs/promises', '../lib/x.mjs', '@supabase/supabase-js']);
  });

  it('starts PR previews alongside validation instead of after it', () => {
    const preview = jobs['deploy-supabase-preview'];
    expect(preview.needs).toBeUndefined();
    expect(preview.if).toContain("github.event_name == 'pull_request'");

    const vercelPreview = jobs['deploy-vercel-preview'];
    expect(vercelPreview.needs).toBe('deploy-supabase-preview');
    expect(normalize(vercelPreview.if)).toMatch(
      /^!cancelled\(\) && needs\.deploy-supabase-preview\.result == 'success' && github\.event_name == 'pull_request' && /,
    );
    expect(normalize(vercelPreview.if)).toContain(
      "needs.deploy-supabase-preview.outputs.configured == 'true'",
    );

    // production 사슬은 그대로 validate 집계 결과를 본다.
    expect(jobs['deploy-supabase'].needs).toBe('validate');
    expect(jobs['deploy-vercel'].needs).toEqual(['validate', 'deploy-supabase']);
  });
});
