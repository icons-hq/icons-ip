import { readFile } from 'node:fs/promises';

import yaml from 'js-yaml';
import { describe, expect, it } from 'vitest';

const pipelinePath = new URL('../.github/workflows/pipeline.yml', import.meta.url);
const cleanupPath = new URL(
  '../.github/workflows/supabase-preview-cleanup.yml',
  import.meta.url,
);
const vercelIgnorePath = new URL('../.vercelignore', import.meta.url);

async function loadWorkflow(path) {
  return yaml.load(await readFile(path, 'utf8'));
}

function findStep(job, name) {
  return job.steps.find((step) => step.name === name);
}

describe('Supabase preview branch workflow contract', () => {
  it('revalidates every edit while only base retargets redeploy preview', async () => {
    const workflow = await loadWorkflow(pipelinePath);
    const validationJobs = ['validate-plan', 'validate-app', 'validate-db', 'validate']
      .map((name) => workflow.jobs[name]);

    expect(workflow.on.pull_request.types).toEqual([
      'opened',
      'synchronize',
      'reopened',
      'edited',
    ]);
    // 검증 job은 제목·본문 edited 이벤트도 걸러내지 않는다.
    for (const job of validationJobs) {
      expect(job.if ?? '', job.name).not.toContain('github.event');
    }
    expect(workflow.jobs['deploy-supabase-preview'].if).toContain("github.event.action != 'edited'");
    expect(workflow.jobs['deploy-supabase-preview'].if).toContain('github.event.changes.base != null');
    expect(workflow.concurrency['cancel-in-progress']).toContain(
      "github.event.action != 'edited'",
    );
    expect(workflow.concurrency['cancel-in-progress']).toContain(
      'github.event.changes.base != null',
    );
  });

  it('detects the whole PR diff and exposes only non-secret routing outputs', async () => {
    const workflow = await loadWorkflow(pipelinePath);
    const job = workflow.jobs['deploy-supabase-preview'];
    const checkout = findStep(job, 'Check out repository');
    const mode = findStep(job, 'Select preview database mode');

    expect(checkout.with).toEqual({ 'fetch-depth': 0 });
    expect(mode.run).toContain(
      'git diff --name-only --no-renames --diff-filter=ACDMRT -z',
    );
    expect(mode.run).toContain('"$PR_BASE_SHA...$PR_HEAD_SHA"');
    expect(job.env.PR_BASE_REF).toBe('${{ github.event.pull_request.base.ref }}');
    expect(mode.run).toContain(
      'node scripts/preview-supabase-mode.mjs --base-ref "$PR_BASE_REF"',
    );
    expect(job.outputs).toEqual({
      configured: '${{ steps.check.outputs.configured }}',
      database_mode: '${{ steps.mode.outputs.database_mode }}',
      branch_name: '${{ steps.mode.outputs.branch_name }}',
    });
    expect(job.outputs).not.toHaveProperty('SUPABASE_SERVICE_ROLE_KEY');
    expect(job.outputs).not.toHaveProperty('POSTGRES_URL');
  });

  it('rejects an isolated preview whose head does not contain current main', async () => {
    const workflow = await loadWorkflow(pipelinePath);
    const job = workflow.jobs['deploy-supabase-preview'];
    const gate = findStep(job, 'Verify isolated preview contains current main');

    expect(gate.if).toContain("database_mode == 'isolated'");
    expect(gate.run).toContain('git fetch --no-tags origin main');
    expect(gate.run).toContain('git merge-base --is-ancestor "$current_main_sha" "$PR_HEAD_SHA"');
    expect(gate.run).toContain('Isolated preview head is behind main');
  });

  it('requires exact base-main sync evidence before using shared preview', async () => {
    const workflow = await loadWorkflow(pipelinePath);
    const job = workflow.jobs['deploy-supabase-preview'];
    const gate = findStep(job, 'Verify shared preview base synchronization');

    expect(job.permissions).toEqual({ actions: 'read', contents: 'read' });
    expect(gate.if).toContain("database_mode == 'shared'");
    expect(gate.env).toEqual({ GH_TOKEN: '${{ github.token }}' });
    expect(gate.run).toContain('git show "$PR_BASE_SHA:.github/workflows/pipeline.yml"');
    expect(gate.run).toContain("grep -q '^  sync-supabase-preview-main:'");
    expect(gate.run).toContain(
      "grep -q '^  sync-supabase-preview-main:' .github/workflows/pipeline.yml",
    );
    expect(gate.run).toContain('head_sha=${PR_BASE_SHA}');
    // deploy-staging이 끝날 때까지 run 전체 완료를 기다리지 않는다. 증거는 아래 두 job 결론이다.
    expect(gate.run).not.toContain('status=completed');
    expect(gate.run).toContain('.name == "deploy-supabase" and .conclusion == "success"');
    expect(gate.run).toContain(
      '.name == "sync-supabase-preview-main" and .conclusion == "success"',
    );
  });

  it('recreates an exact no-data branch only for deploy-affecting PRs', async () => {
    const workflow = await loadWorkflow(pipelinePath);
    const job = workflow.jobs['deploy-supabase-preview'];
    const prepare = findStep(job, 'Prepare exact Supabase preview branch');
    const push = findStep(job, 'Apply migrations and seed to isolated preview');
    const functions = findStep(job, 'Reconcile Edge Functions in isolated preview');
    const verify = findStep(job, 'Verify isolated preview catalog baseline');

    expect(prepare.run).toContain('branch_name="pr-${PR_NUMBER}"');
    expect(prepare.run).toContain('supabase branches delete "$branch_name"');
    expect(prepare.run).toContain('supabase branches create "$branch_name"');
    expect(prepare.run).toContain('git fetch --no-tags origin main');
    expect(prepare.run).toContain(
      'git merge-base --is-ancestor "$latest_main_sha" "$PR_HEAD_SHA"',
    );
    // 플랫폼 run이 parent 이력을 다 읽고 적용한 뒤에야 parent snapshot과 main을 비교할 수 있다.
    const createAt = prepare.run.indexOf('supabase branches create "$branch_name"');
    const platformWaitAt = prepare.run.indexOf('node scripts/wait-supabase-branch-deployment.mjs');
    const mainRecheckAt = prepare.run.indexOf('latest_main_sha="$(git rev-parse origin/main)"');
    expect(createAt).toBeGreaterThan(-1);
    expect(createAt).toBeLessThan(platformWaitAt);
    expect(platformWaitAt).toBeLessThan(mainRecheckAt);
    expect(prepare.run).toContain('BRANCH_ID="$(jq -r \'.id // empty\' <<<"$branch_json")"');
    expect(prepare.run).toContain('PROJECT_REF="$branch_project_ref"');
    expect(prepare.run).toContain('--region ap-northeast-2');
    expect(prepare.run).toContain('--size micro');
    expect(prepare.run).not.toContain('--with-data');
    expect(prepare.run).not.toContain('--git-branch');
    expect(prepare.run).toContain(
      '.SUPABASE_PUBLISHABLE_KEY // .SUPABASE_ANON_KEY // empty',
    );
    expect(push.if).toContain("database_mode == 'isolated'");
    // production db push처럼 --include-all 없이 한 번만 push해 기록된 이력보다 이른 migration을 거부한다.
    expect(push.run.match(/^supabase db push .*$/gm)).toEqual([
      'supabase db push --db-url "$POSTGRES_URL" --include-roles --include-seed --yes 2>&1 \\',
    ]);
    expect(push.run).toContain('push_status="${PIPESTATUS[0]}"');
    expect(push.run).toContain('exit "$push_status"');
    expect(push.run).toContain("to_regclass('supabase_migrations.schema_migrations')");
    expect(push.run.indexOf('recorded_versions > "$before"')).toBeLessThan(
      push.run.indexOf('supabase db push'),
    );
    expect(push.run.indexOf('supabase db push')).toBeLessThan(
      push.run.indexOf('recorded_versions > "$after"'),
    );
    expect(push.run).toContain('comm -13 "$before" "$after"');
    expect(job.steps.indexOf(prepare)).toBeLessThan(
      job.steps.indexOf(findStep(job, 'Sync isolated Supabase preview Auth URLs')),
    );
    expect(functions.if).toContain("database_mode == 'isolated'");
    expect(functions.run).toBe('node scripts/reconcile-supabase-functions.mjs');
    expect(verify.if).toContain("database_mode == 'isolated'");
    expect(verify.run).toContain('postgres:17-alpine');
    expect(job.steps.some((step) => step.run?.includes('db push --linked'))).toBe(false);
    // branch 생성 대기 10분 + 플랫폼 run 대기 기본 15분 + push 여유.
    expect(job['timeout-minutes']).toBeGreaterThanOrEqual(45);
  });

  it('injects the selected branch credentials into Vercel build and runtime', async () => {
    const workflow = await loadWorkflow(pipelinePath);
    const job = workflow.jobs['deploy-vercel-preview'];
    const load = findStep(job, 'Load exact Supabase credentials for deployment');
    const freshness = findStep(job, 'Revalidate shared preview main before deployment');
    const deploy = findStep(job, 'Deploy Vercel preview');
    const template = findStep(job, 'Activate recovery template in isolated preview');

    expect(job.env.PR_BASE_SHA).toBe('${{ github.event.pull_request.base.sha }}');
    expect(load.run).toContain('supabase branches get "$expected_branch"');
    expect(load.run).toContain('SUPABASE_PREVIEW_PROJECT_ID');
    expect(load.run).toContain('SUPABASE_PRODUCTION_PROJECT_ID');
    expect(load.run).toContain('.SUPABASE_PUBLISHABLE_KEY // .SUPABASE_ANON_KEY // empty');
    expect(load.run).toContain("printf 'PROJECT_REF=%s\\n' \"$branch_project_ref\"");
    for (const name of [
      'NEXT_PUBLIC_SUPABASE_URL',
      'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY',
      'SUPABASE_SERVICE_ROLE_KEY',
      'ICONS_CATALOG_SOURCE',
    ]) {
      expect(deploy.run).toContain(`--build-env "${name}=`);
      expect(deploy.run).toContain(`--env "${name}=`);
    }
    expect(freshness.if).toBe("env.DATABASE_MODE == 'shared'");
    expect(freshness.run).toContain('git fetch --no-tags origin main');
    expect(freshness.run).toContain('current_main_sha="$(git rev-parse origin/main)"');
    expect(freshness.run).toContain('[ "$PR_BASE_SHA" != "$current_main_sha" ]');
    expect(job.steps.indexOf(freshness)).toBe(job.steps.indexOf(deploy) - 1);
    expect(template.if).toBe("env.DATABASE_MODE == 'isolated'");
    expect(template.env.RECOVERY_TEMPLATE_PATH).toBe('supabase/templates/recovery.html');
    expect(template.run).toBe('node scripts/sync-supabase-auth.mjs');
  });

  it('fails before upload when local outputs or an oversized source manifest appears', async () => {
    const workflow = await loadWorkflow(pipelinePath);
    const job = workflow.jobs['deploy-vercel-preview'];
    const manifest = findStep(job, 'Verify Vercel preview upload manifest');

    expect(workflow.env.VERCEL_CLI_VERSION).toBe('54.17.2');
    expect(manifest.run).toContain('vercel deploy --dry --format=json');
    expect(manifest.run).toContain('startswith("outputs/")');
    expect(manifest.run).toContain('[ "$total_size" -ge 900000000 ]');
    expect(manifest.run).toContain('[ "$file_count" -ge 15000 ]');
  });

  it('syncs shared preview only from a successful production main migration', async () => {
    const workflow = await loadWorkflow(pipelinePath);
    const job = workflow.jobs['sync-supabase-preview-main'];
    const freshness = findStep(job, 'Verify this run is still current main');
    const push = findStep(job, 'Apply main migrations and seed to shared preview');
    const functions = findStep(job, 'Reconcile shared preview Supabase Edge Functions');
    const auth = findStep(job, 'Sync shared preview Auth URLs');
    const check = findStep(job, 'Check shared preview sync secrets');

    expect(job.needs).toEqual(['deploy-supabase', 'deploy-vercel']);
    expect(job.if.replace(/\s+/g, ' ').trim()).toBe(
      "!cancelled() && needs.deploy-supabase.result == 'success' && needs.deploy-vercel.result == 'success' && github.event_name == 'push' && github.ref == 'refs/heads/main'",
    );
    expect(freshness.run).toContain('git fetch --no-tags origin main');
    expect(freshness.run).toContain('current_main_sha="$(git rev-parse origin/main)"');
    expect(freshness.run).toContain('[ "$GITHUB_SHA" != "$current_main_sha" ]');
    expect(job.steps.indexOf(freshness)).toBeLessThan(job.steps.indexOf(auth));
    expect(push.run).toBe('supabase db push --linked --include-roles --include-seed --yes');
    expect(functions.run).toBe('node scripts/reconcile-supabase-functions.mjs');
    expect(auth.env.RECOVERY_TEMPLATE_PATH).toBe('supabase/templates/recovery.html');
    expect(check.run).toContain(
      '[ "$SUPABASE_PREVIEW_PROJECT_ID" = "$SUPABASE_PRODUCTION_PROJECT_ID" ]',
    );
  });

  it('deletes only the deterministic non-default branch when a same-repo PR closes', async () => {
    const workflow = await loadWorkflow(cleanupPath);
    const pipeline = await loadWorkflow(pipelinePath);
    const job = workflow.jobs['delete-preview-branch'];
    const cleanup = findStep(job, 'Delete isolated preview branch');

    expect(workflow.on.pull_request.types).toEqual(['closed']);
    expect(workflow.on.pull_request).not.toHaveProperty('branches');
    expect(workflow.concurrency.group).toBe(
      'supabase-preview-pr-${{ github.event.pull_request.number }}',
    );
    expect(pipeline.concurrency.group).toContain("format('supabase-preview-pr-{0}'");
    expect(job.if).toBe('github.event.pull_request.head.repo.full_name == github.repository');
    expect(cleanup.run).toContain('branch_name="pr-${PR_NUMBER}"');
    expect(cleanup.run).toContain('.is_default == false');
    expect(cleanup.run).toContain('supabase branches delete "$branch_name"');
    expect(cleanup.run).toContain('SUPABASE_PRODUCTION_PROJECT_ID');
  });

  it('keeps local authoring outputs out of every Vercel CLI upload', async () => {
    const ignore = await readFile(vercelIgnorePath, 'utf8');
    expect(ignore.split(/\r?\n/)).toContain('/outputs/');
  });
});
