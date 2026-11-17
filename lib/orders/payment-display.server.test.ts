import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ rpc: vi.fn(), createClient: vi.fn() }));
vi.mock('server-only', () => ({}));
vi.mock('@/lib/supabase/server', () => ({ createClient: mocks.createClient }));

import { loadMyOrderPaymentDisplay } from './payment-display.server';

const ORDER_ID = '20000000-0000-4000-8000-000000002051';
const display = { provider: 'toss', method: '카드', detail: '43301234****123*', approvedAt: '2026-11-17T05:00:00+00:00' };

let errorLog: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.clearAllMocks();
  mocks.createClient.mockResolvedValue({ rpc: mocks.rpc });
  errorLog = vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => errorLog.mockRestore());

describe('loadMyOrderPaymentDisplay', () => {
  it('get_my_order_payment_display를 고객 세션으로 부르고 파싱한 표시를 돌려준다', async () => {
    mocks.rpc.mockResolvedValue({ data: display, error: null });
    expect(await loadMyOrderPaymentDisplay(ORDER_ID)).toEqual(display);
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
    expect(mocks.rpc).toHaveBeenCalledWith('get_my_order_payment_display', { p_order_id: ORDER_ID });
    expect(errorLog).not.toHaveBeenCalled();
  });

  it('결제가 없으면(null) null이고 오류 로그를 남기지 않는다', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: null });
    expect(await loadMyOrderPaymentDisplay(ORDER_ID)).toBeNull();
    expect(errorLog).not.toHaveBeenCalled();
  });

  it('RPC 오류는 null로 닫고 오류 코드만 한 줄 로그한다(메시지·주문 id 없음)', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code: '42501', message: 'permission denied for function secret_detail' } });
    expect(await loadMyOrderPaymentDisplay(ORDER_ID)).toBeNull();
    expect(errorLog).toHaveBeenCalledTimes(1);
    expect(errorLog).toHaveBeenCalledWith('[orders] payment display unavailable', '42501');
    expect(JSON.stringify(errorLog.mock.calls)).not.toContain(ORDER_ID);
    expect(JSON.stringify(errorLog.mock.calls)).not.toContain('secret_detail');
  });

  it('오류 코드가 없어도 null이다', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message: 'offline' } });
    expect(await loadMyOrderPaymentDisplay(ORDER_ID)).toBeNull();
    expect(errorLog).toHaveBeenCalledWith('[orders] payment display unavailable', 'rpc_error');
  });

  it('형식이 맞지 않는 응답은 null이다(결제 키가 섞인 응답 포함)', async () => {
    for (const data of [{ ...display, paymentKey: 'tgen_secret' }, { provider: 'toss' }, 'toss', [display], { ...display, approvedAt: 'yesterday' }]) {
      mocks.rpc.mockResolvedValueOnce({ data, error: null });
      expect(await loadMyOrderPaymentDisplay(ORDER_ID), JSON.stringify(data)).toBeNull();
    }
  });

  it('클라이언트 생성·RPC 호출이 던져도 throw하지 않고 null이다', async () => {
    mocks.createClient.mockRejectedValueOnce(new Error('cookies unavailable'));
    expect(await loadMyOrderPaymentDisplay(ORDER_ID)).toBeNull();
    mocks.rpc.mockRejectedValueOnce(new Error('network down'));
    expect(await loadMyOrderPaymentDisplay(ORDER_ID)).toBeNull();
    expect(errorLog).toHaveBeenCalledTimes(2);
    expect(errorLog).toHaveBeenCalledWith('[orders] payment display unavailable', 'client_error');
  });
});
