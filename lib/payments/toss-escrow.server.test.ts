import { describe, expect, it, vi } from 'vitest';
import { createTossEscrowWorker, tossKstTimestamp, type TossEscrowJob } from './toss-escrow.server';

const API = 'https://api.tosspayments.com';
/* 결제 조회는 결제 키(gsk), 에스크로 부가서비스 API는 API 개별 연동 키(sk)다(토스 'API 키' 문서). */
const KEYS = { paymentSecretKey: 'test_gsk_x', escrowSecretKey: 'test_sk_escrow' } as const;
const auth = (key: string) => `Basic ${Buffer.from(`${key}:`).toString('base64')}`;
const ORDER_ID = '20000000-0000-4000-8000-000000004901';
const PAYMENT_KEY = 'tviva20261123000000vaKEY123456789';
const ESCROW_KEY = 'escrow_a01kradqm4cyvaw4ym4p4svjgqd';
const PRODUCT_ID = 'escprdt_a01kradqm4cyvaw4ym4p4svjgqd';

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function job(overrides: Partial<TossEscrowJob> = {}): TossEscrowJob {
  return {
    orderId: ORDER_ID,
    attemptId: '30000000-0000-4000-8000-000000004901',
    state: 'ready',
    deliveryMethod: 'SHIPMENT',
    carrier: 'hanjin',
    trackingNumber: '123456789012',
    shippedAt: '2026-11-24T01:00:00.000Z',
    receivedAt: null,
    escrowKey: null,
    tossDeliveryId: null,
    revision: 1,
    paymentKey: PAYMENT_KEY,
    recipientName: '김토스',
    ...overrides,
  };
}

const escrow = (status = 'IN_PROGRESS', extra: Record<string, unknown> = {}) => ({
  version: '2022-11-16',
  entityType: 'escrow',
  entityBody: { id: ESCROW_KEY, status, products: [{ id: PRODUCT_ID, refProductId: '', name: '엑스스퀘어 굿즈 주문', quantity: 1 }], deliveryIds: [], ...extra },
});

describe('토스 에스크로 작업자(ADR-0049)', () => {
  it('KST 시각 형식으로 바꾼다', () => {
    expect(tossKstTimestamp('2026-11-24T01:00:00.000Z')).toBe('2026-11-24T10:00:00+09:00');
    expect(tossKstTimestamp('not a date')).toBeNull();
  });

  it('결제 조회로 escrowKey를 찾고 거래 상품 id로 택배 배송을 등록한다 — 멱등키는 주문·revision', async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(json(200, { paymentKey: PAYMENT_KEY, useEscrow: true, escrowKey: ESCROW_KEY }))
      .mockResolvedValueOnce(json(200, escrow()))
      .mockResolvedValueOnce(json(200, { entityType: 'delivery', entityBody: { id: 'delivery_1', status: 'IN_TRANSIT' } }));
    const worker = createTossEscrowWorker({ ...KEYS, fetch: fetchImpl as unknown as typeof fetch });

    const result = await worker.process(job());

    expect(fetchImpl.mock.calls[0]![0]).toBe(`${API}/v1/payments/${PAYMENT_KEY}`);
    expect(fetchImpl.mock.calls[1]![0]).toBe(`${API}/v2/escrows/${ESCROW_KEY}`);
    const [url, init] = fetchImpl.mock.calls[2]!;
    expect(url).toBe(`${API}/v2/deliveries`);
    expect(init.headers['idempotency-key']).toBe(`escrow-delivery:${ORDER_ID}:1`);
    expect(JSON.parse(init.body)).toEqual({
      targetType: 'ESCROW_PRODUCT',
      targetId: PRODUCT_ID,
      deliveryMethod: 'SHIPMENT',
      shipment: { carrierCode: 'HJ', trackingNumber: '123456789012', shippedAt: '2026-11-24T10:00:00+09:00' },
    });
    expect(result).toEqual({ outcome: 'registered', escrowKey: ESCROW_KEY, escrowStatus: 'IN_PROGRESS', tossDeliveryId: 'delivery_1' });
  });

  it('에스크로를 고르지 않은 결제면 건너뛴다(useEscrow로만 판별)', async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(json(200, { paymentKey: PAYMENT_KEY, useEscrow: false, escrowKey: null }));
    const worker = createTossEscrowWorker({ ...KEYS, fetch: fetchImpl as unknown as typeof fetch });

    await expect(worker.process(job())).resolves.toEqual({ outcome: 'skipped' });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('직접 전달(퀵·방문수령·디지털만)은 DIRECT로 등록한다 — 수령인은 구매자', async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(json(200, escrow()))
      .mockResolvedValueOnce(json(200, { entityBody: { id: 'delivery_2', status: 'COMPLETED' } }));
    const worker = createTossEscrowWorker({ ...KEYS, fetch: fetchImpl as unknown as typeof fetch });

    await worker.process(job({ escrowKey: ESCROW_KEY, deliveryMethod: 'DIRECT', carrier: null, trackingNumber: null, shippedAt: null, receivedAt: '2026-11-24T05:00:00.000Z' }));

    expect(JSON.parse(fetchImpl.mock.calls[1]![1].body)).toEqual({
      targetType: 'ESCROW_PRODUCT',
      targetId: PRODUCT_ID,
      deliveryMethod: 'DIRECT',
      direct: { receivedAt: '2026-11-24T14:00:00+09:00', receiverName: '김토스', receiverRelation: 'BUYER' },
    });
  });

  it('모르는 택배사는 등록하지 않고 운영자 확인으로 넘긴다', async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(json(200, escrow()));
    const worker = createTossEscrowWorker({ ...KEYS, fetch: fetchImpl as unknown as typeof fetch });

    const result = await worker.process(job({ escrowKey: ESCROW_KEY, carrier: 'mystery' }));

    expect(result).toMatchObject({ outcome: 'manual_required', errorCode: 'carrier_unmapped' });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('송장 형식 거절(4xx)은 운영자 확인, 5xx·전송 실패는 다시 시도', async () => {
    const rejected = createTossEscrowWorker({
      ...KEYS,
      fetch: vi.fn()
        .mockResolvedValueOnce(json(200, escrow()))
        .mockResolvedValueOnce(json(400, { error: { code: 'INVALID_REQUEST', message: '송장번호 형식' } })) as unknown as typeof fetch,
    });
    await expect(rejected.process(job({ escrowKey: ESCROW_KEY }))).resolves.toMatchObject({ outcome: 'manual_required', errorCode: 'INVALID_REQUEST' });

    const flaky = createTossEscrowWorker({
      ...KEYS,
      fetch: vi.fn()
        .mockResolvedValueOnce(json(200, escrow()))
        .mockResolvedValueOnce(json(503, { error: { code: 'FAILED_INTERNAL_SYSTEM_PROCESSING' } })) as unknown as typeof fetch,
    });
    await expect(flaky.process(job({ escrowKey: ESCROW_KEY }))).resolves.toMatchObject({ outcome: 'retry' });
  });

  /* 키가 거절되면 사람이 키를 고칠 일이지 이 작업을 직접 등록할 일이 아니다 — 다시 시도로 두면 키를 고친 뒤 다음 회차에 다시 돈다. */
  it.each([
    [403, 'FORBIDDEN_REQUEST'], [401, 'UNAUTHORIZED_KEY'], [400, 'INVALID_API_KEY'], [401, undefined],
  ])('에스크로 키가 거절되면(%s %s) 운영자 확인으로 굳히지 않고 다시 시도한다', async (status, code) => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(json(status, code ? { error: { code } } : {}));
    const worker = createTossEscrowWorker({ ...KEYS, fetch: fetchImpl as unknown as typeof fetch });

    await expect(worker.process(job({ escrowKey: ESCROW_KEY }))).resolves.toMatchObject({ outcome: 'retry', errorCode: 'toss_escrow_key_rejected' });
  });

  it('결제 조회는 결제 키, 거래 조회·배송 등록은 에스크로 키로 부른다', async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(json(200, { paymentKey: PAYMENT_KEY, useEscrow: true, escrowKey: ESCROW_KEY }))
      .mockResolvedValueOnce(json(200, escrow()))
      .mockResolvedValueOnce(json(200, { version: '2022-11-16', entityType: 'delivery', entityBody: { id: 'delivery_1' } }));
    const worker = createTossEscrowWorker({ ...KEYS, fetch: fetchImpl as unknown as typeof fetch });

    await expect(worker.process(job())).resolves.toMatchObject({ outcome: 'registered' });
    const headers = fetchImpl.mock.calls.map(([, init]) => (init as RequestInit & { headers: Record<string, string> }).headers.authorization);
    expect(headers).toEqual([auth(KEYS.paymentSecretKey), auth(KEYS.escrowSecretKey), auth(KEYS.escrowSecretKey)]);
  });

  it('결제 키가 결제 조회에서 거절되면 결제 키 거절로 다시 시도한다', async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(json(401, { code: 'UNAUTHORIZED_KEY' }));
    const worker = createTossEscrowWorker({ ...KEYS, fetch: fetchImpl as unknown as typeof fetch });

    await expect(worker.process(job())).resolves.toMatchObject({ outcome: 'retry', errorCode: 'toss_payment_key_rejected' });
  });

  it('구매자 취소 신청 중이면 등록하지 않고 상태만 남긴다', async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(json(200, escrow('CANCEL_REQUESTED')));
    const worker = createTossEscrowWorker({ ...KEYS, fetch: fetchImpl as unknown as typeof fetch });

    await expect(worker.process(job({ escrowKey: ESCROW_KEY }))).resolves.toEqual({
      outcome: 'status_only', escrowKey: ESCROW_KEY, escrowStatus: 'CANCEL_REQUESTED',
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('등록 기록을 잃었어도 거래에 배송이 있으면 다시 등록하지 않는다(택배는 수정 API로 송장만 맞춘다)', async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(json(200, escrow('IN_PROGRESS', { deliveryIds: ['delivery_9'] })))
      .mockResolvedValueOnce(json(200, { entityBody: { id: 'delivery_9', status: 'IN_TRANSIT' } }));
    const worker = createTossEscrowWorker({ ...KEYS, fetch: fetchImpl as unknown as typeof fetch });

    const result = await worker.process(job({ escrowKey: ESCROW_KEY }));

    expect(fetchImpl.mock.calls[1]![0]).toBe(`${API}/v2/deliveries/delivery_9`);
    expect(JSON.parse(fetchImpl.mock.calls[1]![1].body)).toEqual({
      deliveryMethod: 'SHIPMENT',
      shipment: { carrierCode: 'HJ', trackingNumber: '123456789012', shippedAt: '2026-11-24T10:00:00+09:00' },
    });
    expect(result).toMatchObject({ outcome: 'registered', tossDeliveryId: 'delivery_9' });
  });

  it('등록 끝·발송 전 건은 거래 상태만 확인한다', async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(json(200, escrow('CONFIRMED')));
    const worker = createTossEscrowWorker({ ...KEYS, fetch: fetchImpl as unknown as typeof fetch });

    await expect(worker.process(job({ state: 'registered', escrowKey: ESCROW_KEY, tossDeliveryId: 'delivery_1' })))
      .resolves.toEqual({ outcome: 'status_only', escrowKey: ESCROW_KEY, escrowStatus: 'CONFIRMED' });
  });
});
