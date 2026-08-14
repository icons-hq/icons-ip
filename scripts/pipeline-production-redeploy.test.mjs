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

    const condition = normalizeExpression(workflow.jobs['deploy-vercel'].if);
    expect(condition).toBe(normalizeExpression(productionDeployCondition));
    expect(condition).toContain('!cancelled()');
    expect(condition).not.toContain('always()');
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
    expect(deployVercel.needs).toEqual(['validate', 'deploy-supabase']);
    expect(condition).toBe(normalizeExpression(productionDeployCondition));
  });

  it('keeps the production Vercel path and skips every Supabase mutation on dispatch', async () => {
    const workflow = yaml.load(await readFile(workflowPath, 'utf8'));
    const steps = workflow.jobs['deploy-vercel'].steps;
    const secretCheck = steps.find((step) => step.name === 'Check Vercel deployment secrets');
    const deploy = steps.find((step) => step.name === 'Deploy Vercel production');
    const syncSupabase = steps.find(
      (step) => step.name === 'Activate recovery token-hash template in production',
    );

    expect(secretCheck.run).toContain(
      'VERCEL_TOKEN VERCEL_ORG_ID VERCEL_PROJECT_ID CRON_SECRET SUPABASE_ACCESS_TOKEN SUPABASE_PROJECT_ID',
    );
    expect(deploy.run).toContain('vercel deploy --yes --prod --archive=tgz');
    expect(syncSupabase.if).toBe(
      "github.event_name == 'push' && github.ref == 'refs/heads/main'",
    );
  });
});
