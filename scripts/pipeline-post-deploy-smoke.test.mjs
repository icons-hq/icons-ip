import { readFile } from 'node:fs/promises';
import yaml from 'js-yaml';
import { describe, expect, it } from 'vitest';

const workflow = yaml.load(await readFile(new URL('../.github/workflows/pipeline.yml', import.meta.url), 'utf8'));

describe('production post-deploy smoke contract', () => {
  const steps = workflow.jobs['deploy-vercel'].steps;
  const names = steps.map((step) => step.name);

  it('smoke-tests production right after the deploy and before the Auth template activation', () => {
    const deploy = names.indexOf('Deploy Vercel production');
    const smoke = names.indexOf('Smoke-test production');
    const activate = names.indexOf('Activate recovery token-hash template in production');
    expect(deploy).toBeGreaterThanOrEqual(0);
    expect(smoke).toBe(deploy + 1);
    expect(activate).toBeGreaterThan(smoke);
    expect(steps[smoke].run).toBe('node scripts/post-deploy-smoke.mjs');
    // 실패를 삼키지 않아야 job이 실패해 알림이 간다.
    expect(steps[smoke]['continue-on-error']).toBeUndefined();
  });
});
