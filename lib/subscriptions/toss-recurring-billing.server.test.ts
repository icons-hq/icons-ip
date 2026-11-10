import { afterEach, describe, expect, it, vi } from 'vitest';
import { BILLING_TEST_NOW, BILLING_TEST_PROFILE, billingCanceledFixture, billingChargeFixture, billingPaymentFixture,
  billingRefundFixture, billingRegistrationFixture } from '../../test/fixtures/recurring-billing';
import { createBillingProfileRegistry } from './billing-profiles.server';
import { createTossRecurringBilling } from './toss-recurring-billing.server';

function setup(responses: Array<Response | Error | (() => Promise<Response>)>, profile = BILLING_TEST_PROFILE) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const fetcher = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} }); const next = responses.shift();
    if (!next) throw new Error('unexpected synthetic request'); if (next instanceof Error) throw next;
    return typeof next === 'function' ? next() : next;
  }) as typeof fetch;
  const adapter = createTossRecurringBilling({ profiles: createBillingProfileRegistry([profile]), fetch: fetcher, now: () => BILLING_TEST_NOW });
  return { adapter, calls, fetcher };
}

describe('Toss recurring billing Adapter', () => {
  afterEach(() => { vi.useRealTimers(); });

  it('일회 인증을 exact write key와 멱등키로 교환하고 마스킹 카드만 추출한다', async () => {
    const input = billingRegistrationFixture();
    const { adapter, calls } = setup([Response.json({ mId: input.merchantId, customerKey: input.customerKey,
      billingKey: 'fake-issued-key', method: '카드', authenticatedAt: '2026-10-14T00:59:00Z',
      card: { issuerCode: '61', number: '43301234****123*', privateField: 'never-copy' } })]);
    await expect(adapter.register(input)).resolves.toEqual({ state: 'ready', billingKey: 'fake-issued-key',
      authenticatedAt: '2026-10-14T00:59:00.000Z', card: { issuerCode: '61', number: '43301234****123*' } });
    expect(calls[0].url).toBe('https://api.tosspayments.com/v1/billing/authorizations/issue');
    expect(calls[0].init.headers).toMatchObject({ 'idempotency-key': input.idempotencyKey,
      authorization: `Basic ${Buffer.from(`${BILLING_TEST_PROFILE.secretKeys.v1}:`).toString('base64')}` });
    expect(JSON.parse(String(calls[0].init.body))).toEqual({ authKey: input.authKey, customerKey: input.customerKey });
  });

  it.each([{ mId: 'other' }, { customerKey: 'someone' }, { method: '계좌이체' },
    { card: { issuerCode: '61', number: '4111111111111111' } }, { authenticatedAt: 'not-a-date' }])('등록 증거 불일치 %j를 활성 카드로 만들지 않는다', async change => {
    const input = billingRegistrationFixture();
    const { adapter } = setup([Response.json({ mId: input.merchantId, customerKey: input.customerKey, billingKey: 'fake-key',
      method: '카드', authenticatedAt: '2026-10-14T00:59:00Z', card: { issuerCode: '61', number: '43301234****123*' }, ...change })]);
    await expect(adapter.register(input)).resolves.toMatchObject({ state: 'needs_review' });
  });

  it('청구는 서버 금액·주문번호·등록 고객을 사용하고 secret 경로를 escape한다', async () => {
    const input = billingChargeFixture(); const { adapter, calls } = setup([Response.json(billingPaymentFixture())]);
    await expect(adapter.charge(input)).resolves.toMatchObject({ outcome: 'approved', evidence: { paymentMethod: '카드',
      providerPaymentKey: 'fake-payment-key-fixture', maskedPaymentMethod: '43301234****123*' } });
    expect(calls).toHaveLength(1); expect(calls[0].url).toBe(`https://api.tosspayments.com/v1/billing/${encodeURIComponent(input.billingKey)}`);
    expect(JSON.parse(String(calls[0].init.body))).toEqual({ customerKey: input.customerKey, amount: input.attempt.amount,
      orderId: input.attempt.providerOrderId, orderName: 'ICONS 정기배송 주문' });
    expect(calls[0].init).toMatchObject({ method: 'POST', redirect: 'error', cache: 'no-store' });
  });

  it.each([{ mId: 'other' }, { type: 'NORMAL' }, { method: '가상계좌' }, { totalAmount: 24_999 },
    { orderId: 'different-order' }, { currency: 'USD' }, { paymentKey: 'bad\nkey' }, { balanceAmount: 24_999 },
    { card: { issuerCode: '61', number: '4111111111111111', approveNo: '12345678' } },
    { approvedAt: 'invalid-date' }, { approvedAt: '2027-01-01T00:00:00Z' }])('승인 200이어도 identity/증거 %j는 격리한다', async change => {
    const { adapter } = setup([Response.json(billingPaymentFixture(change))]);
    await expect(adapter.charge(billingChargeFixture())).resolves.toMatchObject({ outcome: 'needs_review' });
  });

  it.each([new Error('synthetic timeout'), new Response('broken', { status: 200 }),
    new Response('down', { status: 503 }), Response.json({ code: 'IDEMPOTENT_REQUEST_PROCESSING' }, { status: 409 })])('미확정 응답은 unknown이며 같은 작업에서 재청구하지 않는다', async response => {
    const { adapter, calls } = setup([response]);
    await expect(adapter.charge(billingChargeFixture())).resolves.toMatchObject({ outcome: 'unknown' });
    expect(calls).toHaveLength(1);
  });

  it('정확히 60초 provider 예산을 주고 timeout 뒤 POST를 반복하지 않는다', async () => {
    vi.useFakeTimers(); const observed: { signal: AbortSignal | null } = { signal: null };
    const adapter = createTossRecurringBilling({ profiles: createBillingProfileRegistry([BILLING_TEST_PROFILE]), now: () => BILLING_TEST_NOW,
      fetch: vi.fn(async (_url, init) => new Promise<Response>((_resolve, reject) => {
        observed.signal = init?.signal as AbortSignal; observed.signal.addEventListener('abort', () => reject(new Error('synthetic timeout')));
      })) });
    const pending = adapter.charge(billingChargeFixture());
    await vi.advanceTimersByTimeAsync(59_999); expect(observed.signal?.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1); await expect(pending).resolves.toMatchObject({ outcome: 'unknown' });
    expect(() => createTossRecurringBilling({ profiles: createBillingProfileRegistry([BILLING_TEST_PROFILE]), chargeTimeoutMs: 59_999 }))
      .toThrow('invalid_billing_timeout');
  });

  it('64 KiB 초과 스트림과 거짓 content-length를 모두 닫는다', async () => {
    const headerCases: Array<Record<string, string>> = [{}, { 'content-length': '1' }, { 'content-length': '65537' }];
    for (const headers of headerCases) {
      const { adapter } = setup([new Response('x'.repeat(65_537), { status: 200, headers })]);
      await expect(adapter.charge(billingChargeFixture())).resolves.toMatchObject({ outcome: 'unknown' });
    }
  });

  it('본문이 없는 인증 실패는 설정 검토, 확정 카드 거절은 미청구 실패다', async () => {
    const one = setup([new Response('', { status: 401 })]);
    await expect(one.adapter.charge(billingChargeFixture())).resolves.toMatchObject({ outcome: 'needs_review', reasonCode: 'billing_configuration_error' });
    const two = setup([Response.json({ code: 'REJECT_CARD_PAYMENT', message: 'provider raw ignored' }, { status: 400 })]);
    await expect(two.adapter.charge(billingChargeFixture())).resolves.toMatchObject({ outcome: 'declined', evidence: { resultCode: 'REJECT_CARD_PAYMENT' } });
  });

  it('오래된 404는 거절 확정이 아니며 조회는 같은 MID의 현재 키만 사용한다', async () => {
    const original = billingChargeFixture(); const input = { ...original, binding: { ...original.binding, firstDispatchedAt: '2026-09-01T00:00:00Z' } };
    const { adapter, calls } = setup([Response.json({ code: 'NOT_FOUND_PAYMENT' }, { status: 404 })]);
    await expect(adapter.inspect(input)).resolves.toMatchObject({ outcome: 'unknown', reasonCode: 'billing_inquiry_not_found' });
    expect(calls[0].init.headers).toMatchObject({ authorization: `Basic ${Buffer.from(`${BILLING_TEST_PROFILE.secretKeys.v2}:`).toString('base64')}` });
    expect(calls[0].init.method).toBe('GET');
  });

  it('15일이 지난 쓰기 또는 폐기된 write key는 다른 키로 fallback하지 않는다', async () => {
    const input = billingChargeFixture();
    const old = setup([], { ...BILLING_TEST_PROFILE, secretKeys: { v2: BILLING_TEST_PROFILE.secretKeys.v2 } });
    await expect(old.adapter.charge(input)).resolves.toMatchObject({ outcome: 'needs_review', reasonCode: 'billing_write_key_unavailable' });
    const expired = setup([]);
    await expect(expired.adapter.charge({ ...input, binding: { ...input.binding, firstDispatchedAt: '2026-09-29T00:59:00Z' } }))
      .resolves.toMatchObject({ outcome: 'needs_review' });
    expect(old.calls).toHaveLength(0); expect(expired.calls).toHaveLength(0);
  });

  it('환급은 현재 조회·고정 환급 write key·독립 fresh 조회를 사용한다', async () => {
    const { adapter, calls } = setup([Response.json(billingPaymentFixture()), new Error('synthetic lost cancel response'), Response.json(billingCanceledFixture())]);
    await expect(adapter.refund(billingRefundFixture())).resolves.toMatchObject({ outcome: 'approved', refundedAmount: 25_000,
      evidence: { resultCode: 'CANCELED', providerPaymentKey: 'fake-payment-key-fixture' } });
    expect(calls.map(row => row.init.method)).toEqual(['GET', 'POST', 'GET']);
    expect(calls[1].init.headers).toMatchObject({ 'idempotency-key': 'billing-refund-fixture' });
  });

  it('취소 API 200만으로 환급 완료를 표시하지 않는다', async () => {
    const { adapter } = setup([Response.json(billingPaymentFixture()), Response.json(billingCanceledFixture()), Response.json(billingPaymentFixture())]);
    await expect(adapter.refund(billingRefundFixture())).resolves.toMatchObject({ outcome: 'unknown' });
  });

  it.each([
    { status: 'PARTIAL_CANCELED', balanceAmount: 1 }, { cancels: [] },
    { cancels: [{ transactionKey: 'fake-cancel', cancelAmount: 24_999, cancelStatus: 'DONE', canceledAt: '2026-10-14T01:00:00Z' }] },
    { cancels: [{ transactionKey: 'fake-cancel', cancelAmount: 25_000, cancelStatus: 'PENDING', canceledAt: '2026-10-14T01:00:00Z' }] },
  ])('부분/미완/합계 불일치 취소 %j를 전액 환급으로 올리지 않는다', async change => {
    const { adapter, calls } = setup([Response.json({ ...billingCanceledFixture(), ...change })]);
    await expect(adapter.refund(billingRefundFixture())).resolves.toMatchObject({ outcome: 'needs_review' });
    expect(calls).toHaveLength(1);
  });

  it('전액 취소 재생은 POST 없이 성공하고 부분 환급 요청은 네트워크 전에 막는다', async () => {
    const { adapter, calls } = setup([Response.json(billingCanceledFixture())]);
    await expect(adapter.refund(billingRefundFixture())).resolves.toMatchObject({ outcome: 'approved', refundedAmount: 25_000 });
    await expect(adapter.refund({ ...billingRefundFixture(), amount: 100 })).resolves.toMatchObject({ outcome: 'needs_review' });
    expect(calls).toHaveLength(1);
  });

  it('등록 해지는 공식 빈 200만 완료이며 손실/404는 미확정으로 남긴다', async () => {
    const input = { ...BILLING_TEST_PROFILE, billingKey: billingChargeFixture().billingKey };
    const { adapter } = setup([new Response(null, { status: 200 }), new Response(null, { status: 404 }), new Error('synthetic timeout')]);
    await expect(adapter.revoke(input)).resolves.toMatchObject({ state: 'revoked' });
    await expect(adapter.revoke(input)).resolves.toMatchObject({ state: 'unknown' });
    await expect(adapter.revoke(input)).resolves.toMatchObject({ state: 'unknown' });
  });
});
