import { afterEach, describe, expect, it, vi } from 'vitest';
import { createResendEmailProvider, resendEmailProviderFromEnvironment } from './resend-provider.server';

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
  vi.unstubAllEnvs();
});

describe('Resend production configuration', () => {
  const configure = (overrides: Record<string, string> = {}) => {
    for (const name of ['RESEND_API_KEY', 'RESEND_FROM', 'RESEND_REPLY_TO', 'RESEND_API_ENDPOINT',
      'EMAIL_PROVIDER_API_KEY', 'EMAIL_FROM', 'EMAIL_REPLY_TO', 'EMAIL_PROVIDER_ENDPOINT']) {
      vi.stubEnv(name, overrides[name] ?? '');
    }
  };

  it('uses the existing approved app sender without copying its sensitive key', async () => {
    configure({ EMAIL_PROVIDER_API_KEY: 'legacy-sending-key', EMAIL_FROM: 'ICONS <no-reply@iconsip.com>',
      EMAIL_REPLY_TO: 'help@iconsip.com' });
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ id: 'accepted-legacy' })));
    vi.stubGlobal('fetch', fetchMock);
    await expect(resendEmailProviderFromEnvironment()?.send(input)).resolves.toEqual({
      kind: 'accepted', providerReference: 'accepted-legacy',
    });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.resend.com/emails');
    expect(init.headers).toMatchObject({ Authorization: 'Bearer legacy-sending-key' });
    expect(JSON.parse(String(init.body))).toMatchObject({
      from: 'ICONS <no-reply@iconsip.com>', reply_to: 'help@iconsip.com',
    });
  });

  it('prefers a complete dedicated sender and keeps its reply address separate', async () => {
    configure({ RESEND_API_KEY: 'dedicated-key', RESEND_FROM: 'new@example.test',
      RESEND_API_ENDPOINT: 'https://provider.example.test/emails',
      EMAIL_PROVIDER_API_KEY: 'legacy-key', EMAIL_FROM: 'legacy@example.test', EMAIL_REPLY_TO: 'old@example.test' });
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ id: 'accepted-dedicated' })));
    vi.stubGlobal('fetch', fetchMock);
    await resendEmailProviderFromEnvironment()?.send(input);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://provider.example.test/emails');
    expect(init.headers).toMatchObject({ Authorization: 'Bearer dedicated-key' });
    const body = JSON.parse(String(init.body));
    expect(body.from).toBe('new@example.test');
    expect(body).not.toHaveProperty('reply_to');
  });

  it.each(['RESEND_API_KEY', 'RESEND_FROM', 'RESEND_REPLY_TO', 'RESEND_API_ENDPOINT'])(
    'rejects partial dedicated configuration instead of mixing %s with a legacy sender', (name) => {
      configure({ [name]: 'partial', EMAIL_PROVIDER_API_KEY: 'legacy-key', EMAIL_FROM: 'legacy@example.test' });
      expect(resendEmailProviderFromEnvironment()).toBeNull();
    },
  );

  it('does not use a legacy key configured for a different email provider', () => {
    configure({ EMAIL_PROVIDER_API_KEY: 'another-key', EMAIL_FROM: 'legacy@example.test',
      EMAIL_PROVIDER_ENDPOINT: 'https://another-provider.example.test/emails' });
    expect(resendEmailProviderFromEnvironment()).toBeNull();
  });
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
