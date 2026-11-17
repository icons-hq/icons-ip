import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ getCurrentAuthState: vi.fn(), resolveOrderReceipt: vi.fn() }));
vi.mock('server-only', () => ({}));
vi.mock('@/lib/auth/server', () => ({ getCurrentAuthState: mocks.getCurrentAuthState }));
vi.mock('@/lib/orders/receipt.server', () => ({ resolveOrderReceipt: mocks.resolveOrderReceipt }));

import { GET } from './route';

const USER_ID = '10000000-0000-4000-8000-000000000001';
const ORDER_ID = '20000000-0000-4000-8000-000000002051';
const RECEIPT_URL = 'https://dashboard.tosspayments.com/receipt/redirection?transactionId=abc&ref=PX';

function call(orderId: string) {
  return GET(new Request(`https://iconsip.com/orders/${orderId}/receipt`) as never, { params: Promise.resolve({ orderId }) } as never);
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getCurrentAuthState.mockResolvedValue({ isConfigured: true, user: { id: USER_ID, email: 'a@example.test' }, profile: null, isStaff: false });
  mocks.resolveOrderReceipt.mockResolvedValue({ kind: 'redirect', url: RECEIPT_URL });
});

describe('GET /orders/[orderId]/receipt', () => {
  it('UUID가 아닌 주문 id는 로그인 확인 없이 404다', async () => {
    for (const orderId of ['not-a-uuid', '123', '../etc/passwd', '']) {
      const response = await call(orderId);
      expect(response.status, orderId).toBe(404);
    }
    expect(mocks.getCurrentAuthState).not.toHaveBeenCalled();
    expect(mocks.resolveOrderReceipt).not.toHaveBeenCalled();
  });

  it('로그인하지 않았으면 303으로 로그인에 보내고 돌아올 영수증 경로를 싣는다', async () => {
    mocks.getCurrentAuthState.mockResolvedValue({ isConfigured: true, user: null, profile: null, isStaff: false });
    const response = await call(ORDER_ID);
    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toBe(`/login?next=${encodeURIComponent(`/orders/${ORDER_ID}/receipt`)}`);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(mocks.resolveOrderReceipt).not.toHaveBeenCalled();
  });

  it('대문자 UUID는 소문자로 정규화해 쓴다', async () => {
    await call(ORDER_ID.toUpperCase());
    expect(mocks.resolveOrderReceipt).toHaveBeenCalledWith(USER_ID, ORDER_ID);
  });

  it('성공이면 303으로 결제사 영수증에 보내고 캐시·Referrer를 막는다', async () => {
    const response = await call(ORDER_ID);
    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toBe(RECEIPT_URL);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(response.headers.get('referrer-policy')).toBe('no-referrer');
    expect(response.body).toBeNull();
    expect(mocks.resolveOrderReceipt).toHaveBeenCalledWith(USER_ID, ORDER_ID);
  });

  it('실패하면 303으로 주문 상세 결제 정보 앵커에 안내 질의를 달아 돌려보낸다', async () => {
    mocks.resolveOrderReceipt.mockResolvedValue({ kind: 'unavailable' });
    const response = await call(ORDER_ID);
    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toBe(`/orders/${ORDER_ID}?receipt=unavailable#order-payment`);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
  });

  it('어떤 응답에도 결제 키·영수증 URL이 본문에 실리지 않고, 실패 이동 주소에도 영수증 주소가 없다', async () => {
    const success = await call(ORDER_ID);
    expect(await success.text()).toBe('');
    mocks.resolveOrderReceipt.mockResolvedValue({ kind: 'unavailable' });
    const failure = await call(ORDER_ID);
    expect(await failure.text()).toBe('');
    expect(failure.headers.get('location')).not.toContain('tosspayments');
  });
});
