import { describe, expect, it, vi } from 'vitest';
import { inspectResponse, runSmoke, SMOKE_TARGETS, summaryMarkdown } from './post-deploy-smoke.mjs';

const html = (body = 'ok') => `<!doctype html><html lang="ko"><body>${body}</body></html>`;
const response = (status, body, type = 'text/html; charset=utf-8') => ({
  status,
  headers: { get: () => type },
  text: async () => body,
});

describe('inspectResponse', () => {
  const page = { path: '/', kind: 'html' };
  it('passes a rendered page', () => expect(inspectResponse(page, 200, 'text/html', html())).toBeNull());
  it('rejects non-200 and non-html', () => {
    expect(inspectResponse(page, 502, 'text/html', html())).toBe('HTTP 502');
    expect(inspectResponse(page, 200, 'application/json', '{}')).toMatch(/HTML이 아님/);
  });
  it('rejects a Next soft 404 served as 200', () => {
    expect(inspectResponse(page, 200, 'text/html', html('<h1>페이지를 찾을 수 없습니다</h1>'))).toMatch(/soft 404/);
    expect(inspectResponse(page, 200, 'text/html', html('NEXT_HTTP_ERROR_FALLBACK;404'))).toMatch(/soft 404/);
  });
  it('rejects a body without the app shell', () => {
    expect(inspectResponse(page, 200, 'text/html', '<html><body>x</body></html>')).toMatch(/앱 셸/);
  });
  it('checks the health JSON', () => {
    const health = { path: '/api/health', kind: 'health' };
    expect(inspectResponse(health, 200, 'application/json', '{"ok":true,"database":"ok"}')).toBeNull();
    expect(inspectResponse(health, 200, 'application/json', '{"ok":false}')).toMatch(/health/);
    expect(inspectResponse(health, 200, 'application/json', 'oops')).toMatch(/JSON/);
  });
});

describe('runSmoke', () => {
  const base = { origin: 'https://example.test', attempts: 3, delayMs: 0, sleep: async () => {}, log: () => {} };
  const ok = (url) => (url.endsWith('/api/health') ? response(200, '{"ok":true,"database":"ok"}', 'application/json') : response(200, html()));

  it('covers home, shop, login and health', () => {
    expect(SMOKE_TARGETS.map((target) => target.path)).toEqual(['/', '/shop', '/login', '/api/health']);
  });

  it('passes when every path answers', async () => {
    const outcome = await runSmoke({ ...base, fetchImpl: async (url) => ok(url) });
    expect(outcome.ok).toBe(true);
  });

  it('retries a transient failure and then passes', async () => {
    let calls = 0;
    const fetchImpl = async (url) => {
      calls += 1;
      return calls === 1 ? response(503, '') : ok(url);
    };
    expect((await runSmoke({ ...base, fetchImpl })).ok).toBe(true);
  });

  it('fails after the attempts and names the path', async () => {
    const fetchImpl = vi.fn(async (url) => (url.endsWith('/shop') ? response(200, html('페이지를 찾을 수 없습니다')) : ok(url)));
    const outcome = await runSmoke({ ...base, fetchImpl });
    expect(outcome.ok).toBe(false);
    expect(outcome.results.find((r) => !r.ok)).toMatchObject({ path: '/shop' });
    expect(fetchImpl.mock.calls.filter(([url]) => url.endsWith('/shop'))).toHaveLength(3);
    expect(summaryMarkdown('https://example.test', outcome)).toContain('FAIL `/shop`');
  });

  it('treats a network error as a failure', async () => {
    const outcome = await runSmoke({ ...base, fetchImpl: async () => { throw new TypeError('fetch failed'); } });
    expect(outcome.ok).toBe(false);
  });
});
