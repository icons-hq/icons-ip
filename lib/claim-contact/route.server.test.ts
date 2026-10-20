import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ context: vi.fn(), change: vi.fn(), operation: vi.fn(), reshipment: vi.fn(), adminHistory: vi.fn(), myHistory: vi.fn() }));
vi.mock('./service.server', async importOriginal => {
  const original = await importOriginal<typeof import('./service.server')>();
  return { ...original, fetchClaimContactContext: mocks.context, changeClaimContact: mocks.change, readOrSealClaimContactOperation: mocks.operation,
    recordClaimReshipmentV2: mocks.reshipment, fetchAdminClaimContactHistory: mocks.adminHistory, fetchMyClaimContactHistory: mocks.myHistory };
});
import * as contextRoute from '@/app/api/admin/claim-contact/context/route';
import * as changeRoute from '@/app/api/admin/claim-contact/change/route';
import * as operationRoute from '@/app/api/admin/claim-contact/operation/route';
import * as reshipmentRoute from '@/app/api/admin/claim-contact/reshipment/route';
import * as adminHistoryRoute from '@/app/api/admin/claim-contact/history/route';
import * as myHistoryRoute from '@/app/api/orders/claim-contact/history/route';
import { claimContactError } from './contracts';

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const input = { requestId: id(1), orderId: id(2), claimId: id(3), target: 'collection', command: 'change' };
const routes = [
  ['context', contextRoute, mocks.context], ['change', changeRoute, mocks.change], ['operation', operationRoute, mocks.operation],
  ['reshipment', reshipmentRoute, mocks.reshipment], ['operator history', adminHistoryRoute, mocks.adminHistory], ['customer history', myHistoryRoute, mocks.myHistory],
] as const;
function request(body: string | Uint8Array = JSON.stringify(input), headers: Record<string, string> = {}, url = 'https://icons.test/api/admin/claim-contact/context') {
  return new Request(url, { method: 'POST', headers: { host: 'icons.test', origin: 'https://icons.test', 'content-type': 'application/json', ...headers }, body: body as BodyInit });
}
function privateHeaders(response: Response) {
  expect(response.headers.get('cache-control')).toBe('private, no-store, max-age=0'); expect(response.headers.get('pragma')).toBe('no-cache');
  expect(response.headers.get('vary')).toBe('Cookie'); expect(response.headers.get('referrer-policy')).toBe('no-referrer'); expect(response.headers.get('x-content-type-options')).toBe('nosniff');
}
beforeEach(() => { Object.values(mocks).forEach(mock => mock.mockReset().mockResolvedValue({ requestId: input.requestId, actorId: id(4), sessionId: id(5), receipt: null })); });

describe('claim contact route boundaries', () => {
  it.each(routes)('%s is explicitly Node and its POST uses the matching service', async (_name, route, service) => {
    expect(route.runtime).toBe('nodejs');
    const response = await route.POST(request()); expect(response.status).toBe(200); privateHeaders(response);
    expect(service).toHaveBeenCalledExactlyOnceWith(input);
  });
  it.each(routes)('%s denies every unsupported supported-by-Next method with private headers', async (_name, route, service) => {
    for (const method of ['GET', 'HEAD', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'] as const) {
      const response = route[method](); expect(response.status).toBe(405); privateHeaders(response);
      expect(response.headers.get('allow')).toBe('POST'); expect(await response.text()).toBe('');
    }
    expect(service).not.toHaveBeenCalled();
  });
  it.each<Record<string, string>>([
    { origin: '' }, { origin: 'null' }, { origin: 'https://other.test' }, { origin: 'https://icons.test/path' },
    { host: 'icons.test/other' }, { host: 'other.test', 'x-forwarded-host': 'icons.test' }, { 'sec-fetch-site': 'cross-site' },
  ])('rejects cross-origin or malformed browser destination before data access: %#', async headers => {
    const response = await contextRoute.POST(request(undefined, headers)); expect(response.status).toBe(403); privateHeaders(response); expect(mocks.context).not.toHaveBeenCalled();
  });
  it('uses the actual host when Next normalizes its internal request URL', async () => {
    const response = await contextRoute.POST(request(undefined, { host: '127.0.0.1:4332', origin: 'http://127.0.0.1:4332' }, 'http://localhost:4332/api/admin/claim-contact/context'));
    expect(response.status).toBe(200); privateHeaders(response);
  });
  it.each(['text/plain', 'application/x-www-form-urlencoded', ''])('requires JSON instead of %s', async type => {
    const response = await changeRoute.POST(request(undefined, { 'content-type': type })); expect(response.status).toBe(415); privateHeaders(response); expect(mocks.change).not.toHaveBeenCalled();
  });
  it('rejects malformed JSON, invalid UTF-8 and an overlimit body before service invocation', async () => {
    for (const body of ['{', new Uint8Array([0x7b, 0xc3, 0x28, 0x7d])]) {
      const response = await changeRoute.POST(request(body)); expect(response.status).toBe(400); privateHeaders(response);
    }
    const response = await changeRoute.POST(request(JSON.stringify({ ignored: 'a'.repeat(16_384) })));
    expect(response.status).toBe(413); privateHeaders(response); expect(mocks.change).not.toHaveBeenCalled();
  });
  it('permits the real 1000-item reshipment shape within 256 KiB and still bounds streamed or declared excess', async () => {
    const reshipment = { requestId: id(1), orderId: id(2), claimId: id(3), operationId: id(6), signedContext: `cc1.${'a'.repeat(1400)}.${'b'.repeat(43)}`,
      carrier: '합성택배', trackingNumber: '12345678', items: Array.from({ length: 1000 }, (_, index) => ({ orderItemId: id(1000 + index), variantId: id(2000 + index) })), destinationConfirmed: true, dispatchConfirmed: true };
    const body = JSON.stringify(reshipment); expect(Buffer.byteLength(body)).toBeGreaterThan(16_384); expect(Buffer.byteLength(body)).toBeLessThan(262_144);
    const accepted = await reshipmentRoute.POST(request(body)); expect(accepted.status).toBe(200); privateHeaders(accepted); expect(mocks.reshipment).toHaveBeenCalledExactlyOnceWith(reshipment);
    const streamed = await reshipmentRoute.POST(request(JSON.stringify({ ignored: 'x'.repeat(262_144) }))); expect(streamed.status).toBe(413); privateHeaders(streamed);
    const declared = await reshipmentRoute.POST(request('{}', { 'content-length': '262145' })); expect(declared.status).toBe(413); privateHeaders(declared);
    expect(mocks.reshipment).toHaveBeenCalledTimes(1);
  });
  it.each([
    ['auth_changed', 403], ['invalid_claim_contact_request', 400], ['claim_contact_changed', 409], ['claim_contact_purged', 410],
    ['claim_contact_retention_due', 410], ['feature_disabled', 503], ['claim_contact_outcome_unknown', 503],
  ] as const)('maps stable %s errors and protects every error response', async (code, status) => {
    mocks.operation.mockResolvedValue(claimContactError(code, id(1)));
    const response = await operationRoute.POST(request()); expect(response.status).toBe(status); privateHeaders(response);
    expect(await response.json()).toEqual(claimContactError(code, id(1)));
  });
  it.each(['NEXT_REDIRECT:/login', 'synthetic secret name/phone/key'])('sanitizes thrown failures and never redirects: %#', async text => {
    mocks.context.mockRejectedValue(new Error(text)); const response = await contextRoute.POST(request());
    expect(response.status).toBe(503); privateHeaders(response); expect(response.headers.has('location')).toBe(false); expect(await response.text()).not.toContain(text);
  });
  it('rejects unrecognized error bodies that might contain raw upstream text', async () => {
    mocks.context.mockResolvedValue({ code: 'unknown', message: 'synthetic secret' });
    const response = await contextRoute.POST(request()); expect(response.status).toBe(503); privateHeaders(response); expect(await response.text()).not.toContain('synthetic secret');
  });
});
