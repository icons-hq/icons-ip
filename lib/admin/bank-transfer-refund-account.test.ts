import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { requestBankRefundAccount } from './bank-transfer-refund-account';
const input = { actorId: 'b1930000-0000-4000-8000-000000000001', sessionId: 'b1930000-0000-4000-8000-000000000002',
  orderId: 'b1930000-0000-4000-8000-000000000003', claimId: 'b1930000-0000-4000-8000-000000000004',
  viewId: 'b1930000-0000-4000-8000-000000000005', revision: 4 };
const account = { viewId: input.viewId, actorId: input.actorId, orderId: input.orderId, claimId: input.claimId, revision: input.revision,
  bankName: 'TEST 합성은행', accountNumber: '000000001234', accountHolder: 'TEST 합성예금주', viewedAt: '2026-10-14T06:00:00Z' };
const other = 'b1930000-0000-4000-8000-000000000099';
let fetcher: ReturnType<typeof vi.fn>;
function response(payload: unknown = { account }, options: { status?: number; cacheControl?: string | null; redirected?: boolean } = {}) {
  const status = options.status ?? 200, cache = options.cacheControl === undefined ? 'private, no-store, max-age=0' : options.cacheControl;
  return { ok: status >= 200 && status < 300, status, redirected: options.redirected ?? false,
    headers: new Headers(cache === null ? {} : { 'cache-control': cache }), json: vi.fn().mockResolvedValue(payload) };
}
beforeEach(() => { fetcher = vi.fn().mockResolvedValue(response()); vi.stubGlobal('fetch', fetcher); });
afterEach(() => vi.unstubAllGlobals());

describe('private raw-account transport', () => {
  it('sends only audit metadata through a non-cached same-origin POST', async () => {
    expect(await requestBankRefundAccount(input)).toEqual({ account });
    expect(fetcher).toHaveBeenCalledExactlyOnceWith('/api/admin/bank-transfer-refund-account', {
      method: 'POST', credentials: 'same-origin', cache: 'no-store', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input),
    });
    expect(fetcher.mock.calls[0][1].body).not.toContain(account.accountNumber);
  });
  it.each([null, 'no-cache, must-revalidate', 'private, no-store=false', 'public, max-age=3600', ''])('discards an unprotected response before decoding: %j', async cacheControl => {
    const result = response({ account }, { cacheControl }); fetcher.mockResolvedValue(result);
    expect(await requestBankRefundAccount(input)).toHaveProperty('error'); expect(result.json).not.toHaveBeenCalled();
  });
  it('accepts a case-insensitive exact no-store directive and rejects redirects', async () => {
    fetcher.mockResolvedValue(response({ account }, { cacheControl: 'private, NO-STORE , max-age=0' }));
    expect(await requestBankRefundAccount(input)).toEqual({ account });
    const redirected = response({ account }, { redirected: true }); fetcher.mockResolvedValue(redirected);
    expect(await requestBankRefundAccount(input)).toHaveProperty('error'); expect(redirected.json).not.toHaveBeenCalled();
  });
  it.each([401, 403, 409, 400, 503])('never decodes or exposes raw bodies for HTTP %i', async status => {
    const rejected = response({ account }, { status }); fetcher.mockResolvedValue(rejected);
    const result = await requestBankRefundAccount(input); expect(result).toHaveProperty('error'); expect(JSON.stringify(result)).not.toContain(account.accountNumber);
    expect(rejected.json).not.toHaveBeenCalled();
    if (status === 401 || status === 403) expect(result).toHaveProperty('authChanged', true);
    if (status === 409) expect(result).toHaveProperty('conflict', true);
  });
  it.each(['viewId', 'actorId', 'orderId', 'claimId', 'revision'] as const)('rejects an account belonging to another %s', async key => {
    fetcher.mockResolvedValue(response({ account: { ...account, [key]: key === 'revision' ? 5 : other } }));
    const result = await requestBankRefundAccount(input); expect(result).toHaveProperty('error'); expect(result).not.toHaveProperty('account');
    expect(JSON.stringify(result)).not.toContain(account.accountNumber);
  });
  it.each([null, {}, { account, proof: 'private' }, { account: { ...account, sessionId: input.sessionId } },
    { account: { ...account, accountNumber: 'invalid' } }, { account: { ...account, viewedAt: 'invalid' } }])('rejects malformed or unexpectedly expanded data %#', async payload => {
    fetcher.mockResolvedValue(response(payload)); const result = await requestBankRefundAccount(input);
    expect(result).toHaveProperty('error'); expect(result).not.toHaveProperty('account');
  });
  it('propagates transport failures for the mounted caller to clear its pending view', async () => {
    fetcher.mockRejectedValue(new TypeError('TEST network')); await expect(requestBankRefundAccount(input)).rejects.toThrow('TEST network');
    const malformed = response(); malformed.json.mockRejectedValue(new SyntaxError('TEST malformed JSON')); fetcher.mockResolvedValue(malformed);
    await expect(requestBankRefundAccount(input)).rejects.toThrow('TEST malformed JSON');
  });
});
