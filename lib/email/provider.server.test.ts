import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getEmailProviderConfig, sendTransactionalEmail } from './provider.server';

const message = {
  to: 'buyer@example.com',
  subject: '[ICONS] 주문이 접수됐어요',
  text: '주문이 접수됐어요',
  html: '<p>주문이 접수됐어요</p>',
};

const ENV_KEYS = [
  'EMAIL_PROVIDER_API_KEY',
  'EMAIL_PROVIDER_ENDPOINT',
  'EMAIL_FROM',
  'EMAIL_REPLY_TO',
] as const;

const saved = new Map<string, string | undefined>();

beforeEach(() => {
  for (const key of ENV_KEYS) {
    saved.set(key, process.env[key]);
    delete process.env[key];
  }
  vi.spyOn(console, 'info').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    const value = saved.get(key);
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('getEmailProviderConfig', () => {
  it('발신 키와 발신 주소가 모두 있어야 설정된 것으로 본다', () => {
    expect(getEmailProviderConfig().isConfigured).toBe(false);

    process.env.EMAIL_PROVIDER_API_KEY = 'key';
    expect(getEmailProviderConfig().isConfigured).toBe(false);

    process.env.EMAIL_FROM = 'ICONS <no-reply@iconsip.com>';
    expect(getEmailProviderConfig().isConfigured).toBe(true);
  });
});

describe('sendTransactionalEmail', () => {
  it('환경변수가 없으면 발송을 건너뛰고 네트워크를 건드리지 않는다', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const result = await sendTransactionalEmail(message);

    expect(result.status).toBe('skipped');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('설정되면 provider 엔드포인트로 발신 정보와 본문을 보낸다', async () => {
    process.env.EMAIL_PROVIDER_API_KEY = 'key';
    process.env.EMAIL_FROM = 'ICONS <no-reply@iconsip.com>';
    process.env.EMAIL_REPLY_TO = 'help@iconsip.com';
    const fetchMock = vi.fn(async () => new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await sendTransactionalEmail(message);

    expect(result.status).toBe('sent');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.resend.com/emails');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer key');
    expect(JSON.parse(init.body as string)).toMatchObject({
      from: 'ICONS <no-reply@iconsip.com>',
      to: ['buyer@example.com'],
      reply_to: 'help@iconsip.com',
      subject: message.subject,
      html: message.html,
      text: message.text,
    });
  });

  it('엔드포인트를 env로 갈아끼울 수 있다', async () => {
    process.env.EMAIL_PROVIDER_API_KEY = 'key';
    process.env.EMAIL_FROM = 'ICONS <no-reply@iconsip.com>';
    process.env.EMAIL_PROVIDER_ENDPOINT = 'https://mail.example.com/v1/send';
    const fetchMock = vi.fn(async () => new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    await sendTransactionalEmail(message);

    const [url] = fetchMock.mock.calls[0] as unknown as [string];
    expect(url).toBe('https://mail.example.com/v1/send');
  });

  it('provider가 오류를 주면 실패로 보고하고 예외를 던지지 않는다', async () => {
    process.env.EMAIL_PROVIDER_API_KEY = 'key';
    process.env.EMAIL_FROM = 'ICONS <no-reply@iconsip.com>';
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{"message":"forbidden"}', { status: 403 })));

    const result = await sendTransactionalEmail(message);

    expect(result.status).toBe('failed');
    expect(result.status === 'failed' && result.error).toContain('403');
  });

  it('네트워크가 끊겨도 예외를 던지지 않는다', async () => {
    process.env.EMAIL_PROVIDER_API_KEY = 'key';
    process.env.EMAIL_FROM = 'ICONS <no-reply@iconsip.com>';
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new Error('boom');
    }));

    const result = await sendTransactionalEmail(message);

    expect(result.status).toBe('failed');
  });
});

describe('클라이언트 번들 노출 방지', () => {
  it('이메일 모듈은 NEXT_PUBLIC_ env를 읽지 않고 server-only를 선언한다', () => {
    for (const file of ['provider.server.ts', 'transactional.server.ts']) {
      const source = readFileSync(new URL(file, import.meta.url), 'utf8');
      expect(source).toContain("import 'server-only'");
      expect(source).not.toContain('NEXT_PUBLIC_');
    }
  });
});
