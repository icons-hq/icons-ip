import { describe, expect, it, vi } from 'vitest';
import {
  createEmailDispatcher,
  type EmailDeliveryState,
  type EmailDispatcherRepository,
  type EmailProvider,
  type ProviderAcceptedState,
} from './dispatcher';

const INTENT_ID = '9b15cb25-98d8-4d9b-84e9-128e421430f5';
const CLAIM_ID = '2decd9f6-7ebf-4b47-9392-d6658bf530ad';

function repository(overrides: Partial<EmailDispatcherRepository> = {}): EmailDispatcherRepository {
  return {
    enqueue: vi.fn().mockResolvedValue({
      kind: 'enqueued',
      intentId: INTENT_ID,
      idempotencyKey: `email/${INTENT_ID}`,
      state: 'queued',
    }),
    enqueueAll: vi.fn().mockResolvedValue([{
      kind: 'enqueued', intentId: INTENT_ID,
      idempotencyKey: `email/${INTENT_ID}`, state: 'queued',
    }]),
    claimDispatch: vi.fn().mockResolvedValue({
      kind: 'claimed',
      intentId: INTENT_ID,
      claimId: CLAIM_ID,
      idempotencyKey: `email/${INTENT_ID}`,
    }),
    recordAccepted: vi.fn().mockResolvedValue({ state: 'accepted' }),
    recoverAcceptedPersistence: vi.fn().mockResolvedValue({ kind: 'released', state: 'unknown' }),
    recordDispatchFailure: vi.fn().mockResolvedValue({ state: 'unknown', retryable: true }),
    reduceProviderEvent: vi.fn().mockResolvedValue({
      kind: 'reduced', state: 'delivered', intentId: INTENT_ID,
    }),
    ...overrides,
  };
}

function provider(overrides: Partial<EmailProvider> = {}): EmailProvider {
  return {
    send: vi.fn().mockResolvedValue({ kind: 'accepted', providerReference: 'provider-message-1' }),
    ...overrides,
  };
}

describe('EmailDispatcher.enqueue', () => {
  it('durably creates the intent and fence through one repository operation', async () => {
    const repo = repository();
    const dispatcher = createEmailDispatcher({ repository: repo, provider: provider() });

    await expect(dispatcher.enqueue({
      source: 'auth_hook',
      sourceReference: 'signup:user-ref:token-ref',
      recipient: 'member@example.test',
      messageKind: 'auth_signup',
      contentRevision: 'auth_signup_v1',
    })).resolves.toEqual({
      kind: 'enqueued',
      intentId: INTENT_ID,
      idempotencyKey: `email/${INTENT_ID}`,
      state: 'queued',
    });

    expect(repo.enqueue).toHaveBeenCalledOnce();
    expect(repo.enqueue).toHaveBeenCalledWith({
      source: 'auth_hook',
      sourceReference: 'signup:user-ref:token-ref',
      recipient: 'member@example.test',
      messageKind: 'auth_signup',
      contentRevision: 'auth_signup_v1',
    });
  });

  it('preserves repository atomicity for a multi-message auth event', async () => {
    const repo = repository();
    const dispatcher = createEmailDispatcher({ repository: repo, provider: provider() });
    const inputs = [{
      source: 'auth_hook' as const,
      sourceReference: 'email-change:user:current',
      recipient: 'current@example.test',
      messageKind: 'auth_email_change_current' as const,
      contentRevision: 'auth_email_change_current_v1',
    }];

    await dispatcher.enqueueAll(inputs);

    expect(repo.enqueueAll).toHaveBeenCalledWith(inputs);
  });
});

describe('EmailDispatcher.dispatch', () => {
  it('records provider acceptance without claiming delivery', async () => {
    const repo = repository();
    const emailProvider = provider();
    const dispatcher = createEmailDispatcher({ repository: repo, provider: emailProvider });

    await expect(dispatcher.dispatch({
      intentId: INTENT_ID,
      recipient: 'member@example.test',
      message: {
        subject: '계정 확인',
        text: '확인 코드는 123456입니다.',
        html: '<p>확인 코드는 123456입니다.</p>',
      },
    })).resolves.toEqual({ kind: 'accepted', state: 'accepted' });

    expect(emailProvider.send).toHaveBeenCalledWith({
      intentId: INTENT_ID,
      idempotencyKey: `email/${INTENT_ID}`,
      recipient: 'member@example.test',
      message: {
        subject: '계정 확인',
        text: '확인 코드는 123456입니다.',
        html: '<p>확인 코드는 123456입니다.</p>',
      },
    });
    expect(repo.recordAccepted).toHaveBeenCalledWith({
      intentId: INTENT_ID,
      providerReference: 'provider-message-1',
    });
  });

  it('returns stronger signed lifecycle evidence reconciled during acceptance', async () => {
    const repo = repository({
      recordAccepted: vi.fn().mockResolvedValue({ state: 'delivered' }),
    });
    const dispatcher = createEmailDispatcher({ repository: repo, provider: provider() });

    await expect(dispatcher.dispatch({
      intentId: INTENT_ID,
      recipient: 'member@example.test',
      message: { subject: '계정 확인', text: '확인', html: '<p>확인</p>' },
    })).resolves.toEqual({ kind: 'accepted', state: 'delivered' });
  });

  it('stops automatic retry when the provider reference conflicts', async () => {
    const repo = repository({
      recordAccepted: vi.fn().mockResolvedValue({ state: 'needs_review' }),
    });
    const dispatcher = createEmailDispatcher({ repository: repo, provider: provider() });

    await expect(dispatcher.dispatch({
      intentId: INTENT_ID,
      recipient: 'member@example.test',
      message: { subject: '확인', text: '확인', html: '<p>확인</p>' },
    })).resolves.toEqual({ kind: 'needs_review', state: 'needs_review' });
  });

  it('releases a lost acceptance write so an immediate Hook replay reuses the same idempotency key', async () => {
    const claimDispatch = vi.fn()
      .mockResolvedValueOnce({
        kind: 'claimed', intentId: INTENT_ID, claimId: CLAIM_ID,
        idempotencyKey: `email/${INTENT_ID}`,
      })
      .mockResolvedValueOnce({
        kind: 'claimed', intentId: INTENT_ID,
        claimId: 'eff6f95a-d8ee-4ac7-b449-2e8877444b83',
        idempotencyKey: `email/${INTENT_ID}`,
      });
    const repo = repository({
      claimDispatch,
      recordAccepted: vi.fn().mockRejectedValue(new Error('database unavailable')),
    });
    const emailProvider = provider();
    const dispatcher = createEmailDispatcher({ repository: repo, provider: emailProvider });

    const input = {
      intentId: INTENT_ID,
      recipient: 'member@example.test',
      message: { subject: '확인', text: '확인', html: '<p>확인</p>' },
    };

    await expect(dispatcher.dispatch(input)).resolves.toEqual({ kind: 'retry', state: 'unknown' });
    await expect(dispatcher.dispatch(input)).resolves.toEqual({ kind: 'retry', state: 'unknown' });

    expect(repo.recoverAcceptedPersistence).toHaveBeenNthCalledWith(1, {
      intentId: INTENT_ID,
      claimId: CLAIM_ID,
    });
    expect(emailProvider.send).toHaveBeenCalledTimes(2);
    expect(emailProvider.send).toHaveBeenNthCalledWith(1, expect.objectContaining({
      idempotencyKey: `email/${INTENT_ID}`,
    }));
    expect(emailProvider.send).toHaveBeenNthCalledWith(2, expect.objectContaining({
      idempotencyKey: `email/${INTENT_ID}`,
    }));
  });

  it('does not overwrite acceptance that committed before the database response was lost', async () => {
    const repo = repository({
      recordAccepted: vi.fn().mockRejectedValue(new Error('response lost after commit')),
      recoverAcceptedPersistence: vi.fn().mockResolvedValue({
        kind: 'preserved', state: 'accepted',
      }),
    });
    const emailProvider = provider();
    const dispatcher = createEmailDispatcher({ repository: repo, provider: emailProvider });

    await expect(dispatcher.dispatch({
      intentId: INTENT_ID,
      recipient: 'member@example.test',
      message: { subject: '확인', text: '확인', html: '<p>확인</p>' },
    })).resolves.toEqual({ kind: 'accepted', state: 'accepted' });

    expect(repo.recoverAcceptedPersistence).toHaveBeenCalledWith({
      intentId: INTENT_ID,
      claimId: CLAIM_ID,
    });
    expect(emailProvider.send).toHaveBeenCalledOnce();
  });

  it.each<ProviderAcceptedState>([
    'accepted', 'sent', 'delivered', 'delayed', 'bounced',
    'complained', 'suppressed', 'failed',
  ])('acknowledges a preserved %s lifecycle after an acceptance response loss', async (state) => {
    const repo = repository({
      recordAccepted: vi.fn().mockRejectedValue(new Error('response lost after commit')),
      recoverAcceptedPersistence: vi.fn().mockResolvedValue({ kind: 'preserved', state }),
    });
    const dispatcher = createEmailDispatcher({ repository: repo, provider: provider() });

    await expect(dispatcher.dispatch({
      intentId: INTENT_ID,
      recipient: 'member@example.test',
      message: { subject: '확인', text: '확인', html: '<p>확인</p>' },
    })).resolves.toEqual({ kind: 'accepted', state });
  });

  it.each<EmailDeliveryState>(['queued', 'unknown', 'dispatching'])(
    'retries when acceptance recovery preserves non-terminal %s state',
    async (state) => {
      const repo = repository({
        recordAccepted: vi.fn().mockRejectedValue(new Error('acceptance persistence failed')),
        recoverAcceptedPersistence: vi.fn().mockResolvedValue({ kind: 'preserved', state }),
      });
      const dispatcher = createEmailDispatcher({ repository: repo, provider: provider() });

      await expect(dispatcher.dispatch({
        intentId: INTENT_ID,
        recipient: 'member@example.test',
        message: { subject: '확인', text: '확인', html: '<p>확인</p>' },
      })).resolves.toEqual({ kind: 'retry', state: 'unknown' });
    },
  );

  it('stops retries when acceptance recovery preserves needs_review', async () => {
    const repo = repository({
      recordAccepted: vi.fn().mockRejectedValue(new Error('acceptance persistence failed')),
      recoverAcceptedPersistence: vi.fn().mockResolvedValue({
        kind: 'preserved', state: 'needs_review',
      }),
    });
    const dispatcher = createEmailDispatcher({ repository: repo, provider: provider() });

    await expect(dispatcher.dispatch({
      intentId: INTENT_ID,
      recipient: 'member@example.test',
      message: { subject: '확인', text: '확인', html: '<p>확인</p>' },
    })).resolves.toEqual({ kind: 'needs_review', state: 'needs_review' });
  });

  it('returns retry and leaves the lease fallback intact when recovery also fails', async () => {
    const repo = repository({
      recordAccepted: vi.fn().mockRejectedValue(new Error('acceptance persistence failed')),
      recoverAcceptedPersistence: vi.fn().mockRejectedValue(new Error('recovery persistence failed')),
    });
    const dispatcher = createEmailDispatcher({ repository: repo, provider: provider() });

    await expect(dispatcher.dispatch({
      intentId: INTENT_ID,
      recipient: 'member@example.test',
      message: { subject: '확인', text: '확인', html: '<p>확인</p>' },
    })).resolves.toEqual({ kind: 'retry', state: 'unknown' });

    expect(repo.recoverAcceptedPersistence).toHaveBeenCalledWith({
      intentId: INTENT_ID,
      claimId: CLAIM_ID,
    });
  });

  it('does not contact the provider while the database activation gate is off', async () => {
    const repo = repository({
      claimDispatch: vi.fn().mockResolvedValue({ kind: 'disabled', state: 'queued' }),
    });
    const emailProvider = provider();
    const dispatcher = createEmailDispatcher({ repository: repo, provider: emailProvider });

    await expect(dispatcher.dispatch({
      intentId: INTENT_ID,
      recipient: 'member@example.test',
      message: { subject: '확인', text: '확인', html: '<p>확인</p>' },
    })).resolves.toEqual({ kind: 'skipped', reason: 'disabled', state: 'queued' });
    expect(emailProvider.send).not.toHaveBeenCalled();
  });

  it('preserves an ambiguous timeout for an idempotent Hook retry', async () => {
    const repo = repository();
    const dispatcher = createEmailDispatcher({
      repository: repo,
      provider: provider({ send: vi.fn().mockResolvedValue({ kind: 'ambiguous_failure' }) }),
    });

    await expect(dispatcher.dispatch({
      intentId: INTENT_ID,
      recipient: 'member@example.test',
      message: { subject: '확인', text: '확인', html: '<p>확인</p>' },
    })).resolves.toEqual({ kind: 'retry', state: 'unknown' });
    expect(repo.recordDispatchFailure).toHaveBeenCalledWith({
      intentId: INTENT_ID,
      failure: 'ambiguous',
    });
  });

  it('stops automatic retry after a permanent provider rejection', async () => {
    const repo = repository({
      recordDispatchFailure: vi.fn().mockResolvedValue({
        state: 'needs_review', retryable: false,
      }),
    });
    const dispatcher = createEmailDispatcher({
      repository: repo,
      provider: provider({ send: vi.fn().mockResolvedValue({ kind: 'permanent_failure' }) }),
    });

    await expect(dispatcher.dispatch({
      intentId: INTENT_ID,
      recipient: 'member@example.test',
      message: { subject: '확인', text: '확인', html: '<p>확인</p>' },
    })).resolves.toEqual({ kind: 'needs_review', state: 'needs_review' });
    expect(repo.recordDispatchFailure).toHaveBeenCalledWith({
      intentId: INTENT_ID,
      failure: 'permanent',
    });
  });
});

describe('EmailDispatcher.reduceProviderEvent', () => {
  it('delegates a PII-free event to the durable out-of-order reducer', async () => {
    const repo = repository();
    const dispatcher = createEmailDispatcher({ repository: repo, provider: provider() });
    const input = {
      svixId: 'msg_event_1',
      providerReference: 'provider-message-1',
      type: 'delivered' as const,
      occurredAt: '2026-08-13T13:00:00.000Z',
    };

    await expect(dispatcher.reduceProviderEvent(input)).resolves.toEqual({
      kind: 'reduced', state: 'delivered', intentId: INTENT_ID,
    });
    expect(repo.reduceProviderEvent).toHaveBeenCalledWith(input);
  });
});
