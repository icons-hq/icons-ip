import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import type { PaymentAttempt, PaymentReturnInput } from './gateway';
import { createNicepayPaymentGateway, type NicepayPaymentReferenceStore } from './nicepay-gateway.server';

// 형식만 맞춘 가짜 자격 증명이다. 실제 MID·MerchantKey는 저장소에 두지 않는다.
const MERCHANT_ID = 'iconst000m';
const MERCHANT_KEY = 'c2VydmVyLW9ubHktbmljZXBheS1rZXktZml4dHVyZS0yMDI2';
const FIXED_NOW = new Date('2026-11-06T10:15:00+09:00');
const ATTEMPT: PaymentAttempt = {
  id: '30000000-0000-4000-8000-000000000611',
  provider: 'nicepay',
  purpose: 'order',
  refId: '20000000-0000-4000-8000-000000000611',
  amount: 31_000,
  currency: 'KRW',
  idempotencyKey: 'goods:20000000-0000-4000-8000-000000000611',
  providerOrderId: 'O30000000000040008000000000000611',
  providerProductCode: 'P30000000000040008000000000000611',
  // FIXED_NOW + 5분 — 준비 시각은 만료 10분 전(10:10:00 KST)으로 파생된다.
  expiresAt: '2026-11-06T01:20:00.000Z',
};
const TID = 'iconst000m01162611061015001234';
const AUTH_TOKEN = 'NICETOKN0123456789ABCDEF0123456789ABCD';
const APPROVE_URL = 'https://dc1-api.nicepay.co.kr/webapi/pay_process.jsp';
const NET_CANCEL_URL = 'https://dc1-api.nicepay.co.kr/webapi/cancel_process.jsp';
const CANCEL_URL = 'https://pg-api.nicepay.co.kr/webapi/cancel_process.jsp';
const INQUIRY_URL = 'https://webapi.nicepay.co.kr/webapi/inquery/trans_status.jsp';

function sha256(value: string) {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

interface Call {
  readonly url: string;
  readonly fields: URLSearchParams;
}

type Reply = Record<string, unknown> | 'network_error' | { status: number };

function nicepayServer(replies: Record<string, Reply[]>) {
  const calls: Call[] = [];
  const queues = new Map(Object.entries(replies).map(([url, list]) => [url, [...list]]));
  const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, fields: new URLSearchParams(String(init?.body ?? '')) });
    const reply = queues.get(url)?.shift();
    if (!reply) throw new Error(`unexpected NICEPAY call: ${url}`);
    if (reply === 'network_error') throw new TypeError('fetch failed');
    if ('status' in reply && typeof reply.status === 'number' && Object.keys(reply).length === 1) {
      return new Response('error', { status: reply.status });
    }
    return Response.json(reply);
  }) as unknown as typeof fetch;
  return { fetchImpl, calls };
}

function referenceStore(initial: string[] = []) {
  const recorded: Array<{ attemptId: string; transactionId: string }> = [];
  const store: NicepayPaymentReferenceStore & { recorded: typeof recorded } = {
    recorded,
    record: vi.fn(async (attemptId: string, transactionId: string) => {
      recorded.push({ attemptId, transactionId });
    }),
    list: vi.fn(async () => initial),
  };
  return store;
}

function gateway(
  fetchImpl: typeof fetch = vi.fn() as unknown as typeof fetch,
  references: NicepayPaymentReferenceStore = referenceStore(),
  now: () => Date = () => FIXED_NOW,
) {
  return createNicepayPaymentGateway({
    merchantId: MERCHANT_ID,
    merchantKey: MERCHANT_KEY,
    siteUrl: 'https://icons.example',
    references,
    fetch: fetchImpl,
    now,
  });
}

async function preparedNonce() {
  return (await gateway().prepare(ATTEMPT)).callbackNonce;
}

function authCallback(nonce: string, overrides: Record<string, unknown> = {}) {
  const amount = String(ATTEMPT.amount);
  return {
    AuthResultCode: '0000',
    AuthToken: AUTH_TOKEN,
    PayMethod: 'CARD',
    MID: MERCHANT_ID,
    Moid: ATTEMPT.providerOrderId,
    Amt: amount,
    ReqReserved: nonce,
    TxTid: TID,
    NextAppURL: APPROVE_URL,
    NetCancelURL: NET_CANCEL_URL,
    Signature: sha256(`${AUTH_TOKEN}${MERCHANT_ID}${amount}${MERCHANT_KEY}`),
    ...overrides,
  };
}

function returnInput(nonce: string, payload: unknown): PaymentReturnInput {
  return {
    attempt: ATTEMPT,
    idempotencyKey: `confirm:${ATTEMPT.id}`,
    providerOrderId: ATTEMPT.providerOrderId,
    callbackNonce: nonce,
    providerPayload: payload,
  };
}

function approvedResponse(overrides: Record<string, unknown> = {}) {
  const paddedAmount = String(ATTEMPT.amount).padStart(12, '0');
  return {
    ResultCode: '3001',
    ResultMsg: '카드 결제 성공',
    Amt: paddedAmount,
    MID: MERCHANT_ID,
    Moid: ATTEMPT.providerOrderId,
    Signature: sha256(`${TID}${MERCHANT_ID}${paddedAmount}${MERCHANT_KEY}`),
    TID,
    AuthCode: '30012345',
    AuthDate: '261106101530',
    PayMethod: 'CARD',
    CardCode: '04',
    CardName: '삼성',
    CardNo: '53275012****1234',
    CardQuota: '00',
    UnknownFutureField: 'ignored',
    ...overrides,
  };
}

function canceledResponse(code = '2001', amount = ATTEMPT.amount) {
  const raw = String(amount);
  return {
    ResultCode: code,
    ResultMsg: '취소 성공',
    CancelAmt: raw,
    MID: MERCHANT_ID,
    TID,
    Signature: sha256(`${TID}${MERCHANT_ID}${raw}${MERCHANT_KEY}`),
  };
}

function inquiryResponse(status: '0' | '1' | '9') {
  return { ResultCode: '0000', ResultMsg: '정상', TID, Status: status };
}

describe('NICEPAY 웹표준 payment gateway', () => {
  it('문서의 SignData 규칙으로 결정적인 결제창 payload를 만들고 MerchantKey는 싣지 않는다', async () => {
    const prepared = await gateway().prepare(ATTEMPT);
    const again = await gateway().prepare(ATTEMPT);
    const ediDate = '20261106101000';

    expect(prepared).toEqual(again);
    expect(prepared).toMatchObject({
      attemptId: ATTEMPT.id,
      provider: 'nicepay',
      expiresAt: ATTEMPT.expiresAt,
      action: {
        kind: 'client_sdk',
        payload: {
          provider: 'nicepay',
          GoodsName: 'ICONS 굿즈 주문',
          Amt: '31000',
          MID: MERCHANT_ID,
          EdiDate: ediDate,
          Moid: ATTEMPT.providerOrderId,
          SignData: sha256(`${ediDate}${MERCHANT_ID}31000${MERCHANT_KEY}`),
          PayMethod: 'CARD',
          ReturnURL: 'https://icons.example/api/payments/goods/confirm/nicepay',
          ReqReserved: prepared.callbackNonce,
          CharSet: 'utf-8',
        },
      },
    });
    expect(prepared.callbackNonce).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(JSON.stringify(prepared)).not.toContain(MERCHANT_KEY);
  });

  it('티켓·다른 provider·최소 금액 미만·만료된 attempt는 준비하지 않는다', async () => {
    await expect(gateway().prepare({ ...ATTEMPT, purpose: 'ticket', providerOrderId: 'T30000000000040008000000000000611' }))
      .rejects.toThrow('invalid_payment_attempt');
    await expect(gateway().prepare({ ...ATTEMPT, provider: 'toss' })).rejects.toThrow('invalid_payment_attempt');
    await expect(gateway().prepare({ ...ATTEMPT, amount: 999 })).rejects.toThrow('invalid_payment_attempt');
    await expect(gateway(undefined, undefined, () => new Date('2026-11-06T10:21:00+09:00')).prepare(ATTEMPT))
      .rejects.toThrow('invalid_payment_attempt');
  });

  it('형식 밖 자격 증명이나 사이트 주소로는 어댑터를 만들지 않는다', () => {
    expect(() => createNicepayPaymentGateway({
      merchantId: 'short',
      merchantKey: MERCHANT_KEY,
      siteUrl: 'https://icons.example',
      references: referenceStore(),
    })).toThrow('invalid_nicepay_configuration');
    expect(() => createNicepayPaymentGateway({
      merchantId: MERCHANT_ID,
      merchantKey: MERCHANT_KEY,
      siteUrl: 'http://icons.example',
      references: referenceStore(),
    })).toThrow('invalid_nicepay_configuration');
  });

  it('TID를 먼저 기록한 뒤 서명된 승인 요청을 보내고 승인 응답을 대조해 approved로 닫는다', async () => {
    const nonce = await preparedNonce();
    const references = referenceStore();
    const server = nicepayServer({ [APPROVE_URL]: [approvedResponse()] });
    const outcome = await gateway(server.fetchImpl, references).confirm(returnInput(nonce, authCallback(nonce)));

    expect(references.recorded).toEqual([{ attemptId: ATTEMPT.id, transactionId: TID }]);
    expect(server.calls).toHaveLength(1);
    const approve = server.calls[0]!.fields;
    const ediDate = approve.get('EdiDate')!;
    expect(ediDate).toBe('20261106101500');
    expect(Object.fromEntries(approve)).toEqual({
      TID,
      AuthToken: AUTH_TOKEN,
      MID: MERCHANT_ID,
      Amt: '31000',
      EdiDate: ediDate,
      SignData: sha256(`${AUTH_TOKEN}${MERCHANT_ID}31000${ediDate}${MERCHANT_KEY}`),
      CharSet: 'utf-8',
      EdiType: 'JSON',
    });
    expect(outcome).toEqual({
      attemptId: ATTEMPT.id,
      provider: 'nicepay',
      outcome: 'approved',
      reasonCode: 'provider_approved',
      evidence: {
        providerPaymentKey: TID,
        providerTransactionId: TID,
        providerApprovalReference: '30012345',
        resultCode: '3001',
        paymentMethod: 'CARD',
        maskedPaymentMethod: '53275012****1234',
        approvedAt: '2026-11-06T01:15:30.000Z',
      },
    });
  });

  it('금액·주문번호·상점·nonce가 attempt와 다르면 기록도 승인도 하지 않는다', async () => {
    const nonce = await preparedNonce();
    for (const overrides of [
      { Amt: '30000' },
      { Moid: 'O30000000000040008000000000000999' },
      { MID: 'otherst00m' },
      { ReqReserved: 'x'.repeat(43) },
    ]) {
      const references = referenceStore();
      const server = nicepayServer({});
      const outcome = await gateway(server.fetchImpl, references)
        .confirm(returnInput(nonce, authCallback(nonce, overrides)));
      expect(outcome).toMatchObject({ outcome: 'needs_review', reasonCode: 'provider_identity_mismatch' });
      expect(server.calls).toHaveLength(0);
      expect(references.recorded).toHaveLength(0);
    }
  });

  it('인증 응답 서명이 맞지 않거나 승인 주소가 나이스페이 도메인이 아니면 승인 API를 부르지 않는다', async () => {
    const nonce = await preparedNonce();
    const cases: Array<[Record<string, unknown>, string]> = [
      [{ Signature: sha256('forged') }, 'provider_identity_mismatch'],
      [{ NextAppURL: 'https://attacker.example/webapi/pay_process.jsp' }, 'provider_invalid_callback'],
      [{ NextAppURL: 'http://dc1-api.nicepay.co.kr/webapi/pay_process.jsp' }, 'provider_invalid_callback'],
      [{ NetCancelURL: 'https://dc2-api.nicepay.co.kr/other.jsp' }, 'provider_invalid_callback'],
      [{ TxTid: 'bad tid' }, 'provider_invalid_callback'],
      [{ PayMethod: 'VBANK' }, 'provider_invalid_callback'],
    ];
    for (const [overrides, reasonCode] of cases) {
      const references = referenceStore();
      const server = nicepayServer({});
      const outcome = await gateway(server.fetchImpl, references)
        .confirm(returnInput(nonce, authCallback(nonce, overrides)));
      expect(outcome).toMatchObject({ outcome: 'needs_review', reasonCode });
      expect(server.calls).toHaveLength(0);
      expect(references.recorded).toHaveLength(0);
    }
  });

  it('인증이 실패하거나 구매자가 결제창을 닫으면 승인 API를 부르지 않는다', async () => {
    const nonce = await preparedNonce();
    const server = nicepayServer({});
    const canceled = await gateway(server.fetchImpl)
      .confirm(returnInput(nonce, authCallback(nonce, { AuthResultCode: 'I002', AuthToken: '', TxTid: '' })));
    const failed = await gateway(server.fetchImpl)
      .confirm(returnInput(nonce, authCallback(nonce, { AuthResultCode: 'W111' })));

    expect(canceled).toMatchObject({ outcome: 'canceled', reasonCode: 'provider_user_canceled', evidence: { resultCode: 'I002' } });
    expect(failed).toMatchObject({ outcome: 'declined', reasonCode: 'provider_authentication_failed', evidence: { resultCode: 'W111' } });
    expect(server.calls).toHaveLength(0);
  });

  it('TID 기록에 실패하면 승인 API를 부르지 않고 unknown으로 남긴다', async () => {
    const nonce = await preparedNonce();
    const references = referenceStore();
    vi.mocked(references.record).mockRejectedValueOnce(new Error('db down'));
    const server = nicepayServer({});
    const outcome = await gateway(server.fetchImpl, references).confirm(returnInput(nonce, authCallback(nonce)));

    expect(outcome).toEqual({
      attemptId: ATTEMPT.id,
      provider: 'nicepay',
      outcome: 'unknown',
      reasonCode: 'provider_reference_unrecorded',
    });
    expect(server.calls).toHaveLength(0);
  });

  it('승인 응답을 받지 못하면 망취소하고, 망취소가 확인되면 declined다', async () => {
    const nonce = await preparedNonce();
    const server = nicepayServer({
      [APPROVE_URL]: ['network_error'],
      [NET_CANCEL_URL]: [canceledResponse('2001')],
    });
    const outcome = await gateway(server.fetchImpl).confirm(returnInput(nonce, authCallback(nonce)));

    expect(server.calls.map((call) => call.url)).toEqual([APPROVE_URL, NET_CANCEL_URL]);
    const netCancel = server.calls[1]!.fields;
    const ediDate = netCancel.get('EdiDate')!;
    expect(Object.fromEntries(netCancel)).toMatchObject({
      TID,
      AuthToken: AUTH_TOKEN,
      MID: MERCHANT_ID,
      Amt: '31000',
      NetCancel: '1',
      SignData: sha256(`${AUTH_TOKEN}${MERCHANT_ID}31000${ediDate}${MERCHANT_KEY}`),
    });
    expect(outcome).toMatchObject({
      outcome: 'declined',
      reasonCode: 'provider_net_canceled',
      evidence: { providerPaymentKey: TID, providerTransactionId: TID, resultCode: '2001' },
    });
  });

  it('승인·망취소가 모두 모호하면 TID를 증거로 남긴 unknown이다', async () => {
    const nonce = await preparedNonce();
    const server = nicepayServer({
      [APPROVE_URL]: [{ status: 502 }],
      [NET_CANCEL_URL]: ['network_error'],
    });
    const outcome = await gateway(server.fetchImpl).confirm(returnInput(nonce, authCallback(nonce)));

    expect(outcome).toMatchObject({
      outcome: 'unknown',
      reasonCode: 'provider_unavailable',
      evidence: { providerPaymentKey: TID, providerTransactionId: TID, resultCode: 'approve_unanswered' },
    });
  });

  it('서명이 맞지 않는 망취소 성공 응답은 믿지 않는다', async () => {
    const nonce = await preparedNonce();
    const server = nicepayServer({
      [APPROVE_URL]: ['network_error'],
      [NET_CANCEL_URL]: [{ ...canceledResponse('2001'), Signature: sha256('forged') }],
    });
    const outcome = await gateway(server.fetchImpl).confirm(returnInput(nonce, authCallback(nonce)));
    expect(outcome).toMatchObject({ outcome: 'unknown', reasonCode: 'provider_unavailable' });
  });

  it('카드사 타임아웃처럼 승인 성립이 모호한 코드는 망취소로 되돌린다', async () => {
    const nonce = await preparedNonce();
    const server = nicepayServer({
      [APPROVE_URL]: [{ ResultCode: '1620', ResultMsg: '승인처리시 카드사 타임아웃 발생' }],
      [NET_CANCEL_URL]: [{ ResultCode: '2012', ResultMsg: '취소 해당거래 없음' }],
    });
    const outcome = await gateway(server.fetchImpl).confirm(returnInput(nonce, authCallback(nonce)));
    expect(outcome).toMatchObject({ outcome: 'declined', reasonCode: 'provider_net_canceled', evidence: { resultCode: '2012' } });
  });

  it('확정된 카드 거절은 망취소 없이 declined다', async () => {
    const nonce = await preparedNonce();
    const server = nicepayServer({ [APPROVE_URL]: [{ ResultCode: '3011', ResultMsg: '카드번호 오류' }] });
    const outcome = await gateway(server.fetchImpl).confirm(returnInput(nonce, authCallback(nonce)));

    expect(server.calls).toHaveLength(1);
    expect(outcome).toMatchObject({ outcome: 'declined', reasonCode: 'provider_declined', evidence: { resultCode: '3011' } });
  });

  it('승인 성공 응답이라도 서명·주문번호·금액이 어긋나면 needs_review로 격리하고 망취소하지 않는다', async () => {
    const nonce = await preparedNonce();
    for (const overrides of [
      { Signature: sha256('forged') },
      { Moid: 'O30000000000040008000000000000999' },
      { Amt: '000000030000', Signature: sha256(`${TID}${MERCHANT_ID}000000030000${MERCHANT_KEY}`) },
      { AuthDate: 'not-a-date' },
    ]) {
      const server = nicepayServer({ [APPROVE_URL]: [approvedResponse(overrides)] });
      const outcome = await gateway(server.fetchImpl).confirm(returnInput(nonce, authCallback(nonce)));
      expect(outcome).toMatchObject({
        outcome: 'needs_review',
        reasonCode: 'provider_identity_mismatch',
        evidence: { providerPaymentKey: TID, resultCode: '3001_identity_mismatch' },
      });
      expect(server.calls).toHaveLength(1);
    }
  });

  it('중복 승인·설정 오류 코드는 needs_review다', async () => {
    const nonce = await preparedNonce();
    const duplicate = nicepayServer({ [APPROVE_URL]: [{ ResultCode: '1651', ResultMsg: '승인 TID 중복 오류' }] });
    const configuration = nicepayServer({ [APPROVE_URL]: [{ ResultCode: 'A101', ResultMsg: 'SIGN DATA 검증 실패' }] });

    await expect(gateway(duplicate.fetchImpl).confirm(returnInput(nonce, authCallback(nonce))))
      .resolves.toMatchObject({ outcome: 'needs_review', reasonCode: 'provider_duplicate_requires_review' });
    await expect(gateway(configuration.fetchImpl).confirm(returnInput(nonce, authCallback(nonce))))
      .resolves.toMatchObject({ outcome: 'needs_review', reasonCode: 'provider_configuration_error' });
  });

  describe('reconcile', () => {
    it('TID 기록이 없으면 승인 호출이 없었으므로 declined다', async () => {
      const server = nicepayServer({});
      const outcome = await gateway(server.fetchImpl, referenceStore([])).reconcile(ATTEMPT);
      expect(outcome).toMatchObject({ outcome: 'declined', reasonCode: 'provider_payment_absent' });
      expect(server.calls).toHaveLength(0);
    });

    it('거래조회가 승인이면 자동 승인하지 않고 운영 확인으로 보낸다', async () => {
      const server = nicepayServer({ [INQUIRY_URL]: [inquiryResponse('0')] });
      const outcome = await gateway(server.fetchImpl, referenceStore([TID])).reconcile(ATTEMPT);
      const inquiry = server.calls[0]!.fields;

      expect(Object.fromEntries(inquiry)).toMatchObject({
        TID,
        MID: MERCHANT_ID,
        SignData: sha256(`${TID}${MERCHANT_ID}${inquiry.get('EdiDate')}${MERCHANT_KEY}`),
      });
      expect(outcome).toMatchObject({
        outcome: 'needs_review',
        reasonCode: 'provider_approval_unverified',
        evidence: { providerPaymentKey: TID, resultCode: 'Status_0' },
      });
    });

    it('취소된 거래는 declined, 거래 없음은 승인 가능 시한 뒤에만 declined다', async () => {
      const canceled = nicepayServer({ [INQUIRY_URL]: [inquiryResponse('1')] });
      await expect(gateway(canceled.fetchImpl, referenceStore([TID])).reconcile(ATTEMPT))
        .resolves.toMatchObject({ outcome: 'declined', reasonCode: 'provider_payment_canceled' });

      const early = nicepayServer({ [INQUIRY_URL]: [inquiryResponse('9')] });
      await expect(gateway(early.fetchImpl, referenceStore([TID])).reconcile(ATTEMPT))
        .resolves.toMatchObject({ outcome: 'unknown', reasonCode: 'provider_inquiry_not_found' });

      const late = nicepayServer({ [INQUIRY_URL]: [{ ResultCode: 'A251', ResultMsg: '거래 내역 없음' }] });
      await expect(gateway(late.fetchImpl, referenceStore([TID]), () => new Date('2026-11-06T11:10:00+09:00')).reconcile(ATTEMPT))
        .resolves.toMatchObject({ outcome: 'declined', reasonCode: 'provider_payment_absent' });
    });

    it('TID가 여럿이거나 조회가 실패하면 추측 종결하지 않는다', async () => {
      await expect(gateway(nicepayServer({}).fetchImpl, referenceStore([TID, 'iconst000m01162611061015009999'])).reconcile(ATTEMPT))
        .resolves.toMatchObject({ outcome: 'needs_review', reasonCode: 'provider_reference_ambiguous' });

      const references = referenceStore();
      vi.mocked(references.list).mockRejectedValueOnce(new Error('db down'));
      await expect(gateway(nicepayServer({}).fetchImpl, references).reconcile(ATTEMPT))
        .resolves.toMatchObject({ outcome: 'unknown', reasonCode: 'provider_reference_unavailable' });

      const unavailable = nicepayServer({ [INQUIRY_URL]: ['network_error'] });
      await expect(gateway(unavailable.fetchImpl, referenceStore([TID])).reconcile(ATTEMPT))
        .resolves.toMatchObject({ outcome: 'unknown', reasonCode: 'provider_unavailable' });

      const mismatch = nicepayServer({ [INQUIRY_URL]: [{ ...inquiryResponse('1'), TID: 'iconst000m01162611061015009999' }] });
      await expect(gateway(mismatch.fetchImpl, referenceStore([TID])).reconcile(ATTEMPT))
        .resolves.toMatchObject({ outcome: 'needs_review', reasonCode: 'provider_identity_mismatch' });
    });
  });

  describe('refund', () => {
    const refund = (overrides: Partial<Parameters<ReturnType<typeof gateway>['refund']>[0]> = {}) => ({
      attempt: ATTEMPT,
      idempotencyKey: `refund:${ATTEMPT.id}`,
      amount: ATTEMPT.amount,
      reason: 'ICONS 주문 취소',
      providerPaymentKey: TID,
      ...overrides,
    });

    it('원장 TID로 전액 취소를 보내고 취소 응답과 사후 조회가 모두 맞을 때만 approved다', async () => {
      const server = nicepayServer({
        [INQUIRY_URL]: [inquiryResponse('0'), inquiryResponse('1')],
        [CANCEL_URL]: [canceledResponse('2001')],
      });
      const outcome = await gateway(server.fetchImpl).refund(refund());
      const cancel = server.calls[1]!.fields;

      expect(server.calls.map((call) => call.url)).toEqual([INQUIRY_URL, CANCEL_URL, INQUIRY_URL]);
      expect(Object.fromEntries(cancel)).toMatchObject({
        TID,
        MID: MERCHANT_ID,
        Moid: ATTEMPT.providerOrderId,
        CancelAmt: '31000',
        // 한글 사유는 EUC-KR 인코딩을 피하려고 ASCII 고정 문구로 바꾼다.
        CancelMsg: 'ICONS order cancellation',
        PartialCancelCode: '0',
        SignData: sha256(`${MERCHANT_ID}31000${cancel.get('EdiDate')}${MERCHANT_KEY}`),
      });
      expect(outcome).toEqual({
        attemptId: ATTEMPT.id,
        provider: 'nicepay',
        outcome: 'approved',
        reasonCode: 'provider_cancel_confirmed',
        evidence: { providerPaymentKey: TID, providerTransactionId: TID, resultCode: 'Status_1' },
        refundedAmount: ATTEMPT.amount,
      });
    });

    it('이미 취소된 거래는 재취소 응답(취소 완료 거래)과 조회로 전액 취소를 확인한다', async () => {
      const server = nicepayServer({
        [INQUIRY_URL]: [inquiryResponse('1'), inquiryResponse('1')],
        [CANCEL_URL]: [{ ResultCode: '2013', ResultMsg: '취소 완료 거래' }],
      });
      await expect(gateway(server.fetchImpl).refund(refund({ reason: 'ops cancel' })))
        .resolves.toMatchObject({ outcome: 'approved', refundedAmount: ATTEMPT.amount });
      expect(server.calls[1]!.fields.get('CancelMsg')).toBe('ops cancel');
    });

    it('취소 거절 코드는 needs_review이고 사후 조회를 하지 않는다', async () => {
      const server = nicepayServer({
        [INQUIRY_URL]: [inquiryResponse('0')],
        [CANCEL_URL]: [{ ResultCode: '2016', ResultMsg: '취소 기한 초과' }],
      });
      await expect(gateway(server.fetchImpl).refund(refund()))
        .resolves.toMatchObject({ outcome: 'needs_review', reasonCode: 'provider_cancel_rejected', evidence: { resultCode: '2016' } });
      expect(server.calls).toHaveLength(2);
    });

    it('취소 응답이 모호해도 사후 조회가 취소로 바뀌었으면 우리가 보낸 전액 취소로 인정한다', async () => {
      const server = nicepayServer({
        [INQUIRY_URL]: [inquiryResponse('0'), inquiryResponse('1')],
        [CANCEL_URL]: ['network_error'],
      });
      await expect(gateway(server.fetchImpl).refund(refund()))
        .resolves.toMatchObject({ outcome: 'approved', reasonCode: 'provider_cancel_confirmed' });
    });

    it('취소 응답이 모호하고 조회가 그대로 승인이면 unknown, 취소 성공인데 승인이면 needs_review다', async () => {
      const ambiguous = nicepayServer({
        [INQUIRY_URL]: [inquiryResponse('0'), inquiryResponse('0')],
        [CANCEL_URL]: [{ ResultCode: '2056', ResultMsg: '카드사 타임아웃' }],
      });
      await expect(gateway(ambiguous.fetchImpl).refund(refund()))
        .resolves.toMatchObject({ outcome: 'unknown', reasonCode: 'provider_cancel_ambiguous' });

      const incomplete = nicepayServer({
        [INQUIRY_URL]: [inquiryResponse('0'), inquiryResponse('0')],
        [CANCEL_URL]: [canceledResponse('2001')],
      });
      await expect(gateway(incomplete.fetchImpl).refund(refund()))
        .resolves.toMatchObject({ outcome: 'needs_review', reasonCode: 'provider_cancellation_incomplete' });
    });

    it('이전부터 취소였던 거래에 취소 응답이 모호하면 전액·부분을 가를 수 없어 unknown이다', async () => {
      const server = nicepayServer({
        [INQUIRY_URL]: [inquiryResponse('1'), inquiryResponse('1')],
        [CANCEL_URL]: ['network_error'],
      });
      await expect(gateway(server.fetchImpl).refund(refund()))
        .resolves.toMatchObject({ outcome: 'unknown', reasonCode: 'provider_cancel_ambiguous' });
    });

    it('서명이 맞지 않는 취소 성공 응답은 needs_review다', async () => {
      const server = nicepayServer({
        [INQUIRY_URL]: [inquiryResponse('0')],
        [CANCEL_URL]: [{ ...canceledResponse('2001'), Signature: sha256('forged') }],
      });
      await expect(gateway(server.fetchImpl).refund(refund()))
        .resolves.toMatchObject({ outcome: 'needs_review', reasonCode: 'provider_identity_mismatch' });
    });

    it('원장 TID가 없거나 금액이 다르면 취소를 보내지 않는다', async () => {
      const server = nicepayServer({});
      await expect(gateway(server.fetchImpl).refund(refund({ providerPaymentKey: undefined })))
        .resolves.toMatchObject({ outcome: 'needs_review', reasonCode: 'provider_refund_request_invalid' });
      await expect(gateway(server.fetchImpl).refund(refund({ amount: 30_000 })))
        .resolves.toMatchObject({ outcome: 'needs_review', reasonCode: 'provider_refund_amount_mismatch' });
      expect(server.calls).toHaveLength(0);
    });

    it('취소 전 조회가 실패하면 취소를 보내지 않고 unknown이다', async () => {
      const server = nicepayServer({ [INQUIRY_URL]: ['network_error'] });
      await expect(gateway(server.fetchImpl).refund(refund()))
        .resolves.toMatchObject({ outcome: 'unknown', reasonCode: 'provider_unavailable' });
      expect(server.calls).toHaveLength(1);
    });
  });
});
