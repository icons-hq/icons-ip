import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cancelTossPayment, getTossConfig } from './toss-api';

const PAYMENT_KEY = 'ticket-payment-secret';

describe('cancelTossPayment', () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.stubEnv('NEXT_PUBLIC_TOSS_CLIENT_KEY', 'test_gck_example');
    vi.stubEnv('TOSS_SECRET_KEY', 'test_gsk_example');
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ status: 'CANCELED' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })));
  });

  it('호출자가 제공한 멱등키를 실제 Idempotency-Key 헤더에 사용한다', async () => {
    await cancelTossPayment(PAYMENT_KEY, '사용자 티켓 예매 취소', 'ticket-cancel-request-payment');

    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining(encodeURIComponent(PAYMENT_KEY)),
      expect.objectContaining({
        headers: expect.objectContaining({
          'Idempotency-Key': 'ticket-cancel-request-payment',
        }),
      }),
    );
  });

  it('기존 2-인자 호출은 paymentKey 기반 멱등키를 유지한다', async () => {
    await cancelTossPayment(PAYMENT_KEY, '기존 취소');

    expect(fetch).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        headers: expect.objectContaining({
          'Idempotency-Key': `cancel-${PAYMENT_KEY}`,
        }),
      }),
    );
  });

  it('공개 위젯 키나 production override 없이 server-only legacy API만 구성한다', () => {
    vi.stubEnv('NEXT_PUBLIC_TOSS_CLIENT_KEY', '');
    vi.stubEnv('ALLOW_TOSS_TEST_PAYMENTS_IN_PRODUCTION', '');
    vi.stubEnv('VERCEL_ENV', 'production');

    expect(getTossConfig()).toMatchObject({
      secretKey: 'test_gsk_example',
      isConfigured: true,
    });
  });

  it('legacy server credential 형식이 아니면 구성되지 않은 것으로 처리한다', () => {
    vi.stubEnv('TOSS_SECRET_KEY', 'test_sk_not_widget_secret');
    expect(getTossConfig().isConfigured).toBe(false);
  });
});
