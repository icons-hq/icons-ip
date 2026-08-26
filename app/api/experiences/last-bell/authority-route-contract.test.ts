import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  enabled: false,
  config: vi.fn(() => ({ isConfigured: true })),
  serviceConfig: vi.fn(() => ({ isConfigured: true })),
  serviceClient: vi.fn(),
  readJson: vi.fn(async () => ({})),
  writeIdentity: vi.fn(async (): Promise<
    { userId: string | null } | { error: { status: number; code: string } }
  > => ({ userId: null })),
}));

vi.mock('@/lib/campaigns/aouad/game-entry', () => ({
  isLastBellVerifiedExperienceEnabled: () => mocks.enabled,
}));

vi.mock('@/lib/supabase/config', () => ({ getSupabaseConfig: mocks.config }));
vi.mock('@/lib/supabase/service', () => ({
  createServiceClient: mocks.serviceClient,
  getServiceRoleConfig: mocks.serviceConfig,
}));

vi.mock('@/lib/experiences/last-bell/route.server', () => ({
  lastBellError: (status: number, code: string) => Response.json({ error: { code } }, { status }),
  lastBellJson: (value: unknown) => Response.json(value),
  isSameOriginLastBellMutation: () => true,
  readLastBellJson: mocks.readJson,
  getLastBellGuestDigestInput: () => null,
  getLastBellWriteIdentity: mocks.writeIdentity,
  isLastBellWriteFailure: (identity: unknown) => typeof identity === 'object' && identity !== null && 'error' in identity,
}));

import { POST as startRun } from './runs/route';
import { POST as recordEvent } from './runs/[runId]/events/route';
import { POST as completeRun } from './runs/[runId]/complete/route';
import { POST as claimRun } from './runs/[runId]/claim/route';
import { GET as getInventory } from '../../me/last-bell-inventory/route';

const RUN_ID = '00000000-0000-4000-8000-000000000001';

function request(path: string) {
  return new Request(`https://icons.example${path}`, { method: 'POST' });
}

function context() {
  return { params: Promise.resolve({ runId: RUN_ID }) };
}

describe('Last Bell authority API feature gate', () => {
  beforeEach(() => {
    mocks.enabled = false;
    mocks.config.mockClear();
    mocks.serviceConfig.mockClear();
    mocks.serviceClient.mockClear();
    mocks.readJson.mockReset();
    mocks.readJson.mockResolvedValue({});
    mocks.writeIdentity.mockReset();
    mocks.writeIdentity.mockResolvedValue({ userId: null });
  });

  it('fails closed before parsing, authentication, or service-role access on every authority endpoint', async () => {
    const responses = await Promise.all([
      startRun(request('/api/experiences/last-bell/runs')),
      recordEvent(request(`/api/experiences/last-bell/runs/${RUN_ID}/events`), context()),
      completeRun(request(`/api/experiences/last-bell/runs/${RUN_ID}/complete`), context()),
      claimRun(request(`/api/experiences/last-bell/runs/${RUN_ID}/claim`), context()),
      getInventory(),
    ]);

    for (const response of responses) {
      expect(response.status).toBe(404);
      await expect(response.json()).resolves.toEqual({ error: { code: 'not_found' } });
    }
    expect(mocks.config).not.toHaveBeenCalled();
    expect(mocks.serviceConfig).not.toHaveBeenCalled();
    expect(mocks.serviceClient).not.toHaveBeenCalled();
  });

  it('uses the shared account write preflight before an account start or guest claim reaches service role', async () => {
    mocks.enabled = true;
    mocks.writeIdentity.mockResolvedValue({
      error: { status: 403, code: 'account_suspended' },
    });

    const start = await startRun(request('/api/experiences/last-bell/runs'));
    const claim = await claimRun(request(`/api/experiences/last-bell/runs/${RUN_ID}/claim`), context());

    expect(start.status).toBe(403);
    await expect(start.json()).resolves.toEqual({ error: { code: 'account_suspended' } });
    expect(claim.status).toBe(403);
    await expect(claim.json()).resolves.toEqual({ error: { code: 'account_suspended' } });
    expect(mocks.writeIdentity).toHaveBeenNthCalledWith(1);
    expect(mocks.writeIdentity).toHaveBeenNthCalledWith(2, true);
    expect(mocks.serviceClient).not.toHaveBeenCalled();
  });
});
