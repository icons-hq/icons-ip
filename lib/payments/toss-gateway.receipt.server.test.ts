import { describe, expect, it, vi } from 'vitest';
import { createTossPaymentGateway } from './toss-gateway.server';

/*
 * 고객 결제 영수증 URL 조회(MD-0038). 토스 paymentKey 조회의 `receipt.url`만 돌려주고, 그 URL은 결제사 호스트일 때만
 * 303 이동 대상으로 쓸 수 있다. 결제 키는 응답·로그에 싣지 않는다.
 */

const CLIENT_KEY = 'test_gck_iconsdocs00000000000001';
const SECRET_KEY = 'test_gsk_iconsdocs00000000000001';
const PAYMENT_KEY = 'tviva20261117000000abcDEF123456789';
const RECEIPT_URL = 'https://dashboard.tosspayments.com/receipt/redirection?transactionId=tviva20261117000000abcDEF123456789&ref=PX';

function payment(overrides: Record<string, unknown> = {}) {
  return {
    mId: 'ticonsi0xvd',
    paymentKey: PAYMENT_KEY,
    orderId: 'O0123456789abcdef0123456789abcdef',
    status: 'DONE',
    currency: 'KRW',
    method: '카드',
    totalAmount: 30_000,
    balanceAmount: 30_000,
    receipt: { url: RECEIPT_URL },
    ...overrides,
  };
}

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function server(reply: Response | 'network_error' | 'hang') {
  const calls: Array<{ url: string; method: string; body: unknown }> = [];
  const fetchImpl = vi.fn((url: string, init?: RequestInit) => {
    calls.push({ url, method: init?.method ?? 'GET', body: init?.body });
    if (reply === 'network_error') return Promise.reject(new TypeError('fetch failed'));
    if (reply === 'hang') {
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
      });
    }
    return Promise.resolve(reply);
  });
  return { fetchImpl: fetchImpl as unknown as typeof fetch, calls };
}

function gateway(fetchImpl: typeof fetch) {
  return createTossPaymentGateway({
    clientKey: CLIENT_KEY,
    secretKey: SECRET_KEY,
    siteUrl: 'https://iconsip.com',
    fetch: fetchImpl,
    merchantBinding: null,
    requestTimeoutMs: 100,
  });
}

describe('토스 receiptUrl', () => {
  it('200 + 정상 매출전표 URL이면 ok이고 paymentKey 조회 한 번만 쓴다', async () => {
    const toss = server(json(200, payment()));
    const result = await gateway(toss.fetchImpl).receiptUrl!(PAYMENT_KEY);
    expect(result).toEqual({ kind: 'ok', url: RECEIPT_URL });
    expect(toss.calls).toEqual([{ url: `https://api.tosspayments.com/v1/payments/${PAYMENT_KEY}`, method: 'GET', body: undefined }]);
  });

  it('결제 뒤 취소된 결제도 매출전표는 돌려준다(상태를 가리지 않는다)', async () => {
    for (const status of ['CANCELED', 'PARTIAL_CANCELED']) {
      const toss = server(json(200, payment({ status })));
      expect(await gateway(toss.fetchImpl).receiptUrl!(PAYMENT_KEY), status).toEqual({ kind: 'ok', url: RECEIPT_URL });
    }
  });

  it('응답의 paymentKey가 요청 키와 다르면 다른 결제의 영수증이라 unavailable이다', async () => {
    const toss = server(json(200, payment({ paymentKey: 'tviva20261117000000OTHERpaymentKEY99999' })));
    expect(await gateway(toss.fetchImpl).receiptUrl!(PAYMENT_KEY)).toEqual({ kind: 'unavailable' });
  });

  it('응답에 paymentKey가 없어도 unavailable이다', async () => {
    const toss = server(json(200, payment({ paymentKey: undefined })));
    expect(await gateway(toss.fetchImpl).receiptUrl!(PAYMENT_KEY)).toEqual({ kind: 'unavailable' });
  });

  it.each([
    ['http', 'http://dashboard.tosspayments.com/receipt'],
    ['다른 호스트', 'https://evil.example.com/receipt'],
    ['접미 위장 호스트', 'https://tosspayments.com.evil.com/receipt'],
    ['계정 정보', 'https://user:pass@dashboard.tosspayments.com/receipt'],
    ['비표준 포트', 'https://dashboard.tosspayments.com:8443/receipt'],
    ['javascript 스킴', 'javascript://dashboard.tosspayments.com/%0Aalert(1)'],
    ['스킴 없는 상대 경로', '/receipt/abc'],
    ['2049자', `https://dashboard.tosspayments.com/${'a'.repeat(2049 - 'https://dashboard.tosspayments.com/'.length)}`],
  ])('매출전표 URL이 %s이면 이동 대상으로 쓰지 않는다(not_found)', async (_label, url) => {
    const toss = server(json(200, payment({ receipt: { url } })));
    expect(await gateway(toss.fetchImpl).receiptUrl!(PAYMENT_KEY)).toEqual({ kind: 'not_found' });
  });

  it('receipt가 없거나 형태가 틀리면 not_found다', async () => {
    for (const receipt of [undefined, null, {}, { url: null }, { url: 123 }, 'https://dashboard.tosspayments.com/receipt', [RECEIPT_URL]]) {
      const toss = server(json(200, payment({ receipt })));
      expect(await gateway(toss.fetchImpl).receiptUrl!(PAYMENT_KEY), JSON.stringify(receipt)).toEqual({ kind: 'not_found' });
    }
  });

  it('404는 not_found다', async () => {
    const toss = server(json(404, { code: 'NOT_FOUND_PAYMENT', message: '존재하지 않는 결제 입니다.' }));
    expect(await gateway(toss.fetchImpl).receiptUrl!(PAYMENT_KEY)).toEqual({ kind: 'not_found' });
  });

  it.each([500, 502, 503])('%i 응답은 unavailable이다', async (status) => {
    const toss = server(json(status, { code: 'FAILED_INTERNAL_SYSTEM_PROCESSING', message: '내부 시스템 처리 작업이 실패했습니다.' }));
    expect(await gateway(toss.fetchImpl).receiptUrl!(PAYMENT_KEY)).toEqual({ kind: 'unavailable' });
  });

  it('401·403(키 설정 오류)은 이동 근거가 아니라 unavailable이다', async () => {
    for (const status of [401, 403]) {
      const toss = server(json(status, { code: 'UNAUTHORIZED_KEY', message: '인증되지 않은 시크릿 키 혹은 클라이언트 키 입니다.' }));
      expect(await gateway(toss.fetchImpl).receiptUrl!(PAYMENT_KEY), String(status)).toEqual({ kind: 'unavailable' });
    }
  });

  it('네트워크 오류는 throw하지 않고 unavailable이다', async () => {
    const toss = server('network_error');
    expect(await gateway(toss.fetchImpl).receiptUrl!(PAYMENT_KEY)).toEqual({ kind: 'unavailable' });
  });

  it('시한 안에 응답이 없으면(타임아웃) unavailable이다', async () => {
    const toss = server('hang');
    expect(await gateway(toss.fetchImpl).receiptUrl!(PAYMENT_KEY)).toEqual({ kind: 'unavailable' });
  });

  it('JSON이 아닌 200 응답은 unavailable이다', async () => {
    const toss = server(new Response('<html>gateway</html>', { status: 200, headers: { 'content-type': 'text/html' } }));
    expect(await gateway(toss.fetchImpl).receiptUrl!(PAYMENT_KEY)).toEqual({ kind: 'unavailable' });
  });

  it.each([
    ['빈 문자열', ''],
    ['공백 포함', 'tviva 2026'],
    ['제어문자 포함', 'tviva\n2026'],
    ['200자 초과', 'k'.repeat(201)],
    ['NUL 문자', 'a\u0000b'],
    ['한글 포함', 'tviva결제키'],
  ])('결제 키 형식이 %s이면 조회 없이 not_found다', async (_label, key) => {
    const toss = server(json(200, payment()));
    expect(await gateway(toss.fetchImpl).receiptUrl!(key)).toEqual({ kind: 'not_found' });
    expect(toss.fetchImpl).not.toHaveBeenCalled();
  });

  it('결제 키·응답 본문을 로그에 남기지 않는다', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const info = vi.spyOn(console, 'info').mockImplementation(() => {});
    try {
      for (const reply of [json(200, payment()), json(500, { code: 'X' }), 'network_error' as const]) {
        await gateway(server(reply).fetchImpl).receiptUrl!(PAYMENT_KEY);
      }
      expect(log).not.toHaveBeenCalled();
      expect(warn).not.toHaveBeenCalled();
      expect(info).not.toHaveBeenCalled();
    } finally {
      log.mockRestore();
      warn.mockRestore();
      info.mockRestore();
    }
  });
});
