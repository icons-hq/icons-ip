import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { POST } from './route';

const mocks = vi.hoisted(() => ({
  verify: vi.fn(),
  plan: vi.fn(),
  runtime: vi.fn(),
  enqueue: vi.fn(),
  enqueueAll: vi.fn(),
  dispatch: vi.fn(),
}));

vi.mock('@/lib/email/signatures.server', () => ({
  verifySupabaseEmailHook: mocks.verify,
}));
vi.mock('@/lib/email/auth-hook', () => ({
  planAuthHookEmails: mocks.plan,
}));
vi.mock('@/lib/email/dispatcher.server', () => ({
  emailDispatcherFromEnvironment: mocks.runtime,
}));

const RAW_BODY = '{"signed":"payload","order":[2,1]}';
const plan = {
  source: 'auth_hook' as const,
  sourceReference: 'signup:user:token:primary',
  recipient: 'member@example.test',
  messageKind: 'auth_signup' as const,
  contentRevision: 'auth_signup_v1',
  message: { subject: '확인', text: '확인', html: '<p>확인</p>' },
};

function request() {
  return new Request('https://icons.local/api/hooks/supabase/send-email', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'webhook-id': 'hook-1',
      'webhook-timestamp': '123',
      'webhook-signature': 'v1,signature',
    },
    body: RAW_BODY,
  });
}

describe('POST /api/hooks/supabase/send-email', () => {
  beforeEach(() => {
    vi.stubEnv('SUPABASE_SEND_EMAIL_HOOK_SECRET', 'v1,whsec_test');
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://project.supabase.co');
    mocks.verify.mockReset().mockReturnValue({ signed: 'payload' });
    mocks.plan.mockReset().mockReturnValue([plan]);
    mocks.enqueue.mockReset().mockResolvedValue({
      kind: 'enqueued', intentId: '9b15cb25-98d8-4d9b-84e9-128e421430f5',
      idempotencyKey: 'email/9b15cb25-98d8-4d9b-84e9-128e421430f5', state: 'queued',
    });
    mocks.enqueueAll.mockReset().mockResolvedValue([{
      kind: 'enqueued', intentId: '9b15cb25-98d8-4d9b-84e9-128e421430f5',
      idempotencyKey: 'email/9b15cb25-98d8-4d9b-84e9-128e421430f5', state: 'queued',
    }]);
    mocks.dispatch.mockReset().mockResolvedValue({ kind: 'accepted', state: 'accepted' });
    mocks.runtime.mockReset().mockReturnValue({
      enqueue: mocks.enqueue,
      enqueueAll: mocks.enqueueAll,
      dispatch: mocks.dispatch,
      reduceProviderEvent: vi.fn(),
    });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('verifies raw bytes, persists the intent/fence, then dispatches', async () => {
    const response = await POST(request());

    expect(response.status).toBe(200);
    await expect(response.text()).resolves.toBe('');
    expect(response.headers.get('cache-control')).toBe('private, no-store, max-age=0');
    expect(mocks.verify).toHaveBeenCalledWith(
      RAW_BODY,
      expect.any(Headers),
      'v1,whsec_test',
    );
    expect(mocks.plan).toHaveBeenCalledWith(
      { signed: 'payload' },
      { supabaseUrl: 'https://project.supabase.co' },
    );
    expect(mocks.enqueueAll).toHaveBeenCalledWith([{
      source: plan.source,
      sourceReference: plan.sourceReference,
      recipient: plan.recipient,
      messageKind: plan.messageKind,
      contentRevision: plan.contentRevision,
    }]);
    expect(mocks.dispatch).toHaveBeenCalledWith({
      intentId: '9b15cb25-98d8-4d9b-84e9-128e421430f5',
      recipient: plan.recipient,
      message: plan.message,
    });
    expect(mocks.enqueueAll.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.dispatch.mock.invocationCallOrder[0],
    );
  });

  it('fails closed before parsing when the signature is invalid', async () => {
    mocks.verify.mockImplementation(() => { throw new Error('invalid_webhook_signature'); });

    const response = await POST(request());

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({
      error: { http_code: 401, message: 'invalid_hook_request' },
    });
    expect(mocks.plan).not.toHaveBeenCalled();
    expect(mocks.enqueueAll).not.toHaveBeenCalled();
  });

  it('durably enqueues both secure-email-change fences before either send starts', async () => {
    const second = {
      ...plan,
      sourceReference: 'email-change:user:new',
      recipient: 'new@example.test',
      messageKind: 'auth_email_change_new' as const,
      contentRevision: 'auth_email_change_new_v1',
    };
    mocks.plan.mockReturnValue([plan, second]);
    mocks.enqueueAll.mockResolvedValue([
      {
        kind: 'enqueued', intentId: '9b15cb25-98d8-4d9b-84e9-128e421430f5',
        idempotencyKey: 'email/9b15cb25-98d8-4d9b-84e9-128e421430f5', state: 'queued',
      },
      {
        kind: 'enqueued', intentId: '7f7037a4-749d-4b02-8c62-62e40a8d15d7',
        idempotencyKey: 'email/7f7037a4-749d-4b02-8c62-62e40a8d15d7', state: 'queued',
      },
    ]);

    const response = await POST(request());

    expect(response.status).toBe(200);
    expect(mocks.enqueueAll).toHaveBeenCalledOnce();
    expect(mocks.enqueueAll).toHaveBeenCalledWith([
      expect.objectContaining({ recipient: plan.recipient }),
      expect.objectContaining({ recipient: second.recipient }),
    ]);
    expect(mocks.enqueueAll.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.dispatch.mock.invocationCallOrder[0],
    );
    expect(mocks.dispatch).toHaveBeenNthCalledWith(2, {
      intentId: '7f7037a4-749d-4b02-8c62-62e40a8d15d7',
      recipient: second.recipient,
      message: second.message,
    });
  });

  it('starts both durable email-change sends within one Hook time budget', async () => {
    const second = {
      ...plan,
      sourceReference: 'email-change:user:new',
      recipient: 'new@example.test',
      messageKind: 'auth_email_change_new' as const,
      contentRevision: 'auth_email_change_new_v1',
    };
    mocks.plan.mockReturnValue([plan, second]);
    mocks.enqueueAll.mockResolvedValue([
      {
        kind: 'enqueued', intentId: '9b15cb25-98d8-4d9b-84e9-128e421430f5',
        idempotencyKey: 'email/9b15cb25-98d8-4d9b-84e9-128e421430f5', state: 'queued',
      },
      {
        kind: 'enqueued', intentId: '7f7037a4-749d-4b02-8c62-62e40a8d15d7',
        idempotencyKey: 'email/7f7037a4-749d-4b02-8c62-62e40a8d15d7', state: 'queued',
      },
    ]);
    let release: (() => void) | undefined;
    const blocked = new Promise<void>((resolve) => { release = resolve; });
    mocks.dispatch.mockImplementation(async () => {
      await blocked;
      return { kind: 'accepted', state: 'accepted' };
    });

    const pending = POST(request());
    await vi.waitFor(() => expect(mocks.dispatch).toHaveBeenCalledTimes(2));
    release?.();

    await expect(pending).resolves.toMatchObject({ status: 200 });
  });

  it('returns retryable failure without provider details while the DB gate is off', async () => {
    mocks.dispatch.mockResolvedValue({ kind: 'skipped', reason: 'disabled', state: 'queued' });

    const response = await POST(request());

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      error: { http_code: 503, message: 'email_dispatch_unavailable' },
    });
  });
});
