import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  createClient: vi.fn(),
  createServiceClient: vi.fn(),
  getPaymentGateway: vi.fn(),
  receiptUrl: vi.fn(),
}));
vi.mock('server-only', () => ({}));
vi.mock('@/lib/supabase/server', () => ({ createClient: mocks.createClient }));
vi.mock('@/lib/supabase/service', () => ({ createServiceClient: mocks.createServiceClient }));
vi.mock('@/lib/payments/runtime-gateway', () => ({ getPaymentGateway: mocks.getPaymentGateway }));

import { resolveOrderReceipt } from './receipt.server';

const USER_ID = '10000000-0000-4000-8000-000000000001';
const ORDER_ID = '20000000-0000-4000-8000-000000002051';
const PAYMENT_ID = '30000000-0000-4000-8000-000000003001';
const PAYMENT_KEY = 'tviva20261117000000secretPAYMENTkey0001';
const RECEIPT_URL = 'https://dashboard.tosspayments.com/receipt/redirection?transactionId=abc&ref=PX';

interface Recorded { table: string; select: string; filters: Array<[string, unknown]>; orders: Array<[string, boolean]>; limit: number | null }

/** 질의 빌더를 흉내 낸다. 조건·정렬을 기록해 두고, await 하면 정해 둔 결과를 돌려준다. */
function builder(table: string, result: { data: unknown; error: { code?: string; message?: string } | null }, recorded: Recorded[]) {
  const record: Recorded = { table, select: '', filters: [], orders: [], limit: null };
  recorded.push(record);
  const chain: Record<string, unknown> = {
    select: (columns: string) => { record.select = columns; return chain; },
    eq: (column: string, value: unknown) => { record.filters.push([column, value]); return chain; },
    in: (column: string, value: unknown) => { record.filters.push([`${column}:in`, value]); return chain; },
    order: (column: string, options: { ascending: boolean }) => { record.orders.push([column, options.ascending]); return chain; },
    limit: (count: number) => { record.limit = count; return chain; },
    maybeSingle: () => Promise.resolve(result),
    then: (resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) => Promise.resolve(result).then(resolve, reject),
  };
  return chain;
}

let customerCalls: Recorded[];
let serviceCalls: Recorded[];
let errorLog: ReturnType<typeof vi.spyOn>;

function arrange(options: {
  summaries?: { data: unknown; error: { code?: string } | null };
  keyRow?: { data: unknown; error: { code?: string } | null };
} = {}) {
  const summaries = options.summaries ?? { data: [{ id: PAYMENT_ID, provider: 'toss', status: 'paid' }], error: null };
  const keyRow = options.keyRow ?? { data: { payment_key: PAYMENT_KEY }, error: null };
  mocks.createClient.mockResolvedValue({ from: (table: string) => builder(table, summaries, customerCalls) });
  mocks.createServiceClient.mockReturnValue({ from: (table: string) => builder(table, keyRow, serviceCalls) });
}

beforeEach(() => {
  vi.clearAllMocks();
  customerCalls = [];
  serviceCalls = [];
  errorLog = vi.spyOn(console, 'error').mockImplementation(() => {});
  mocks.receiptUrl.mockResolvedValue({ kind: 'ok', url: RECEIPT_URL });
  mocks.getPaymentGateway.mockReturnValue({ receiptUrl: mocks.receiptUrl });
  arrange();
});
afterEach(() => errorLog.mockRestore());

describe('resolveOrderReceipt', () => {
  it('고객 읽기로 소유를 확인하고, 그 결제 id 한 행의 payment_key만 service로 읽어 결제사 URL을 돌려준다', async () => {
    expect(await resolveOrderReceipt(USER_ID, ORDER_ID)).toEqual({ kind: 'redirect', url: RECEIPT_URL });

    expect(customerCalls).toHaveLength(1);
    expect(customerCalls[0]).toMatchObject({ table: 'payment_summaries', select: 'id,provider,status', limit: 1 });
    expect(customerCalls[0].filters).toEqual(expect.arrayContaining([
      ['user_id', USER_ID], ['purpose', 'order'], ['ref_id', ORDER_ID], ['status:in', ['paid', 'canceled', 'refunded']],
    ]));
    expect(customerCalls[0].orders).toEqual([['created_at', false], ['id', false]]);

    expect(serviceCalls).toHaveLength(1);
    expect(serviceCalls[0]).toMatchObject({ table: 'payments', select: 'payment_key' });
    /* service 조회 키는 고객 읽기로 얻은 결제 id 하나다(주문 id로 다시 찾지 않는다). */
    expect(serviceCalls[0].filters).toContainEqual(['id', PAYMENT_ID]);
    expect(serviceCalls[0].filters.map(([column]) => column)).not.toContain('ref_id');
    expect(mocks.getPaymentGateway).toHaveBeenCalledWith('toss');
    expect(mocks.receiptUrl).toHaveBeenCalledWith(PAYMENT_KEY);
    expect(errorLog).not.toHaveBeenCalled();
  });

  it('결제 뒤 취소·환불된 결제도 이동시킨다', async () => {
    for (const status of ['canceled', 'refunded']) {
      arrange({ summaries: { data: [{ id: PAYMENT_ID, provider: 'toss', status }], error: null } });
      expect(await resolveOrderReceipt(USER_ID, ORDER_ID), status).toEqual({ kind: 'redirect', url: RECEIPT_URL });
    }
  });

  it('고객이 읽을 수 있는 결제가 없으면(남의 주문·결제 전) service도 gateway도 부르지 않고 unavailable이다', async () => {
    arrange({ summaries: { data: [], error: null } });
    expect(await resolveOrderReceipt(USER_ID, ORDER_ID)).toEqual({ kind: 'unavailable' });
    expect(mocks.createServiceClient).not.toHaveBeenCalled();
    expect(mocks.getPaymentGateway).not.toHaveBeenCalled();
    expect(errorLog).toHaveBeenCalledWith('[orders] receipt unavailable', 'payment_missing');
  });

  it('영수증을 지원하지 않는 provider(korpay·nicepay·무통장)는 service 읽기 전에 unavailable이다', async () => {
    for (const provider of ['korpay', 'nicepay', 'bank_transfer']) {
      arrange({ summaries: { data: [{ id: PAYMENT_ID, provider, status: 'paid' }], error: null } });
      expect(await resolveOrderReceipt(USER_ID, ORDER_ID), provider).toEqual({ kind: 'unavailable' });
    }
    expect(mocks.createServiceClient).not.toHaveBeenCalled();
    expect(mocks.getPaymentGateway).not.toHaveBeenCalled();
    expect(errorLog).toHaveBeenCalledWith('[orders] receipt unavailable', 'provider_unsupported');
  });

  it('결제 상태가 영수증이 남는 상태가 아니면(결제 전·실패) unavailable이다', async () => {
    for (const status of ['pending', 'failed']) {
      arrange({ summaries: { data: [{ id: PAYMENT_ID, provider: 'toss', status }], error: null } });
      expect(await resolveOrderReceipt(USER_ID, ORDER_ID), status).toEqual({ kind: 'unavailable' });
    }
    expect(mocks.createServiceClient).not.toHaveBeenCalled();
  });

  it('고객 읽기가 오류거나 행 모양이 어긋나면 unavailable이다', async () => {
    arrange({ summaries: { data: null, error: { code: '42501' } } });
    expect(await resolveOrderReceipt(USER_ID, ORDER_ID)).toEqual({ kind: 'unavailable' });
    arrange({ summaries: { data: [{ id: 7, provider: 'toss', status: 'paid' }], error: null } });
    expect(await resolveOrderReceipt(USER_ID, ORDER_ID)).toEqual({ kind: 'unavailable' });
    expect(mocks.createServiceClient).not.toHaveBeenCalled();
  });

  it('service 읽기의 payment_key가 null·빈 값·오류·너무 길면 unavailable이고 gateway를 부르지 않는다', async () => {
    for (const keyRow of [
      { data: { payment_key: null }, error: null },
      { data: { payment_key: '' }, error: null },
      { data: { payment_key: 'k'.repeat(201) }, error: null },
      { data: { payment_key: 123 }, error: null },
      { data: null, error: null },
      { data: null, error: { code: '42501' } },
    ]) {
      arrange({ keyRow });
      expect(await resolveOrderReceipt(USER_ID, ORDER_ID), JSON.stringify(keyRow)).toEqual({ kind: 'unavailable' });
    }
    expect(mocks.getPaymentGateway).not.toHaveBeenCalled();
    /* 키를 못 읽은 사유는 코드로 남는다(오류든 빈 값이든). 키 자체는 남기지 않는다. */
    expect(errorLog).toHaveBeenCalledWith('[orders] receipt unavailable', 'key_read');
    expect(errorLog).toHaveBeenCalledWith('[orders] receipt unavailable', 'key_missing');
  });

  it('gateway에 receiptUrl이 없거나(미설정 환경) 결과가 ok가 아니면 unavailable이고 사유 코드만 한 줄 남긴다', async () => {
    mocks.getPaymentGateway.mockReturnValue({});
    expect(await resolveOrderReceipt(USER_ID, ORDER_ID)).toEqual({ kind: 'unavailable' });
    expect(errorLog).toHaveBeenLastCalledWith('[orders] receipt unavailable', 'gateway_missing');
    mocks.getPaymentGateway.mockReturnValue({ receiptUrl: mocks.receiptUrl });
    for (const kind of ['not_found', 'unavailable', 'not_supported']) {
      mocks.receiptUrl.mockResolvedValueOnce({ kind });
      expect(await resolveOrderReceipt(USER_ID, ORDER_ID), kind).toEqual({ kind: 'unavailable' });
      expect(errorLog).toHaveBeenLastCalledWith('[orders] receipt unavailable', `gateway_${kind}`);
    }
    /* 어댑터가 준 사유(닫힌 코드)는 종류 뒤에 붙는다 — 키 설정 오류·결제사 장애를 로그에서 가려낼 수 있다. */
    mocks.receiptUrl.mockResolvedValueOnce({ kind: 'unavailable', reason: 'configuration_error' });
    expect(await resolveOrderReceipt(USER_ID, ORDER_ID)).toEqual({ kind: 'unavailable' });
    expect(errorLog).toHaveBeenLastCalledWith('[orders] receipt unavailable', 'gateway_unavailable:configuration_error');
    mocks.receiptUrl.mockResolvedValueOnce({ kind: 'not_found', reason: 'payment_not_found' });
    expect(await resolveOrderReceipt(USER_ID, ORDER_ID)).toEqual({ kind: 'unavailable' });
    expect(errorLog).toHaveBeenLastCalledWith('[orders] receipt unavailable', 'gateway_not_found:payment_not_found');
  });

  it('gateway가 허용 호스트 밖 URL을 돌려줘도 이동시키지 않는다', async () => {
    for (const url of ['http://dashboard.tosspayments.com/r', 'https://evil.example.com/r', 'https://tosspayments.com.evil.com/r']) {
      mocks.receiptUrl.mockResolvedValueOnce({ kind: 'ok', url });
      expect(await resolveOrderReceipt(USER_ID, ORDER_ID), url).toEqual({ kind: 'unavailable' });
    }
  });

  it('어느 단계가 던져도 throw하지 않고 unavailable이다', async () => {
    mocks.createClient.mockRejectedValueOnce(new Error('cookies unavailable'));
    expect(await resolveOrderReceipt(USER_ID, ORDER_ID)).toEqual({ kind: 'unavailable' });
    arrange();
    mocks.createServiceClient.mockImplementationOnce(() => { throw new Error('Missing SUPABASE_SERVICE_ROLE_KEY'); });
    expect(await resolveOrderReceipt(USER_ID, ORDER_ID)).toEqual({ kind: 'unavailable' });
    arrange();
    mocks.receiptUrl.mockRejectedValueOnce(new Error('network down'));
    expect(await resolveOrderReceipt(USER_ID, ORDER_ID)).toEqual({ kind: 'unavailable' });
  });

  it('결제 키·주문 id·사용자 id·영수증 URL을 로그에 남기지 않는다', async () => {
    const failures: Array<() => void> = [
      () => arrange({ summaries: { data: null, error: { code: '42501' } } }),
      () => arrange({ keyRow: { data: null, error: { code: '42501' } } }),
      () => mocks.receiptUrl.mockResolvedValueOnce({ kind: 'ok', url: 'https://evil.example.com/r' }),
      () => mocks.createClient.mockRejectedValueOnce(new Error(`boom ${PAYMENT_KEY} ${ORDER_ID}`)),
    ];
    for (const prepare of failures) {
      arrange();
      prepare();
      expect(await resolveOrderReceipt(USER_ID, ORDER_ID)).toEqual({ kind: 'unavailable' });
    }
    const logged = JSON.stringify(errorLog.mock.calls);
    expect(errorLog).toHaveBeenCalled();
    for (const secret of [PAYMENT_KEY, ORDER_ID, USER_ID, PAYMENT_ID, 'evil.example.com']) expect(logged).not.toContain(secret);
  });
});
