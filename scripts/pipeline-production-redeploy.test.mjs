import { readFile } from 'node:fs/promises';

import yaml from 'js-yaml';
import { describe, expect, it } from 'vitest';

const workflowPath = new URL('../.github/workflows/pipeline.yml', import.meta.url);

const productionDeployCondition = `
  !cancelled()
  && needs.validate.result == 'success'
  && (
    (
      github.event_name == 'push'
      && github.ref == 'refs/heads/main'
      && needs.deploy-supabase.result == 'success'
    )
    || (
      github.event_name == 'workflow_dispatch'
      && github.ref == 'refs/heads/main'
      && inputs.production_redeploy == true
      && needs.deploy-supabase.result == 'skipped'
    )
  )
`;

function normalizeExpression(expression) {
  return expression.replace(/\s+/g, ' ').trim();
}

describe('production config redeploy workflow contract', () => {
  it('only allows an explicit boolean dispatch from the exact main ref', async () => {
    const workflow = yaml.load(await readFile(workflowPath, 'utf8'));
    const dispatch = workflow.on.workflow_dispatch;

    expect(dispatch.inputs.production_redeploy).toMatchObject({
      type: 'boolean',
      default: false,
    });
    expect(dispatch.inputs.production_source_run_id).toMatchObject({
      type: 'string',
      required: false,
    });

    const condition = normalizeExpression(workflow.jobs['deploy-vercel'].if);
    expect(condition).toBe(normalizeExpression(productionDeployCondition));
    expect(condition).toContain('!cancelled()');
    expect(condition).not.toContain('always()');
    expect(workflow.permissions).toEqual({ contents: 'read' });
    expect(workflow.jobs.validate.permissions).toEqual({
      actions: 'read',
      contents: 'read',
    });
  });

  it('keeps push deployments ordered and lets validated dispatches bypass only Supabase', async () => {
    const workflow = yaml.load(await readFile(workflowPath, 'utf8'));
    const deploySupabase = workflow.jobs['deploy-supabase'];
    const deployVercel = workflow.jobs['deploy-vercel'];
    const condition = normalizeExpression(deployVercel.if);

    expect(deploySupabase.needs).toBe('validate');
    expect(deploySupabase.if).toBe(
      "github.event_name == 'push' && github.ref == 'refs/heads/main'",
    );
    expect(
      deploySupabase.steps.find((step) => step.name === 'Push Supabase migrations').run,
    ).toBe('supabase db push --linked --include-roles');
    expect(deployVercel.needs).toEqual(['validate', 'deploy-supabase']);
    expect(condition).toBe(normalizeExpression(productionDeployCondition));
  });

  it('keeps the production Vercel path and skips every Supabase mutation on dispatch', async () => {
    const workflow = yaml.load(await readFile(workflowPath, 'utf8'));
    const validationSteps = workflow.jobs.validate.steps;
    const steps = workflow.jobs['deploy-vercel'].steps;
    const sourceCheck = validationSteps.find(
      (step) => step.name === 'Verify deployed Production source',
    );
    const secretCheck = steps.find((step) => step.name === 'Check Vercel deployment secrets');
    const deploy = steps.find((step) => step.name === 'Deploy Vercel production');
    const syncSupabase = steps.find(
      (step) => step.name === 'Activate recovery token-hash template in production',
    );

    expect(secretCheck.run).toContain(
      'VERCEL_TOKEN VERCEL_ORG_ID VERCEL_PROJECT_ID CRON_SECRET SUPABASE_ACCESS_TOKEN SUPABASE_PROJECT_ID',
    );
    expect(normalizeExpression(sourceCheck.if)).toBe(normalizeExpression(`
      github.event_name == 'workflow_dispatch'
      && inputs.production_redeploy == true
    `));
    expect(sourceCheck.env).toEqual({
      GH_TOKEN: '${{ github.token }}',
      SOURCE_RUN_ID: '${{ inputs.production_source_run_id }}',
    });
    expect(sourceCheck.run).toContain('^' + '[1-9][0-9]{5,}' + '$');
    expect(sourceCheck.run).toContain('.head_sha == $sha');
    expect(sourceCheck.run).toContain('.event == "push"');
    expect(sourceCheck.run).toContain('.head_branch == "main"');
    expect(sourceCheck.run).toContain('.conclusion == "success"');
    expect(sourceCheck.run).toContain('.path == ".github/workflows/pipeline.yml"');
    expect(sourceCheck.run).toContain('.name == "deploy-supabase" and .conclusion == "success"');
    expect(sourceCheck.run).toContain('.name == "deploy-vercel" and .conclusion == "success"');
    expect(deploy.run).toContain('vercel deploy --yes --prod --archive=tgz');
    expect(syncSupabase.if).toBe(
      "github.event_name == 'push' && github.ref == 'refs/heads/main'",
    );
  });
});
