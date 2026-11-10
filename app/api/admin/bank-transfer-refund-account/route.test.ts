import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ view: vi.fn() }));
vi.mock('@/lib/admin/bank-transfer-refund-account.server', () => ({ viewBankRefundAccount: mocks.view }));
import { GET, HEAD, POST } from './route';

const input = { actorId: 'b1920000-0000-4000-8000-000000000001', sessionId: 'b1920000-0000-4000-8000-000000000002',
  orderId: 'b1920000-0000-4000-8000-000000000003', claimId: 'b1920000-0000-4000-8000-000000000004',
  viewId: 'b1920000-0000-4000-8000-000000000005', revision: 4 };
const account = { viewId: input.viewId, actorId: input.actorId, orderId: input.orderId, claimId: input.claimId, revision: input.revision, bankName: 'TEST 합성은행', accountNumber: '000000001234', accountHolder: 'TEST 합성예금주', viewedAt: '2026-10-14T06:00:00Z' };
function request({ url = 'https://icons.test/api/admin/bank-transfer-refund-account', headers = {}, body = JSON.stringify(input) } = {} as { url?: string; headers?: Record<string, string>; body?: string }) {
  return new Request(url, { method: 'POST', headers: { host: 'icons.test', origin: 'https://icons.test', 'content-type': 'application/json', ...headers }, body });
}
function privateResponse(response: Response) {
  expect(response.headers.get('cache-control')).toBe('private, no-store, max-age=0');
  expect(response.headers.get('pragma')).toBe('no-cache');
  expect(response.headers.get('vary')).toBe('Cookie');
  expect(response.headers.get('referrer-policy')).toBe('no-referrer');
  expect(response.headers.get('x-content-type-options')).toBe('nosniff');
}
beforeEach(() => { mocks.view.mockReset().mockResolvedValue({ account }); });

describe('audited raw-account POST route', () => {
  it.each([['GET', GET], ['HEAD', HEAD]] as const)('%s never reads an account or writes a view receipt', async (_method, handler) => {
    const response = handler(); expect(response.status).toBe(405); expect(await response.text()).toBe('');
    expect(response.headers.get('allow')).toBe('POST'); privateResponse(response); expect(mocks.view).not.toHaveBeenCalled();
  });
  it('uses the server audit reader and protects its raw success response', async () => {
    const response = await POST(request()); expect(response.status).toBe(200); privateResponse(response);
    expect(await response.json()).toEqual({ account }); expect(mocks.view).toHaveBeenCalledExactlyOnceWith(input);
  });
  it.each<Record<string, string>>([
    { origin: '' }, { origin: 'https://other.test' }, { origin: 'null' },
    { origin: 'https://icons.test/path' }, { host: 'other.test', 'x-forwarded-host': 'icons.test' },
    { host: 'icons.test/other' }, { 'sec-fetch-site': 'cross-site' },
  ])('rejects an untrusted browser destination before audit read: %j', async headers => {
    const response = await POST(request({ headers })); expect(response.status).toBe(403); privateResponse(response);
    expect(mocks.view).not.toHaveBeenCalled(); expect(await response.text()).not.toContain(account.accountNumber);
  });
  it('accepts the actual browser Host when Next dev normalizes Request.url', async () => {
    const response = await POST(request({ url: 'http://localhost:4332/api/admin/bank-transfer-refund-account',
      headers: { host: '127.0.0.1:4332', origin: 'http://127.0.0.1:4332' } }));
    expect(response.status).toBe(200); privateResponse(response); expect(mocks.view).toHaveBeenCalledExactlyOnceWith(input);
  });
  it.each(['text/plain', 'application/x-www-form-urlencoded', ''])('rejects %j before parsing', async contentType => {
    const response = await POST(request({ headers: { 'content-type': contentType } })); expect(response.status).toBe(415);
    privateResponse(response); expect(mocks.view).not.toHaveBeenCalled();
  });
  it('rejects malformed JSON and bounds raw input before audit access', async () => {
    const malformed = await POST(request({ body: '{' })); expect(malformed.status).toBe(400); privateResponse(malformed);
    const oversized = await POST(request({ body: JSON.stringify({ ...input, ignored: 'x'.repeat(3000) }) })); expect(oversized.status).toBe(413); privateResponse(oversized);
    expect(mocks.view).not.toHaveBeenCalled();
  });
  it.each([
    [{ error: 'TEST auth', authChanged: true }, 403], [{ error: 'TEST conflict', conflict: true }, 409],
    [{ error: 'TEST unavailable', uncertain: true }, 503], [{ error: 'TEST validation' }, 400],
  ] as const)('protects rejected outcome %#', async (result, status) => {
    mocks.view.mockResolvedValue(result); const response = await POST(request()); expect(response.status).toBe(status); privateResponse(response);
    expect(await response.json()).toEqual(result);
  });
  it.each(['NEXT_REDIRECT:/login', 'TEST internal raw account 000000001234'])('does not redirect or echo thrown detail: %s', async message => {
    mocks.view.mockRejectedValue(new Error(message)); const response = await POST(request()); expect(response.status).toBe(403); privateResponse(response);
    expect(response.headers.has('location')).toBe(false); expect(await response.text()).not.toContain(message);
  });
});
