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
  it('reruns only meaningful pull request edits so base retargets redeploy preview', async () => {
    const workflow = await loadWorkflow(pipelinePath);
    const validate = workflow.jobs.validate;

    expect(workflow.on.pull_request.types).toEqual([
      'opened',
      'synchronize',
      'reopened',
      'edited',
    ]);
    expect(validate.if).toContain("github.event.action != 'edited'");
    expect(validate.if).toContain('github.event.changes.base != null');
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
    expect(prepare.run.indexOf('supabase branches create "$branch_name"')).toBeLessThan(
      prepare.run.indexOf('latest_main_sha="$(git rev-parse origin/main)"'),
    );
    expect(prepare.run).toContain('--region ap-northeast-2');
    expect(prepare.run).toContain('--size micro');
    expect(prepare.run).not.toContain('--with-data');
    expect(prepare.run).not.toContain('--git-branch');
    expect(prepare.run).toContain(
      '.SUPABASE_PUBLISHABLE_KEY // .SUPABASE_ANON_KEY // empty',
    );
    expect(push.if).toContain("database_mode == 'isolated'");
    expect(push.run).toBe(
      'supabase db push --db-url "$POSTGRES_URL" --include-roles --include-seed --yes',
    );
    expect(functions.if).toContain("database_mode == 'isolated'");
    expect(functions.run).toBe('node scripts/reconcile-supabase-functions.mjs');
    expect(verify.if).toContain("database_mode == 'isolated'");
    expect(verify.run).toContain('postgres:17-alpine');
    expect(job.steps.some((step) => step.run?.includes('db push --linked'))).toBe(false);
    expect(job['timeout-minutes']).toBeGreaterThanOrEqual(30);
  });

  it('injects the selected branch credentials into Vercel build and runtime', async () => {
    const workflow = await loadWorkflow(pipelinePath);
    const job = workflow.jobs['deploy-vercel-preview'];
    const load = findStep(job, 'Load exact Supabase credentials for deployment');
    const deploy = findStep(job, 'Deploy Vercel preview');
    const template = findStep(job, 'Activate recovery template in isolated preview');

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
    const push = findStep(job, 'Apply main migrations and seed to shared preview');
    const functions = findStep(job, 'Reconcile shared preview Supabase Edge Functions');
    const auth = findStep(job, 'Sync shared preview Auth URLs');
    const check = findStep(job, 'Check shared preview sync secrets');

    expect(job.needs).toEqual(['deploy-supabase', 'deploy-vercel']);
    expect(job.if).toBe("github.event_name == 'push' && github.ref == 'refs/heads/main'");
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
