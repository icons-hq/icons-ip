import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  emailDispatcherFromEnvironment,
  emailProviderEventReducerFromEnvironment,
} from './dispatcher.server';

const mocks = vi.hoisted(() => ({
  getServiceRoleConfig: vi.fn(),
  getHmacConfig: vi.fn(),
  repository: {
    enqueue: vi.fn(),
    enqueueAll: vi.fn(),
    claimDispatch: vi.fn(),
    recordAccepted: vi.fn(),
    recordDispatchFailure: vi.fn(),
    reduceProviderEvent: vi.fn(),
  },
  provider: { send: vi.fn() },
  providerFromEnvironment: vi.fn(),
}));

vi.mock('@/lib/supabase/service', () => ({
  getServiceRoleConfig: mocks.getServiceRoleConfig,
}));
vi.mock('./supabase-dispatcher-repository.server', () => ({
  getEmailDispatchHmacConfig: mocks.getHmacConfig,
  createSupabaseEmailDispatcherRepository: () => mocks.repository,
}));
vi.mock('./resend-provider.server', () => ({
  resendEmailProviderFromEnvironment: mocks.providerFromEnvironment,
}));

describe('email dispatcher runtime composition', () => {
  beforeEach(() => {
    mocks.getServiceRoleConfig.mockReset().mockReturnValue({ isConfigured: true });
    mocks.getHmacConfig.mockReset().mockReturnValue({ isConfigured: true });
    mocks.providerFromEnvironment.mockReset().mockReturnValue(mocks.provider);
    mocks.repository.reduceProviderEvent.mockReset().mockResolvedValue({
      kind: 'unmatched', state: 'unknown',
    });
  });

  it('requires provider send credentials for the Send Email Hook dispatcher', () => {
    mocks.providerFromEnvironment.mockReturnValue(null);
    expect(emailDispatcherFromEnvironment()).toBeNull();
  });

  it('keeps the signed webhook reducer available during provider credential rotation', async () => {
    mocks.providerFromEnvironment.mockReturnValue(null);
    const reducer = emailProviderEventReducerFromEnvironment();

    expect(reducer).not.toBeNull();
    await reducer?.reduceProviderEvent({
      svixId: 'event-1', providerReference: 'email-1', type: 'delivered',
      occurredAt: '2026-08-13T13:00:00.000Z',
    });
    expect(mocks.repository.reduceProviderEvent).toHaveBeenCalledOnce();
  });
});
