import { afterEach, describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
import { addSettlementDecimals, formatSettlementDecimal, settlementDecimal } from './decimal';
import { parseSettlementJson, SettlementJsonNumber } from './lossless-json.server';
import { parseSettlementQuery } from './types';
import { fetchTossSettlementPage, parseTossSettlementRecord, readTossSettlementConfiguration,
  SETTLEMENT_PAGE_SIZE, SETTLEMENT_REQUEST_TIMEOUT_MS, type TossSettlementConfiguration } from './toss-settlements.server';

const config: TossSettlementConfiguration = { secretKey: 'test_gsk_settlementfixture001', mId: 'iconsfixture', mode: 'test', scopeHash: 'a'.repeat(64) };
const query = { dateType: 'paidOutDate' as const, startDate: '2026-10-01', endDate: '2026-10-31' };
const record = {
  mId: config.mId, paymentKey: 'fixture-payment-1', transactionKey: 'fixture-transaction-1', orderId: 'fixture-order-1',
  currency: 'KRW', method: '카드', amount: '13000', interestFee: '0', fees: [{ type: 'BASE', fee: '315.45' }],
  supplyAmount: '286.77', vat: '28.68', payOutAmount: '12684.55', approvedAt: '2026-10-10T14:30:00+09:00',
  soldDate: '2026-10-10', paidOutDate: '2026-10-14', cancel: null,
};
function response(body: unknown) { return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } }); }
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

describe('exact statement values', () => {
  it('retains number tokens above JS safe integer and decimal precision', () => {
    const parsed = parseSettlementJson('{"amount":9007199254740993,"fee":0.10000001,"other":[null,true,false,"A\\\"B"]}');
    expect(parsed).toEqual({ amount: new SettlementJsonNumber('9007199254740993'), fee: new SettlementJsonNumber('0.10000001'), other: [null, true, false, 'A"B'] });
    expect(addSettlementDecimals(['9007199254740993', '0.1', '0.2'])).toBe('9007199254740993.3');
    expect(addSettlementDecimals(['-1000.99', '1000.01'])).toBe('-0.98');
    expect(formatSettlementDecimal('1999999999999999998.2')).toBe('1,999,999,999,999,999,998.2');
  });
  it.each(['{"amount":1,"amount":2}', '{"a":1,}', '[1,]', '01', '1e', '{"a":"bad\ntext"}', '[true false]', '{"a":NaN}', 'null extra'])('rejects ambiguous or invalid JSON %s', input => {
    expect(() => parseSettlementJson(input)).toThrow('invalid_settlement_response');
  });
  it('bounds nested responses and handles prototype-looking keys as data', () => {
    expect(() => parseSettlementJson('['.repeat(34) + '0' + ']'.repeat(34))).toThrow();
    const parsed = parseSettlementJson('{"__proto__":{"polluted":true}}');
    expect(Object.getPrototypeOf(parsed)).toBe(null);
    expect({}).not.toHaveProperty('polluted');
  });
  it('normalizes exponent and zero without rounding unsupported precision', () => {
    expect(settlementDecimal('-0.000')).toBe('0');
    expect(settlementDecimal('123.4500e-2')).toBe('1.2345');
    expect(settlementDecimal('1e17')).toBe('100000000000000000');
    for (const invalid of ['1e18', '1e1000', '0.000000001', '01', '+1', 'Infinity', '', ' 2']) expect(settlementDecimal(invalid)).toBeNull();
  });
  it('validates calendar dates and limits the requested period to 31 days', () => {
    expect(parseSettlementQuery(query)).toEqual(query);
    expect(parseSettlementQuery({ ...query, endDate: '2026-11-01' })).toBeNull();
    expect(parseSettlementQuery({ ...query, startDate: '2026-02-30' })).toBeNull();
    expect(parseSettlementQuery({ ...query, dateType: 'approvedAt' })).toBeNull();
  });
});

describe('provider record boundary', () => {
  it('retains only statement values and strips customer and payment instrument data', () => {
    const parsed = parseTossSettlementRecord({ ...record, card: { number: '1234-private' }, mobilePhone: { customerMobilePhone: 'private-phone' }, virtualAccount: { accountNumber: 'private-bank' }, metadata: { secret: 'private-metadata' } }, config.mId);
    expect(parsed).toEqual(record);
    expect(JSON.stringify(parsed)).not.toContain('private-');
  });
  it('keeps signed provider amounts and cancellation amounts separately', () => {
    const cancel = { cancelAmount: '13000', canceledAt: '2026-10-11T15:00:00+09:00', transactionKey: record.transactionKey };
    expect(parseTossSettlementRecord({ ...record, amount: '-13000', payOutAmount: '-12684.55', cancel: { ...cancel, cancelReason: 'private reason', receiptKey: 'private receipt' } }, config.mId))
      .toEqual({ ...record, amount: '-13000', payOutAmount: '-12684.55', cancel });
    expect(() => parseTossSettlementRecord({ ...record, cancel: { ...cancel, transactionKey: 'other' } }, config.mId)).toThrow('invalid_response');
  });
  it('rejects unknown merchant, malformed dates, missing fees, and rounded JS numeric inputs', () => {
    expect(() => parseTossSettlementRecord({ ...record, mId: 'othermid' }, config.mId)).toThrow('merchant_mismatch');
    for (const change of [{ fees: null }, { amount: 13000 }, { approvedAt: '2026-02-30T12:00:00+09:00' }, { paymentKey: 'bad\nkey' }]) {
      expect(() => parseTossSettlementRecord({ ...record, ...change }, config.mId)).toThrow('invalid_response');
    }
  });
});

describe('read-only paginated collection', () => {
  it('uses GET, fixed official origin, server-only Basic auth and a >=60s timeout', async () => {
    const request = vi.fn(async () => response([record]));
    const timeout = vi.spyOn(AbortSignal, 'timeout');
    const result = await fetchTossSettlementPage(config, query, 2, { fetch: request });
    expect(request).toHaveBeenCalledOnce();
    const [url, init] = request.mock.calls[0] as unknown as [URL, RequestInit];
    expect(url.origin + url.pathname).toBe('https://api.tosspayments.com/v1/settlements');
    expect(Object.fromEntries(url.searchParams)).toEqual({ ...query, startDate: '2026-09-30', endDate: '2026-11-01', page: '2', size: String(SETTLEMENT_PAGE_SIZE) });
    expect(init).toMatchObject({ method: 'GET', redirect: 'error', cache: 'no-store', headers: { Authorization: `Basic ${Buffer.from(config.secretKey + ':').toString('base64')}` } });
    expect(timeout).toHaveBeenCalledWith(SETTLEMENT_REQUEST_TIMEOUT_MS);
    expect(SETTLEMENT_REQUEST_TIMEOUT_MS).toBeGreaterThanOrEqual(60000);
    expect(result).toMatchObject({ records: [record], page: 2, terminal: true });
    expect(result.sourceHash).toMatch(/^[a-f0-9]{64}$/); expect(result.recordsHash).toMatch(/^[a-f0-9]{64}$/);
  });
  it('uses a short or empty page as termination and requests another page after a full page', async () => {
    const full = Array.from({ length: SETTLEMENT_PAGE_SIZE }, (_, i) => ({ ...record, transactionKey: `fixture-transaction-${i}` }));
    expect((await fetchTossSettlementPage(config, query, 1, { fetch: async () => response(full) })).terminal).toBe(false);
    expect((await fetchTossSettlementPage(config, query, 2, { fetch: async () => response([]) })).terminal).toBe(true);
  });
  it('rejects duplicate transactions and out-of-range provider records', async () => {
    await expect(fetchTossSettlementPage(config, query, 1, { fetch: async () => response([record, record]) })).rejects.toMatchObject({ code: 'duplicate_transaction' });
    await expect(fetchTossSettlementPage(config, query, 1, { fetch: async () => response([{ ...record, paidOutDate: '2026-11-02' }]) })).rejects.toMatchObject({ code: 'invalid_response' });
  });
  it('retains wire types: number tokens cannot masquerade as string identifiers or labels', async () => {
    for (const key of ['mId', 'paymentKey', 'transactionKey', 'orderId', 'currency', 'method', 'approvedAt', 'soldDate', 'paidOutDate']) {
      await expect(fetchTossSettlementPage(config, query, 1, { fetch: async () => response([{ ...record, [key]: 123456 }]) })).rejects.toMatchObject({ code: 'invalid_response' });
    }
    const exact = JSON.stringify([record]).replace('"13000"', '9007199254740993').replace('"315.45"', '0.10000001');
    const result = await fetchTossSettlementPage(config, query, 1, { fetch: async () => new Response(exact) });
    expect(result.records[0].amount).toBe('9007199254740993'); expect(result.records[0].fees[0].fee).toBe('0.10000001');
  });
  it('covers both date boundaries without counting adjacent days or prematurely ending a filtered page', async () => {
    const rows = [
      { ...record, transactionKey: 'first', paidOutDate: query.startDate },
      { ...record, transactionKey: 'last', paidOutDate: query.endDate },
      { ...record, transactionKey: 'before', paidOutDate: '2026-09-30' },
      { ...record, transactionKey: 'after', paidOutDate: '2026-11-01' },
    ];
    const result = await fetchTossSettlementPage(config, query, 1, { fetch: async () => response(rows) });
    expect(result.records.map(row => row.transactionKey)).toEqual(['first', 'last']);
    expect(result.sourceCount).toBe(4);
    const outside = Array.from({ length: 1000 }, (_, i) => ({ ...record, transactionKey: `outside-${i}`, paidOutDate: '2026-09-30' }));
    expect(await fetchTossSettlementPage(config, query, 1, { fetch: async () => response(outside) })).toMatchObject({ records: [], sourceCount: 1000, terminal: false });
  });
  it('rejects excessive pages and rows without a provider call for bad input', async () => {
    const request = vi.fn(async () => response([]));
    await expect(fetchTossSettlementPage(config, query, 22, { fetch: request })).rejects.toMatchObject({ code: 'invalid_request' });
    expect(request).not.toHaveBeenCalled();
    await expect(fetchTossSettlementPage(config, query, 21, { fetch: async () => response([record]) })).rejects.toMatchObject({ code: 'page_limit' });
    expect((await fetchTossSettlementPage(config, query, 21, { fetch: async () => response([]) })).terminal).toBe(true);
    await expect(fetchTossSettlementPage(config, query, 1, { fetch: async () => response(Array(1001).fill(record)) })).rejects.toMatchObject({ code: 'invalid_response' });
  });
  it('rejects unsafe or partial content while keeping raw provider errors private', async () => {
    for (const [status, code] of [[401, 'provider_credentials'], [403, 'provider_credentials'], [429, 'provider_unavailable'], [500, 'provider_unavailable']] as const) {
      await expect(fetchTossSettlementPage(config, query, 1, { fetch: async () => new Response('private-provider-text', { status }) })).rejects.toMatchObject({ message: code });
    }
    await expect(fetchTossSettlementPage(config, query, 1, { fetch: async () => new Response('[{"amount":1,"amount":2}]') })).rejects.toMatchObject({ code: 'invalid_response' });
    await expect(fetchTossSettlementPage(config, query, 1, { fetch: async () => new Response('[]', { headers: { 'content-length': '8388609' } }) })).rejects.toMatchObject({ code: 'response_too_large' });
    await expect(fetchTossSettlementPage(config, query, 1, { fetch: async () => { throw new Error('private-credential'); } })).rejects.toMatchObject({ message: 'provider_unavailable' });
  });
  it('cancels a response stream as soon as its header exceeds the body limit', async () => {
    const cancel = vi.fn();
    const stream = new ReadableStream({ cancel });
    await expect(fetchTossSettlementPage(config, query, 1, { fetch: async () => new Response(stream, { headers: { 'content-length': '8388609' } }) })).rejects.toMatchObject({ code: 'response_too_large' });
    expect(cancel).toHaveBeenCalledOnce();
  });
});

describe('runtime activation', () => {
  it('stays OFF by default and requires explicit MID plus the existing aligned key pair', () => {
    vi.stubEnv('TOSS_SETTLEMENT_SYNC_ENABLED', ''); expect(readTossSettlementConfiguration()).toBeNull();
    vi.stubEnv('TOSS_SETTLEMENT_SYNC_ENABLED', 'true');
    vi.stubEnv('TOSS_SECRET_KEY', config.secretKey); vi.stubEnv('NEXT_PUBLIC_TOSS_CLIENT_KEY', 'test_gck_settlementfixture001');
    vi.stubEnv('TOSS_SETTLEMENT_MID', ''); expect(readTossSettlementConfiguration()).toBeNull();
    vi.stubEnv('TOSS_SETTLEMENT_MID', config.mId);
    const current = readTossSettlementConfiguration(); expect(current).toMatchObject({ mId: config.mId, mode: 'test' });
    expect(current?.scopeHash).toMatch(/^[a-f0-9]{64}$/);
    vi.stubEnv('TOSS_SECRET_KEY', 'test_gsk_settlementfixture002'); expect(readTossSettlementConfiguration()?.scopeHash).not.toBe(current?.scopeHash);
  });
  it('blocks live credentials in preview/local and mode mismatch everywhere', () => {
    vi.stubEnv('TOSS_SETTLEMENT_SYNC_ENABLED', 'true'); vi.stubEnv('TOSS_SETTLEMENT_MID', config.mId);
    vi.stubEnv('TOSS_SECRET_KEY', 'live_gsk_settlementfixture001'); vi.stubEnv('NEXT_PUBLIC_TOSS_CLIENT_KEY', 'live_gck_settlementfixture001');
    vi.stubEnv('VERCEL_ENV', 'preview'); expect(readTossSettlementConfiguration()).toBeNull();
    vi.stubEnv('VERCEL_ENV', 'production'); expect(readTossSettlementConfiguration()).toMatchObject({ mode: 'live' });
    vi.stubEnv('NEXT_PUBLIC_TOSS_CLIENT_KEY', 'test_gck_settlementfixture001'); expect(readTossSettlementConfiguration()).toBeNull();
  });
});
