import { beforeEach, describe, expect, it, vi } from 'vitest';
const mock = vi.hoisted(() => vi.fn());
vi.mock('@/lib/claim-contact/retention.server', () => ({ maintainClaimContactRetention: mock }));
vi.mock('@/lib/claim-contact/service.server', () => { throw new Error('Retention route must not load the crypto-dependent service'); });
import * as route from './route';
import { claimContactError } from '@/lib/claim-contact/contracts';
import { CLAIM_CONTACT_FIXTURE_IDS as ids, claimContactContractFixtures } from '@/lib/claim-contact/test-fixtures';

const input = { requestId: ids.request, operation: 'inventory', subjectId: ids.actor, limit: 1, afterClaimId: null };
function request(body = JSON.stringify(input), headers: Record<string, string> = {}) {
  return new Request('https://icons.test/api/admin/claim-contact/retention', { method: 'POST',
    headers: { host: 'icons.test', origin: 'https://icons.test', 'content-type': 'application/json', ...headers }, body });
}
function privateHeaders(response: Response) {
  expect(response.headers.get('cache-control')).toBe('private, no-store, max-age=0'); expect(response.headers.get('pragma')).toBe('no-cache');
  expect(response.headers.get('vary')).toBe('Cookie'); expect(response.headers.get('referrer-policy')).toBe('no-referrer');
  expect(response.headers.get('x-content-type-options')).toBe('nosniff');
}
beforeEach(() => { mock.mockReset().mockResolvedValue({ requestId: ids.request, operation: 'inventory', data: claimContactContractFixtures().ContactDataInventory }); });
describe('manual retention POST boundary', () => {
  it('uses the independent Node retention service with a bounded JSON body and private headers', async () => {
    expect(route.runtime).toBe('nodejs'); const response = await route.POST(request());
    expect(response.status).toBe(200); privateHeaders(response); expect(mock).toHaveBeenCalledExactlyOnceWith(input);
    expect(await response.json()).toMatchObject({ requestId: ids.request, operation: 'inventory' });
  });
  it('rejects every non-POST supported method, including HEAD and OPTIONS', async () => {
    for (const method of ['GET', 'HEAD', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'] as const) {
      const response = route[method](); expect(response.status).toBe(405); privateHeaders(response);
      expect(response.headers.get('allow')).toBe('POST'); expect(await response.text()).toBe('');
    }
    expect(mock).not.toHaveBeenCalled();
  });
  it.each([
    [{ origin: 'https://other.test' }, 403], [{ origin: '' }, 403], [{ 'sec-fetch-site': 'cross-site' }, 403],
    [{ 'content-type': 'text/plain' }, 415],
  ] as const)('rejects unsafe request headers %#', async (headers, status) => {
    const response = await route.POST(request(undefined, headers)); expect(response.status).toBe(status); privateHeaders(response);
    expect(mock).not.toHaveBeenCalled();
  });
  it('rejects malformed and over-limit bodies without service invocation', async () => {
    const malformed = await route.POST(request('{')); expect(malformed.status).toBe(400); privateHeaders(malformed);
    const over = await route.POST(request(JSON.stringify({ ignored: 'x'.repeat(16_384) }))); expect(over.status).toBe(413); privateHeaders(over);
    expect(mock).not.toHaveBeenCalled();
  });
  it.each([['auth_changed', 403], ['invalid_claim_contact_request', 400], ['claim_contact_changed', 409], ['claim_contact_outcome_unknown', 503]] as const)('sanitizes and maps %s', async (code, status) => {
    mock.mockResolvedValue(claimContactError(code, ids.request)); const response = await route.POST(request());
    expect(response.status).toBe(status); privateHeaders(response); expect(await response.json()).toEqual(claimContactError(code, ids.request));
  });
  it('never exposes thrown private values', async () => {
    mock.mockRejectedValue(new Error('synthetic secret')); const response = await route.POST(request());
    expect(response.status).toBe(503); privateHeaders(response); expect(await response.text()).not.toContain('synthetic secret');
  });
});
