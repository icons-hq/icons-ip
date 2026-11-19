import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { inspectResponse, resolveDeploymentId, runSmoke, SMOKE_TARGETS, summaryMarkdown } from './post-deploy-smoke.mjs';

const fixture = (name) => readFileSync(new URL(`./fixtures/post-deploy-smoke/${name}.html`, import.meta.url), 'utf8');

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
    // 스크립트 안의 문구만 있으면 정상이다.
    expect(inspectResponse(page, 200, 'text/html', html('<script>self.__next_f.push(["페이지를 찾을 수 없습니다"])</script>'))).toBeNull();
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

describe('운영에서 받은 실제 HTML 표본', () => {
  // 정상 페이지도 RSC 페이로드(<script>)에 404 화면 문구를 싣는다(2026-11-19 운영 실측). 보이는 본문만 soft 404로 본다.
  it.each([['home', '/'], ['shop', '/shop'], ['login', '/login']])('정상 %s 페이지는 통과한다', (name, path) => {
    const body = fixture(name);
    expect(body).toContain('페이지를 찾을 수 없습니다');
    expect(inspectResponse({ path, kind: 'html' }, 200, 'text/html; charset=utf-8', body)).toBeNull();
  });
  it('없는 주소(200으로 내려가는 404 본문)는 soft 404로 거른다', () => {
    expect(inspectResponse({ path: '/x', kind: 'html' }, 200, 'text/html; charset=utf-8', fixture('not-found'))).toMatch(/soft 404/);
  });
});

describe('배포 id 비교', () => {
  const health = { path: '/api/health', kind: 'health' };
  it('같으면 통과, 다르면 다른 배포가 응답한 것으로 실패, 값이 없으면 비교하지 않는다', () => {
    const body = (id) => JSON.stringify({ ok: true, database: 'ok', deploymentId: id });
    expect(inspectResponse(health, 200, 'application/json', body('dpl_a'), 'dpl_a')).toBeNull();
    expect(inspectResponse(health, 200, 'application/json', body('dpl_old'), 'dpl_a')).toMatch(/다른 배포/);
    expect(inspectResponse(health, 200, 'application/json', body(null), 'dpl_a')).toBeNull();
    expect(inspectResponse(health, 200, 'application/json', body('dpl_old'), null)).toBeNull();
  });
  it('배포 URL의 id를 Vercel API로 찾고, 못 찾으면 경고만 남기고 null이다', async () => {
    const log = vi.fn();
    const fetchImpl = vi.fn(async () => ({ ok: true, json: async () => ({ id: 'dpl_abc' }) }));
    expect(await resolveDeploymentId({ deploymentUrl: 'https://icons-ip-x.vercel.app\n', token: 't', teamId: 'team_1', fetchImpl, log })).toBe('dpl_abc');
    expect(fetchImpl.mock.calls[0][0]).toBe('https://api.vercel.com/v13/deployments/icons-ip-x.vercel.app?teamId=team_1');
    expect(await resolveDeploymentId({ deploymentUrl: '', token: 't', log })).toBeNull();
    expect(await resolveDeploymentId({ deploymentUrl: 'https://a.vercel.app', token: 't', fetchImpl: async () => ({ ok: false }), log })).toBeNull();
    expect(await resolveDeploymentId({ deploymentUrl: 'https://a.vercel.app', token: 't', fetchImpl: async () => { throw new Error('x'); }, log })).toBeNull();
    expect(log).toHaveBeenCalledTimes(3);
  });
  it('runSmoke는 기대 배포 id와 다르면 health에서 실패한다', async () => {
    const fetchImpl = async (url) => url.endsWith('/api/health')
      ? response(200, JSON.stringify({ ok: true, database: 'ok', deploymentId: 'dpl_old' }), 'application/json') : response(200, html());
    const outcome = await runSmoke({ origin: 'https://example.test', expectedDeploymentId: 'dpl_new', attempts: 1, sleep: async () => {}, log: () => {}, fetchImpl });
    expect(outcome.results.filter((r) => !r.ok).map((r) => r.path)).toEqual(['/api/health']);
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
