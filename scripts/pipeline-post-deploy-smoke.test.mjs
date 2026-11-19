import { readFile } from 'node:fs/promises';
import yaml from 'js-yaml';
import { describe, expect, it } from 'vitest';

const source = await readFile(new URL('../.github/workflows/pipeline.yml', import.meta.url), 'utf8');
const workflow = yaml.load(source);
const normalize = (value) => value.replace(/\s+/g, ' ').trim();

describe('production post-deploy smoke contract', () => {
  const smoke = workflow.jobs['smoke-production'];

  it('runs as its own job after deploy-vercel, so a transient failure cannot skip the rest of the chain', () => {
    expect(workflow.jobs['deploy-vercel'].steps.map((step) => step.name)).not.toContain('Smoke-test production');
    expect(smoke.needs).toEqual(['deploy-vercel']);
    // 암묵적 success()가 skipped 간접 의존을 통과시키지 않도록 결과를 명시 비교한다.
    expect(normalize(smoke.if)).toBe("!cancelled() && needs.deploy-vercel.result == 'success'");
    expect(smoke.steps.find((step) => step.name === 'Smoke-test production').run).toBe('node scripts/post-deploy-smoke.mjs');
    expect(smoke.steps.every((step) => step['continue-on-error'] === undefined)).toBe(true);
    expect(smoke['timeout-minutes']).toBe(15);
  });

  it('is not a dependency of any other job', () => {
    for (const [name, job] of Object.entries(workflow.jobs)) {
      const needs = [job.needs ?? []].flat();
      expect(needs, name).not.toContain('smoke-production');
    }
    // 배포 사슬 뒤 job들의 if에도 smoke 결과를 쓰지 않는다.
    for (const [name, job] of Object.entries(workflow.jobs)) {
      expect(String(job.if ?? ''), name).not.toContain('smoke-production');
    }
  });

  it('hands the deployed URL to the smoke job for the deployment id comparison', () => {
    const deploy = workflow.jobs['deploy-vercel'];
    const step = deploy.steps.find((entry) => entry.name === 'Deploy Vercel production');
    expect(step.id).toBe('deploy');
    expect(step.run).toContain('echo "deployment_url=$deployment_url" >> "$GITHUB_OUTPUT"');
    expect(deploy.outputs.deployment_url).toBe('${{ steps.deploy.outputs.deployment_url }}');
    expect(smoke.env.DEPLOYMENT_URL).toBe('${{ needs.deploy-vercel.outputs.deployment_url }}');
  });

  it('lets a production_redeploy source run count even when only the smoke job failed', () => {
    const verify = workflow.jobs['validate-plan'].steps.find((step) => step.name === 'Verify deployed Production source');
    expect(verify.run).toContain('and .status == "completed"');
    expect(verify.run).not.toContain('.conclusion == "success"\n            and .path');
    expect(verify.run).toContain('.name == "deploy-vercel" and .conclusion == "success"');
    expect(verify.run).toContain('.name == "smoke-production" or .conclusion == "success" or .conclusion == "skipped"');
  });
});
