import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createSupabaseEmailDispatcherRepository } from './supabase-dispatcher-repository.server';

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  createServiceClient: vi.fn(),
}));

vi.mock('@/lib/supabase/service', () => ({
  createServiceClient: mocks.createServiceClient,
}));

describe('Supabase EmailDispatcher repository adapter', () => {
  beforeEach(() => {
    vi.stubEnv('EMAIL_DISPATCH_HMAC_SECRET', 'test-email-dispatch-hmac-secret-32-bytes-minimum');
    mocks.rpc.mockReset();
    mocks.createServiceClient.mockReset();
    mocks.createServiceClient.mockReturnValue({ rpc: mocks.rpc });
  });

  afterEach(() => vi.unstubAllEnvs());

  it('enqueues intent and fence through one service-role RPC', async () => {
    mocks.rpc.mockResolvedValue({
      data: {
        kind: 'enqueued',
        intentId: '9b15cb25-98d8-4d9b-84e9-128e421430f5',
        idempotencyKey: 'email/9b15cb25-98d8-4d9b-84e9-128e421430f5',
        state: 'queued',
      },
      error: null,
    });
    const repository = createSupabaseEmailDispatcherRepository();

    await expect(repository.enqueue({
      source: 'auth_hook',
      sourceReference: 'signup:user:token',
      recipient: 'member@example.test',
      messageKind: 'auth_signup',
      contentRevision: 'auth_signup_v1',
    })).resolves.toEqual({
      kind: 'enqueued',
      intentId: '9b15cb25-98d8-4d9b-84e9-128e421430f5',
      idempotencyKey: 'email/9b15cb25-98d8-4d9b-84e9-128e421430f5',
      state: 'queued',
    });
    expect(mocks.rpc).toHaveBeenCalledWith('enqueue_email_intent', {
      target_source: 'auth_hook',
      target_source_reference_digest: '1ca19bf2fef0005b09d745dc0d49deaa41f5c18b60329c4036c485ac9a0035b2',
      target_recipient_digest: 'ca2561e07d9d6f9f221ba075121d3b87e3dc17ac3d305e0acb5fb080be50fd4e',
      target_message_kind: 'auth_signup',
      target_content_revision: 'auth_signup_v1',
    });
  });

  it('atomically enqueues a multi-recipient auth event through one batch RPC', async () => {
    mocks.rpc.mockResolvedValue({
      data: [
        {
          kind: 'enqueued', intentId: '9b15cb25-98d8-4d9b-84e9-128e421430f5',
          idempotencyKey: 'email/9b15cb25-98d8-4d9b-84e9-128e421430f5', state: 'queued',
        },
        {
          kind: 'enqueued', intentId: '7f7037a4-749d-4b02-8c62-62e40a8d15d7',
          idempotencyKey: 'email/7f7037a4-749d-4b02-8c62-62e40a8d15d7', state: 'queued',
        },
      ],
      error: null,
    });
    const repository = createSupabaseEmailDispatcherRepository();

    await expect(repository.enqueueAll([
      {
        source: 'auth_hook', sourceReference: 'email-change:user:current',
        recipient: 'current@example.test', messageKind: 'auth_email_change_current',
        contentRevision: 'auth_email_change_current_v1',
      },
      {
        source: 'auth_hook', sourceReference: 'email-change:user:new',
        recipient: 'new@example.test', messageKind: 'auth_email_change_new',
        contentRevision: 'auth_email_change_new_v1',
      },
    ])).resolves.toHaveLength(2);

    expect(mocks.rpc).toHaveBeenCalledOnce();
    expect(mocks.rpc).toHaveBeenCalledWith('enqueue_email_intent_batch', {
      target_intents: [
        {
          source: 'auth_hook',
          sourceReferenceDigest: '0fc4f029426cb597e801f432f43dae5fffe0293b24312a0eab19c4162002a98c',
          recipientDigest: '5b4983c7b401f7a605bc2da9c22e60282d9bac144fd2d550f5ce4576039e137f',
          messageKind: 'auth_email_change_current',
          contentRevision: 'auth_email_change_current_v1',
        },
        {
          source: 'auth_hook',
          sourceReferenceDigest: 'ba8bf63cde701afcd01938f36df94ecd1432b90c6dee0797adc24909d665c913',
          recipientDigest: 'f960198ae35d155809423e616256e14d5f75df2f7087141c1aff950439905a7b',
          messageKind: 'auth_email_change_new',
          contentRevision: 'auth_email_change_new_v1',
        },
      ],
    });
  });

  it('rejects an unexpected database envelope instead of guessing a state', async () => {
    mocks.rpc.mockResolvedValue({ data: { kind: 'ok', state: 'sent' }, error: null });
    const repository = createSupabaseEmailDispatcherRepository();

    await expect(repository.enqueue({
      source: 'auth_hook', sourceReference: 'source', recipient: 'member@example.test',
      messageKind: 'auth_signup', contentRevision: 'auth_signup_v1',
    })).rejects.toThrow('invalid_email_dispatcher_repository_response');
  });

  it('claims dispatch only through the recipient-verifying RPC', async () => {
    mocks.rpc.mockResolvedValue({
      data: {
        kind: 'claimed',
        intentId: '9b15cb25-98d8-4d9b-84e9-128e421430f5',
        idempotencyKey: 'email/9b15cb25-98d8-4d9b-84e9-128e421430f5',
      },
      error: null,
    });
    const repository = createSupabaseEmailDispatcherRepository();

    await expect(repository.claimDispatch({
      intentId: '9b15cb25-98d8-4d9b-84e9-128e421430f5',
      recipient: 'member@example.test',
    })).resolves.toEqual({
      kind: 'claimed',
      intentId: '9b15cb25-98d8-4d9b-84e9-128e421430f5',
      idempotencyKey: 'email/9b15cb25-98d8-4d9b-84e9-128e421430f5',
    });
    expect(mocks.rpc).toHaveBeenCalledWith('claim_email_intent_dispatch', {
      target_intent_id: '9b15cb25-98d8-4d9b-84e9-128e421430f5',
      target_recipient_digest: 'ca2561e07d9d6f9f221ba075121d3b87e3dc17ac3d305e0acb5fb080be50fd4e',
    });
  });

  it('records acceptance, failures and provider events without raw payloads', async () => {
    mocks.rpc
      .mockResolvedValueOnce({ data: { state: 'accepted' }, error: null })
      .mockResolvedValueOnce({ data: { state: 'unknown', retryable: true }, error: null })
      .mockResolvedValueOnce({
        data: {
          kind: 'reduced', state: 'delivered',
          intentId: '9b15cb25-98d8-4d9b-84e9-128e421430f5',
        },
        error: null,
      });
    const repository = createSupabaseEmailDispatcherRepository();

    await expect(repository.recordAccepted({
      intentId: '9b15cb25-98d8-4d9b-84e9-128e421430f5',
      providerReference: 'provider-message-1',
    })).resolves.toEqual({ state: 'accepted' });
    await expect(repository.recordDispatchFailure({
      intentId: '9b15cb25-98d8-4d9b-84e9-128e421430f5',
      failure: 'ambiguous',
    })).resolves.toEqual({ state: 'unknown', retryable: true });
    await expect(repository.reduceProviderEvent({
      svixId: 'svix-event-1',
      providerReference: 'provider-message-1',
      type: 'delivered',
      occurredAt: '2026-08-13T13:00:00.000Z',
    })).resolves.toEqual({
      kind: 'reduced', state: 'delivered',
      intentId: '9b15cb25-98d8-4d9b-84e9-128e421430f5',
    });

    expect(mocks.rpc.mock.calls).toEqual([
      ['record_email_intent_accepted', {
        target_intent_id: '9b15cb25-98d8-4d9b-84e9-128e421430f5',
        target_provider_reference_digest: '50044663547d90fb62ad326d130dca41bf8a00ca3151bba43a1640878f42db08',
      }],
      ['record_email_intent_dispatch_failure', {
        target_intent_id: '9b15cb25-98d8-4d9b-84e9-128e421430f5',
        target_failure: 'ambiguous',
      }],
      ['reduce_email_provider_event', {
        target_svix_id: 'svix-event-1',
        target_provider_reference_digest: '50044663547d90fb62ad326d130dca41bf8a00ca3151bba43a1640878f42db08',
        target_event_type: 'delivered',
        target_occurred_at: '2026-08-13T13:00:00.000Z',
      }],
    ]);
  });

  it('keeps lifecycle evidence that arrived before the acceptance response was stored', async () => {
    mocks.rpc.mockResolvedValue({ data: { state: 'delivered' }, error: null });
    const repository = createSupabaseEmailDispatcherRepository();

    await expect(repository.recordAccepted({
      intentId: '9b15cb25-98d8-4d9b-84e9-128e421430f5',
      providerReference: 'provider-message-1',
    })).resolves.toEqual({ state: 'delivered' });
  });

  it('keeps a durable needs-review response instead of retrying a reference conflict', async () => {
    mocks.rpc.mockResolvedValue({ data: { state: 'needs_review' }, error: null });
    const repository = createSupabaseEmailDispatcherRepository();

    await expect(repository.recordAccepted({
      intentId: '9b15cb25-98d8-4d9b-84e9-128e421430f5',
      providerReference: 'conflicting-provider-message',
    })).resolves.toEqual({ state: 'needs_review' });
  });
});
