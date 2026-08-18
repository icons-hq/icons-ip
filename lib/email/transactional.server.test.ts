import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { sendOrderConfirmationEmail, sendOrderShippedEmail } from './transactional.server';

const ORDER_ID = 'b2f8a1c4-3d5e-4f6a-8b7c-9d0e1f2a3b4c';

const mocks = vi.hoisted(() => ({
  serviceConfigured: true,
  providerConfigured: true,
  send: vi.fn(),
  rpc: vi.fn(),
  order: null as Record<string, unknown> | null,
  orderError: null as { message: string } | null,
  items: [] as Record<string, unknown>[],
  itemsError: null as { message: string } | null,
  profile: null as Record<string, unknown> | null,
}));

vi.mock('../supabase/service', () => ({
  getServiceRoleConfig: () => ({ isConfigured: mocks.serviceConfigured }),
  createServiceClient: () => ({
    rpc: mocks.rpc,
    from: (table: string) => {
      const query = {
        select: () => query,
        eq: () => query,
        order: async () => ({
          data: mocks.itemsError ? null : mocks.items,
          error: mocks.itemsError,
        }),
        maybeSingle: async () => (table === 'orders'
          ? { data: mocks.orderError ? null : mocks.order, error: mocks.orderError }
          : { data: mocks.profile, error: null }),
      };
      return query;
    },
  }),
}));

/* 택배사 레지스트리는 DB(`public.shipping_carriers`)에서 온다(#251). 앱에 상수
   목록이 없으므로 테스트도 고정 레지스트리를 주입한다 — 여기서 확인하려는 것은
   목록 자체가 아니라 운송장이 그 목록을 거쳐 그려지는가다. */
vi.mock('@/lib/orders/shipment.server', () => {
  const carriers = [{
    code: 'hanjin',
    label: '한진택배',
    active: true,
    trackingUrlTemplate: 'https://www.hanjin.com/kor/CMS/DeliveryMgr/WaybillResult.do'
      + '?mCode=MN038&schLang=KR&wblnumText2={trackingNumber}',
  }];
  return {
    getShippingCarrierRegistry: async () => carriers,
    loadShippingCarrierRegistry: async () => carriers,
  };
});

vi.mock('./provider.server', () => ({
  getEmailProviderConfig: () => ({ isConfigured: mocks.providerConfigured }),
  sendTransactionalEmail: mocks.send,
}));

function rpcCalls(name: string) {
  return mocks.rpc.mock.calls.filter((call) => call[0] === name);
}

let errorLog: Mock<Console['error']>;

beforeEach(() => {
  mocks.serviceConfigured = true;
  mocks.providerConfigured = true;
  mocks.send.mockReset();
  mocks.send.mockResolvedValue({ status: 'sent' });
  mocks.rpc.mockReset();
  mocks.rpc.mockImplementation(async (name: string) => (
    name === 'claim_email_delivery' ? { data: true, error: null } : { data: null, error: null }
  ));
  mocks.orderError = null;
  mocks.itemsError = null;
  mocks.order = {
    id: ORDER_ID,
    user_id: 'user-1',
    status: 'paid',
    total: 27_000,
    created_at: '2026-08-07T02:30:00.000Z',
    address: {
      recipientName: '박상우',
      phone: '01012345678',
      postalCode: '04524',
      address1: '서울시 중구 세종대로 110',
    },
  };
  mocks.items = [
    { good_name_snapshot: '홍실 아크릴 블록', qty: 2, unit_price: 12_000 },
  ];
  mocks.profile = { email: 'buyer@example.com' };
  vi.spyOn(console, 'info').mockImplementation(() => {});
  // vi.spyOn은 이미 spy인 메서드에 같은 mock을 돌려준다. 비우지 않으면 이전 테스트의
  // 로그가 남아 "로그를 남기지 않는다"를 검증할 수 없다.
  errorLog = vi.spyOn(console, 'error').mockImplementation(() => {});
  errorLog.mockClear();
});

function loggedLines() {
  return errorLog.mock.calls.map((call) => String(call[0]));
}

describe('sendOrderConfirmationEmail', () => {
  it('클레임 → 발송 → 결과 기록 순서로 확인 메일을 보낸다', async () => {
    const result = await sendOrderConfirmationEmail(ORDER_ID);

    expect(result.status).toBe('sent');
    expect(rpcCalls('claim_email_delivery')[0][1]).toMatchObject({
      target_dedupe_key: `order_confirmation:${ORDER_ID}`,
      target_template: 'order_confirmation',
      target_recipient: 'buyer@example.com',
    });
    expect(mocks.send).toHaveBeenCalledTimes(1);
    expect(mocks.send.mock.calls[0][0].to).toBe('buyer@example.com');
    expect(mocks.send.mock.calls[0][0].text).toContain('홍실 아크릴 블록');
    expect(rpcCalls('complete_email_delivery')[0][1]).toMatchObject({
      target_dedupe_key: `order_confirmation:${ORDER_ID}`,
      target_status: 'sent',
    });
  });

  it('배송비는 결제 총액에서 굿즈 합계를 뺀 값으로 파생한다', async () => {
    mocks.order = { ...mocks.order, total: 27_000 };
    mocks.items = [{ good_name_snapshot: '홍실 아크릴 블록', qty: 2, unit_price: 12_000 }];

    await sendOrderConfirmationEmail(ORDER_ID);

    const body = mocks.send.mock.calls[0][0].text as string;
    expect(body).toContain('굿즈 합계: ₩24,000');
    expect(body).toContain('배송비: ₩3,000');
    expect(body).toContain('총 결제금액: ₩27,000');
  });

  it('이미 발송된 주문은 클레임에 실패하고 다시 보내지 않는다', async () => {
    mocks.rpc.mockImplementation(async (name: string) => (
      name === 'claim_email_delivery' ? { data: false, error: null } : { data: null, error: null }
    ));

    const result = await sendOrderConfirmationEmail(ORDER_ID);

    expect(result).toEqual({ status: 'skipped', reason: 'already_delivered' });
    expect(mocks.send).not.toHaveBeenCalled();
    expect(rpcCalls('complete_email_delivery')).toHaveLength(0);
  });

  // provider 키 없이 첫 주문이 확정되면 이전에는 이력 0행·로그 0줄이었다. 나중에 키를
  // 채운 운영자에게 "다시 보낼 메일이 없습니다"만 남으면 구매자는 서면을 영영 못 받는다.
  it('provider가 설정되지 않아도 실패 이력을 남겨 나중에 다시 보낼 수 있게 한다', async () => {
    mocks.providerConfigured = false;
    mocks.send.mockResolvedValue({ status: 'skipped', reason: 'provider_not_configured' });

    const result = await sendOrderConfirmationEmail(ORDER_ID);

    expect(result).toEqual({ status: 'failed', error: 'provider_not_configured' });
    expect(rpcCalls('claim_email_delivery')).toHaveLength(1);
    expect(rpcCalls('complete_email_delivery')[0][1]).toMatchObject({
      target_dedupe_key: `order_confirmation:${ORDER_ID}`,
      target_status: 'failed',
      target_error: 'provider_not_configured',
    });
    expect(loggedLines().some((line) => line.includes('provider_not_configured'))).toBe(true);
  });

  it('service role이 없으면 건너뛰되 사유를 로그로 남긴다', async () => {
    mocks.serviceConfigured = false;

    const result = await sendOrderConfirmationEmail(ORDER_ID);

    expect(result).toEqual({ status: 'skipped', reason: 'service_role_not_configured' });
    expect(mocks.send).not.toHaveBeenCalled();
    expect(loggedLines().some((line) => (
      line.includes('service_role_not_configured') && line.includes(ORDER_ID)
    ))).toBe(true);
  });

  it('멱등이 흡수한 재전송은 로그를 남기지 않는다', async () => {
    mocks.rpc.mockImplementation(async (name: string) => (
      name === 'claim_email_delivery' ? { data: false, error: null } : { data: null, error: null }
    ));

    await sendOrderConfirmationEmail(ORDER_ID);

    expect(loggedLines()).toHaveLength(0);
  });

  it('발송이 실패해도 예외를 던지지 않고 실패를 이력에 남긴다', async () => {
    mocks.send.mockResolvedValue({ status: 'failed', error: 'provider body contains buyer@example.com' });

    const result = await sendOrderConfirmationEmail(ORDER_ID);

    expect(result).toEqual({ status: 'failed', error: 'provider_failure' });
    expect(rpcCalls('complete_email_delivery')[0][1]).toMatchObject({
      target_status: 'failed',
      target_error: 'provider_failure',
    });
    expect(loggedLines().join('\n')).not.toMatch(/buyer@example\.com|provider body/);
  });

  it('주문을 읽지 못해도 예외를 던지지 않는다', async () => {
    mocks.orderError = { message: 'boom' };

    const result = await sendOrderConfirmationEmail(ORDER_ID);

    expect(result.status).toBe('failed');
    expect(mocks.send).not.toHaveBeenCalled();
  });

  it('수신 이메일이 없으면 건너뛰되 사유를 로그로 남긴다', async () => {
    mocks.profile = { email: null };

    const result = await sendOrderConfirmationEmail(ORDER_ID);

    expect(result).toEqual({ status: 'skipped', reason: 'recipient_missing' });
    expect(mocks.send).not.toHaveBeenCalled();
    expect(loggedLines().some((line) => (
      line.includes('recipient_missing') && line.includes(ORDER_ID)
    ))).toBe(true);
  });

  // 재발송은 임의 시점이다. 청약철회로 취소된 주문에 "결제가 확인됐고 배송 준비를
  // 시작합니다"를 보내면 거짓 고지다.
  it('취소된 주문에는 확인 메일을 다시 보내지 않는다', async () => {
    mocks.order = { ...mocks.order, status: 'canceled' };

    const result = await sendOrderConfirmationEmail(ORDER_ID);

    expect(result).toEqual({ status: 'skipped', reason: 'order_status_mismatch:canceled' });
    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(mocks.send).not.toHaveBeenCalled();
    expect(loggedLines().some((line) => line.includes('order_status_mismatch:canceled'))).toBe(true);
  });

  it('결제가 확정되지 않은 주문에는 확인 메일을 보내지 않는다', async () => {
    mocks.order = { ...mocks.order, status: 'pending' };

    const result = await sendOrderConfirmationEmail(ORDER_ID);

    expect(result).toEqual({ status: 'skipped', reason: 'order_status_mismatch:pending' });
    expect(mocks.send).not.toHaveBeenCalled();
  });

  it('배송·완료로 넘어간 주문에는 확인 메일을 다시 보낼 수 있다', async () => {
    mocks.order = { ...mocks.order, status: 'done' };

    const result = await sendOrderConfirmationEmail(ORDER_ID);

    expect(result.status).toBe('sent');
  });
});

describe('sendOrderShippedEmail', () => {
  beforeEach(() => {
    mocks.order = { ...mocks.order, status: 'shipping' };
  });

  it('운송장 값을 인자로 받아 본문에 넣는다', async () => {
    const result = await sendOrderShippedEmail({
      orderId: ORDER_ID,
      carrierName: '한진택배',
      trackingNumber: '123456789012',
      trackingUrl: 'https://www.hanjin.com/tracking?number=123456789012',
    });

    expect(result.status).toBe('sent');
    expect(rpcCalls('claim_email_delivery')[0][1]).toMatchObject({
      target_dedupe_key: `order_shipped:${ORDER_ID}`,
      target_template: 'order_shipped',
    });
    const body = mocks.send.mock.calls[0][0].text as string;
    expect(body).toContain('한진택배');
    expect(body).toContain('123456789012');
  });

  it('운송장 값이 없어도 배송 시작을 알린다', async () => {
    const result = await sendOrderShippedEmail({ orderId: ORDER_ID });

    expect(result.status).toBe('sent');
    expect(mocks.send.mock.calls[0][0].subject).toContain('배송');
  });

  // 인자에만 의존하면 값을 넘기지 않는 호출자 하나가 빈 메일을 보내고 dedupe 행을
  // sent로 닫아버린다. 재발송처럼 폼 입력이 없는 경로도 완전한 메일을 만들어야 한다.
  it('인자를 생략하면 주문 행의 운송장을 읽어 본문에 넣는다', async () => {
    mocks.order = {
      ...mocks.order,
      shipping_carrier: 'hanjin',
      tracking_number: '123456789012',
    };

    const result = await sendOrderShippedEmail({ orderId: ORDER_ID });

    expect(result.status).toBe('sent');
    const body = mocks.send.mock.calls[0][0].text as string;
    expect(body).toContain('한진택배');
    expect(body).toContain('123456789012');
    expect(body).toContain('hanjin.com');
    expect(body).not.toContain('운송장 정보가 등록되면');
  });

  // 배송 후 청약철회로 주문이 취소되면 "배송지로 이동하고 있습니다"는 더 이상 사실이 아니다.
  it('취소된 주문에는 배송 시작 메일을 다시 보내지 않는다', async () => {
    mocks.order = { ...mocks.order, status: 'canceled' };

    const result = await sendOrderShippedEmail({ orderId: ORDER_ID });

    expect(result).toEqual({ status: 'skipped', reason: 'order_status_mismatch:canceled' });
    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(mocks.send).not.toHaveBeenCalled();
  });

  it('아직 배송을 시작하지 않은 주문에는 배송 시작 메일을 보내지 않는다', async () => {
    mocks.order = { ...mocks.order, status: 'paid' };

    const result = await sendOrderShippedEmail({ orderId: ORDER_ID });

    expect(result).toEqual({ status: 'skipped', reason: 'order_status_mismatch:paid' });
    expect(mocks.send).not.toHaveBeenCalled();
  });
});
