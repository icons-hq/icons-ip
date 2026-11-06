import { readFile } from 'node:fs/promises';
import yaml from 'js-yaml';
import { describe, expect, it } from 'vitest';

const workflows = await Promise.all(
  ['pipeline.yml', 'supabase-preview-cleanup.yml'].map(async (file) => ({
    file,
    workflow: yaml.load(
      await readFile(new URL(`../.github/workflows/${file}`, import.meta.url), 'utf8'),
    ),
  })),
);

// GitHub 기본 job 상한 360분에서는 멈춘 설치 하나가 main 배포 사슬을 6시간 막았다(run 41991138701).
// 가장 긴 job 상한(deploy-staging 40분)보다 길게 둘 이유가 생기면 이 상한과 근거를 함께 바꾼다.
const MAX_JOB_MINUTES = 40;
const MAX_SETUP_CLI_MINUTES = 5;

describe('workflow time limits', () => {
  it('bounds every job well below the 360-minute GitHub default', () => {
    for (const { file, workflow } of workflows) {
      for (const [id, job] of Object.entries(workflow.jobs)) {
        const minutes = job['timeout-minutes'];
        expect(Number.isInteger(minutes), `${file} ${id} timeout-minutes`).toBe(true);
        expect(minutes, `${file} ${id} timeout-minutes`).toBeGreaterThan(0);
        expect(minutes, `${file} ${id} timeout-minutes`).toBeLessThanOrEqual(MAX_JOB_MINUTES);
      }
    }
  });

  it('fails a stalled Supabase CLI install as a step failure within minutes', () => {
    let installs = 0;
    for (const { file, workflow } of workflows) {
      for (const [id, job] of Object.entries(workflow.jobs)) {
        for (const step of job.steps ?? []) {
          if (!step.uses?.startsWith('supabase/setup-cli@')) continue;
          installs += 1;
          const minutes = step['timeout-minutes'];
          expect(Number.isInteger(minutes), `${file} ${id} setup-cli timeout-minutes`).toBe(true);
          expect(minutes, `${file} ${id} setup-cli timeout-minutes`).toBeLessThanOrEqual(
            MAX_SETUP_CLI_MINUTES,
          );
          expect(minutes, `${file} ${id} setup-cli timeout-minutes`).toBeLessThan(
            job['timeout-minutes'],
          );
          expect(step['continue-on-error'], `${file} ${id} setup-cli`).toBeUndefined();
        }
      }
    }
    expect(installs).toBeGreaterThan(0);
  });
});
