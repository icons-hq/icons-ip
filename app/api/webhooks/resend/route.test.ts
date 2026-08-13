import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { POST } from './route';

const mocks = vi.hoisted(() => ({
  verify: vi.fn(),
  runtime: vi.fn(),
  reduce: vi.fn(),
}));

vi.mock('@/lib/email/signatures.server', () => ({ verifyResendWebhook: mocks.verify }));
vi.mock('@/lib/email/dispatcher.server', () => ({
  emailProviderEventReducerFromEnvironment: mocks.runtime,
}));

const RAW_BODY = '{"type":"email.delivered","created_at":"2026-08-13T13:00:00.000Z","data":{"email_id":"provider-message-1","to":["do-not-store@example.test"],"subject":"do not store"}}';

function request(body = RAW_BODY) {
  return new Request('https://icons.local/api/webhooks/resend', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'svix-id': 'svix-event-1',
      'svix-timestamp': '123',
      'svix-signature': 'v1,signature',
    },
    body,
  });
}

function oversizedStreamRequest() {
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new Uint8Array(32 * 1024).fill(0x61));
      controller.enqueue(new Uint8Array(32 * 1024 + 1).fill(0x62));
      controller.close();
    },
  });
  return new Request('https://icons.local/api/webhooks/resend', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'svix-id': 'svix-event-1',
      'svix-timestamp': '123',
      'svix-signature': 'v1,signature',
    },
    body,
    duplex: 'half',
  } as RequestInit & { duplex: 'half' });
}

describe('POST /api/webhooks/resend', () => {
  beforeEach(() => {
    vi.stubEnv('RESEND_WEBHOOK_SECRET', 'whsec_test');
    mocks.verify.mockReset().mockReturnValue(JSON.parse(RAW_BODY));
    mocks.reduce.mockReset().mockResolvedValue({
      kind: 'reduced',
      intentId: '9b15cb25-98d8-4d9b-84e9-128e421430f5',
      state: 'delivered',
    });
    mocks.runtime.mockReset().mockReturnValue({
      reduceProviderEvent: mocks.reduce,
    });
  });

  afterEach(() => vi.unstubAllEnvs());

  it('verifies raw bytes and reduces only the PII-free event projection', async () => {
    const response = await POST(request());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true });
    expect(response.headers.get('cache-control')).toBe('private, no-store, max-age=0');
    expect(mocks.verify).toHaveBeenCalledWith(RAW_BODY, expect.any(Headers), 'whsec_test');
    expect(mocks.reduce).toHaveBeenCalledWith({
      svixId: 'svix-event-1',
      providerReference: 'provider-message-1',
      type: 'delivered',
      occurredAt: '2026-08-13T13:00:00.000Z',
    });
  });

  it('acknowledges signed non-lifecycle events without persistence', async () => {
    mocks.verify.mockReturnValue({
      type: 'email.opened', created_at: '2026-08-13T13:01:00.000Z',
      data: { email_id: 'provider-message-1' },
    });

    const response = await POST(request('{"type":"email.opened"}'));

    expect(response.status).toBe(200);
    expect(mocks.reduce).not.toHaveBeenCalled();
  });

  it('returns a stable error and performs no DB write for an invalid signature', async () => {
    mocks.verify.mockImplementation(() => { throw new Error('invalid_webhook_signature'); });

    const response = await POST(request());

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ ok: false });
    expect(mocks.reduce).not.toHaveBeenCalled();
  });

  it('rejects an oversized signed body from content-length before signature work', async () => {
    const oversized = request();
    oversized.headers.set('content-length', String(64 * 1024 + 1));

    const response = await POST(oversized);

    expect(response.status).toBe(413);
    await expect(response.json()).resolves.toEqual({ ok: false });
    expect(mocks.verify).not.toHaveBeenCalled();
    expect(mocks.reduce).not.toHaveBeenCalled();
  });

  it('stops a chunked signed body once the streamed bytes exceed the limit', async () => {
    const response = await POST(oversizedStreamRequest());

    expect(response.status).toBe(413);
    await expect(response.json()).resolves.toEqual({ ok: false });
    expect(mocks.verify).not.toHaveBeenCalled();
    expect(mocks.reduce).not.toHaveBeenCalled();
  });

  it('returns 503 so Resend retries when durable reduction fails', async () => {
    mocks.reduce.mockRejectedValue(new Error('private DB error containing data'));

    const response = await POST(request());

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({ ok: false });
  });
});
