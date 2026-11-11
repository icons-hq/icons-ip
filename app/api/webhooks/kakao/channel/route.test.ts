import { beforeEach, describe, expect, it, vi } from 'vitest';

/* 1014-014 — 카카오톡 채널 웹훅 라우트. 판정은 lib/kakao/channel-reward.server.ts가 하고 라우트는 본문 한도·after만 맡는다. */

const mocks = vi.hoisted(() => ({
  after: vi.fn(),
  handle: vi.fn(),
}));

vi.mock('next/server', () => ({ after: mocks.after }));
vi.mock('@/lib/kakao/channel-reward.server', () => ({ handleKakaoChannelWebhook: mocks.handle }));

const { POST } = await import('./route');

function post(body: string, headers: Record<string, string> = {}) {
  return POST(new Request('https://iconsip.com/api/webhooks/kakao/channel', { method: 'POST', body, headers }));
}

beforeEach(() => {
  mocks.after.mockReset();
  mocks.handle.mockReset();
});

describe('POST /api/webhooks/kakao/channel', () => {
  it('answers 404 while the switch is off', async () => {
    mocks.handle.mockReturnValue({ status: 404 });

    const response = await post('{}', { authorization: 'KakaoAK key' });
    expect(response.status).toBe(404);
    expect(mocks.handle).toHaveBeenCalledWith({ authorization: 'KakaoAK key', body: '{}' });
    expect(mocks.after).not.toHaveBeenCalled();
  });

  it('answers first and runs the friendship check after the response', async () => {
    const work = vi.fn(async () => 'granted');
    mocks.handle.mockReturnValue({ status: 200, work });

    const response = await post('{"event":"added"}');
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('private, no-store, max-age=0');
    expect(work).not.toHaveBeenCalled();
    await (mocks.after.mock.calls[0][0] as () => Promise<void>)();
    expect(work).toHaveBeenCalledOnce();
  });

  it('refuses an oversized body before parsing', async () => {
    const response = await post('x'.repeat(9 * 1024));
    expect(response.status).toBe(413);
    expect(mocks.handle).not.toHaveBeenCalled();
  });
});
