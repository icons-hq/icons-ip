import { afterEach, describe, expect, it, vi } from 'vitest';
import { createResendEmailProvider } from './resend-provider.server';

const input = {
  intentId: '9b15cb25-98d8-4d9b-84e9-128e421430f5',
  idempotencyKey: 'email/9b15cb25-98d8-4d9b-84e9-128e421430f5',
  recipient: 'member@example.test',
  message: {
    subject: '계정 확인',
    text: '확인 코드는 123456입니다.',
    html: '<p>확인 코드는 123456입니다.</p>',
  },
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('Resend email provider adapter', () => {
  it('uses the durable intent key and treats the HTTP response as acceptance only', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(
      JSON.stringify({ id: 'provider-message-1' }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    ));
    vi.stubGlobal('fetch', fetchMock);
    const provider = createResendEmailProvider({
      apiKey: 'server-only-key',
      from: 'ICONS <no-reply@iconsip.com>',
      replyTo: 'help@iconsip.com',
      endpoint: 'https://api.resend.test/emails',
    });

    await expect(provider.send(input)).resolves.toEqual({
      kind: 'accepted',
      providerReference: 'provider-message-1',
    });

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.resend.test/emails');
    expect(init.headers).toEqual(expect.objectContaining({
      Authorization: 'Bearer server-only-key',
      'Content-Type': 'application/json',
      'Idempotency-Key': input.idempotencyKey,
    }));
    expect(JSON.parse(String(init.body))).toEqual({
      from: 'ICONS <no-reply@iconsip.com>',
      to: ['member@example.test'],
      reply_to: 'help@iconsip.com',
      subject: '계정 확인',
      text: '확인 코드는 123456입니다.',
      html: '<p>확인 코드는 123456입니다.</p>',
    });
  });

  it.each([
    [409, { name: 'concurrent_idempotent_requests' }, { kind: 'retryable_failure' }],
    [409, { name: 'invalid_idempotent_request' }, { kind: 'permanent_failure' }],
    [429, { name: 'rate_limit_exceeded' }, { kind: 'retryable_failure' }],
    [422, { name: 'invalid_to_address' }, { kind: 'permanent_failure' }],
  ])('classifies HTTP %s without exposing the provider response', async (status, body, outcome) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(
      JSON.stringify({ ...body, message: 'contains member@example.test' }),
      { status, headers: { 'Content-Type': 'application/json' } },
    )));
    const provider = createResendEmailProvider({
      apiKey: 'server-only-key', from: 'ICONS <no-reply@iconsip.com>',
    });

    await expect(provider.send(input)).resolves.toEqual(outcome);
  });

  it('treats a network timeout as ambiguous because Resend may have accepted it', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('recipient leaked here')));
    const provider = createResendEmailProvider({
      apiKey: 'server-only-key', from: 'ICONS <no-reply@iconsip.com>',
    });

    await expect(provider.send(input)).resolves.toEqual({ kind: 'ambiguous_failure' });
  });

  it('reserves Hook budget by aborting the provider request before five seconds', async () => {
    const timeoutSpy = vi.spyOn(AbortSignal, 'timeout');
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new DOMException('aborted', 'AbortError')));
    const provider = createResendEmailProvider({
      apiKey: 'server-only-key', from: 'ICONS <no-reply@iconsip.com>',
    });

    await expect(provider.send(input)).resolves.toEqual({ kind: 'ambiguous_failure' });
    expect(timeoutSpy).toHaveBeenCalledWith(2_500);
  });
});
