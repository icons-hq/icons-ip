import { runInNewContext } from 'node:vm';
import { expect, it, vi } from 'vitest';
import { GET } from './route';
import { giftInvitationUrl } from '@/lib/gifts';
it('the issued URL removes its fragment before the first fetch and never loads analytics/media', async () => {
  const response = await GET(), html = await response.text(), token = Buffer.alloc(32, 7).toString('base64url'), url = new URL(giftInvitationUrl('https://icons.test', token));
  const events: string[] = [], location = { hash: url.hash, pathname: url.pathname, replace: vi.fn() }, status = { textContent: '' };
  const script = html.match(/<script nonce="[^"]+">([\s\S]+)<\/script>/)?.[1]; expect(script).toBeTruthy();
  await runInNewContext(script!, { location, document: { getElementById: () => status }, history: { replaceState: (_state: unknown, _title: string, path: string) => { expect(path).toBe('/gifts/receive'); location.hash = ''; events.push('fragment-cleared'); } }, URLSearchParams,
    fetch: async (path: string, init: RequestInit) => { expect(location.hash).toBe(''); expect(path).toBe('/api/gifts/claim-session'); expect(JSON.parse(String(init.body))).toEqual({ token }); events.push('fetch'); return { ok: true }; } });
  expect(events).toEqual(['fragment-cleared', 'fetch']); expect(location.replace).toHaveBeenCalledWith('/gifts/receive/session');
  expect(response.headers.get('referrer-policy')).toBe('no-referrer'); expect(response.headers.get('content-security-policy')).toContain("default-src 'none'");
  expect(html).not.toMatch(/<img|<link|<script[^>]+src=|__next|analytics|googletag/i); expect(html).not.toContain(token);
});
it('invalid fragments are cleared without a request or echoing attacker text', async () => {
  const html = await (await GET()).text(), fetch = vi.fn(), status = { textContent: '' }, replaceState = vi.fn();
  await runInNewContext(html.match(/<script nonce="[^"]+">([\s\S]+)<\/script>/)![1], { location: { hash: '#token=<script>attack</script>', pathname: '/gifts/receive' }, history: { replaceState }, document: { getElementById: () => status }, URLSearchParams, fetch });
  expect(replaceState).toHaveBeenCalled(); expect(fetch).not.toHaveBeenCalled(); expect(status.textContent).toContain('사용할 수 없는 선물 링크'); expect(status.textContent).not.toContain('attack');
});
