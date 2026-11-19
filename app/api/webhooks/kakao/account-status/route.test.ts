import { beforeEach, describe, expect, it, vi } from 'vitest';

/* 카카오 계정 상태 변경 웹훅 라우트. 판정은 lib/kakao/account-unlink.server.ts가 하고 라우트는 본문 한도·응답 형식만 맡는다. */

const mocks = vi.hoisted(() => ({ handle: vi.fn() }));

vi.mock('@/lib/kakao/account-unlink.server', () => ({ handleKakaoAccountStatusWebhook: mocks.handle }));

const { POST } = await import('./route');

function post(body: string) {
  return POST(new Request('https://iconsip.com/api/webhooks/kakao/account-status', {
    method: 'POST',
    body,
    headers: { 'content-type': 'application/secevent+jwt' },
  }));
}

beforeEach(() => {
  mocks.handle.mockReset();
});

describe('POST /api/webhooks/kakao/account-status', () => {
  it('passes the raw SET through and answers 202 without a body', async () => {
    mocks.handle.mockResolvedValue({ status: 202 });

    const response = await post('header.payload.signature');
    expect(response.status).toBe(202);
    expect(await response.text()).toBe('');
    expect(response.headers.get('cache-control')).toBe('private, no-store, max-age=0');
    expect(mocks.handle).toHaveBeenCalledWith({ body: 'header.payload.signature' });
  });

  it('answers verification failures as RFC 8935 JSON', async () => {
    mocks.handle.mockResolvedValue({ status: 400, body: { err: 'invalid_key', description: 'Signature verification failed.' } });

    const response = await post('x.y.z');
    expect(response.status).toBe(400);
    expect(response.headers.get('content-type')).toContain('application/json');
    expect(await response.json()).toEqual({ err: 'invalid_key', description: 'Signature verification failed.' });
  });

  it.each([404, 500])('answers %s without a body', async (status) => {
    mocks.handle.mockResolvedValue({ status });

    const response = await post('x.y.z');
    expect(response.status).toBe(status);
    expect(await response.text()).toBe('');
  });

  it('refuses an oversized body before verifying', async () => {
    const response = await post('x'.repeat(17 * 1024));
    expect(response.status).toBe(413);
    expect(mocks.handle).not.toHaveBeenCalled();
  });
});
