import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ begin: vi.fn() }));
vi.mock('@/lib/gifts.server', () => ({ beginGiftClaimSession: mocks.begin }));
import { POST } from './route';
const token = Buffer.alloc(32, 8).toString('base64url'), secret = Buffer.alloc(32, 9).toString('base64url');
function request(body: unknown, origin = 'https://icons.test') { return new Request('https://icons.test/api/gifts/claim-session', { method: 'POST', headers: { origin, 'content-type': 'application/json' }, body: JSON.stringify(body) }); }
beforeEach(() => { mocks.begin.mockReset().mockResolvedValue({ secret, expiresAt: '2027-10-14T00:00:00Z' }); });
afterEach(() => vi.unstubAllEnvs());
it('returns only an acknowledgement and an HttpOnly same-site session cookie', async () => { vi.stubEnv('NODE_ENV', 'production'); const response = await POST(request({ token })); expect(await response.json()).toEqual({ ok: true }); expect(mocks.begin).toHaveBeenCalledExactlyOnceWith(token); const cookie = response.headers.get('set-cookie'); expect(cookie).toContain('HttpOnly'); expect(cookie).toContain('Secure'); expect(cookie).toContain('SameSite=strict'); expect(cookie).not.toContain(token); expect(response.headers.get('cache-control')).toContain('no-store'); });
it('rejects a cross-origin request and extra JSON keys before session creation', async () => { expect((await POST(request({ token }, 'https://other.test'))).status).toBe(403); expect((await POST(request({ token, actorId: 'attacker' }))).status).toBe(400); expect(mocks.begin).not.toHaveBeenCalled(); });
it('checks the browser Host when Next normalizes its internal URL and ignores forwarded host', async () => {
  const local = new Request('http://localhost:4332/api/gifts/claim-session', { method: 'POST', headers: { host: '127.0.0.1:4332', origin: 'http://127.0.0.1:4332', 'content-type': 'application/json' }, body: JSON.stringify({ token }) });
  expect((await POST(local)).status).toBe(200);
  for (const values of [{ host: 'evil.test', 'x-forwarded-host': 'icons.test' }, { host: 'icons.test/evil' }, { host: 'icons.test', 'sec-fetch-site': 'cross-site' }]) {
    const unsafe = request({ token });for (const [name, value] of Object.entries(values)) unsafe.headers.set(name, value);
    expect((await POST(unsafe)).status).toBe(403);
  }
});
it('bounds raw input before parsing and does not expose a thrown backend error', async () => { expect((await POST(request({ token: 'x'.repeat(1200) }))).status).toBe(413); expect(mocks.begin).not.toHaveBeenCalled(); mocks.begin.mockRejectedValue(new Error('private-token-canary')); const response = await POST(request({ token })); expect(response.status).toBe(503); expect(await response.text()).not.toContain('canary'); });
