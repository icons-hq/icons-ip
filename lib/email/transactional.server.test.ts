import { shipmentFixture } from '@/lib/orders/shipments.fixture';
import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import {
  sendOrderConfirmationEmail,
  sendOrderShippedEmail,
  sendRestockAlertEmails,
} from './transactional.server';

const ORDER_ID = 'b2f8a1c4-3d5e-4f6a-8b7c-9d0e1f2a3b4c';

const mocks = vi.hoisted(() => ({
  shipments: [] as import('@/lib/orders/shipments').ShipmentRecord[],
  serviceConfigured: true,
  providerConfigured: true,
  send: vi.fn(),
  rpc: vi.fn(),
  gift: false,
  giftRecipientEmail: 'recipient@example.com' as string | null,
  receipt: null as import('@/lib/checkout-transaction').CheckoutTransactionReceipt | null,
  deliveryStatus: 'sent',
  order: null as Record<string, unknown> | null,
  orderError: null as { message: string } | null,
  items: [] as Record<string, unknown>[],
  itemsError: null as { message: string } | null,
  profile: null as Record<string, unknown> | null,
  good: null as Record<string, unknown> | null,
  goodError: null as { message: string } | null,
  restockRows: [] as Record<string, unknown>[],
  restockError: null as { message: string } | null,
}));

vi.mock('../supabase/service', () => ({
  getServiceRoleConfig: () => ({ isConfigured: mocks.serviceConfigured }),
  createServiceClient: () => ({
    rpc: mocks.rpc,
    from: (table: string) => {
      let after = '', limit = 500, profileId = '';
      const query = {
        select: () => query,
        eq: (_column: string, value: string) => { profileId = value; return query; },
        gt: (_column: string, value: string) => { after = value; return query; },
        limit: (value: number) => { limit = value; return query; },
        order: () => query,
        then: (resolve: (value: unknown) => unknown) => Promise.resolve(table === 'restock_alerts'
          ? { data: mocks.restockError ? null : mocks.restockRows, error: mocks.restockError }
          : { data: mocks.itemsError ? null : mocks.items.filter(r => String(r.id) > after).slice(0, limit), error: mocks.itemsError, count: mocks.items.filter(r => String(r.id) > after).length }).then(resolve),
        maybeSingle: async () => {
          if (table === 'orders') {
            return { data: mocks.orderError ? null : mocks.order, error: mocks.orderError };
          }
          if (table === 'goods') {
            return { data: mocks.goodError ? null : mocks.good, error: mocks.goodError };
          }
          if (table === 'email_deliveries') return { data: {status: mocks.deliveryStatus}, error: null };
          return { data: profileId === 'gift-recipient' ? { email: mocks.giftRecipientEmail } : mocks.profile, error: null };
        },
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

vi.mock('../order-delivery.server', () => ({ loadOrderDeliveryForService: async () => mocks.order ? ({ orderId: mocks.order.id, senderId: mocks.order.user_id, recipientId: mocks.gift ? 'gift-recipient' : mocks.order.user_id, isGift: mocks.gift, address: mocks.order.address }) : null }));
vi.mock('../order-transactions.server', () => ({ loadServiceOrderTransaction: async () => mocks.receipt }));

vi.mock('@/lib/orders/shipments.server', () => ({ loadOrderShipments: async () => mocks.shipments }));

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
  mocks.gift = false; mocks.giftRecipientEmail = 'recipient@example.com'; mocks.receipt = null; mocks.deliveryStatus = 'sent';
  mocks.providerConfigured = true;
  mocks.send.mockReset();
  mocks.send.mockResolvedValue({ status: 'sent' });
  mocks.rpc.mockReset();
  mocks.rpc.mockImplementation(async (name: string) => (
    name === 'claim_email_delivery' ? { data: true, error: null } : { data: null, error: null }
  ));
  mocks.shipments = [shipmentFixture({orderId:ORDER_ID,trackingUrl:'https://www.hanjin.com/tracking?number=123456789012'})];
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
    { id:'item-1', good_name_snapshot: '홍실 아크릴 블록', qty: 2, unit_price: 12_000 },
  ];
  mocks.profile = { email: 'buyer@example.com' };
  mocks.goodError = null;
  mocks.good = { name: '홍실 아크릴 블록', published_at: '2026-09-08', archived_at: null, sale_restriction: 'none', ips: { published_at: '2026-09-08', archived_at: null } };
  mocks.restockError = null;
  mocks.restockRows = [
    {
      id: '11111111-1111-4111-8111-111111111111',
      notified_at: '2026-08-28T02:00:00.000Z',
      profiles: { email: 'fan@example.com' },
    },
  ];
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

  it('배송비와 쿠폰 할인은 주문 당시 저장값을 별도로 표시한다', async () => {
    mocks.order = { ...mocks.order, total: 22_000, shipping_fee: 3000, discount_total: 5000 };
    mocks.items = [{ id: 'item-1', good_name_snapshot: '홍실 아크릴 블록', qty: 2, unit_price: 12_000 }];

    await sendOrderConfirmationEmail(ORDER_ID);

    const body = mocks.send.mock.calls[0][0].text as string;
    expect(body).toContain('굿즈 합계: ₩24,000');
    expect(body).toContain('배송비: ₩3,000');
    expect(body).toContain('쿠폰 할인: −₩5,000');
    expect(body).toContain('총 결제금액: ₩22,000');
  });

  /* 전자상거래 계약내용 서면이다 — 적립금이 빠지면 굿즈 합계+배송비−할인이 총 결제금액과
     맞지 않는다(UX-7). orders.total은 적립금까지 뺀 값이다. */
  it('적립금 사용액을 쿠폰 할인과 따로 적어 금액 합계가 맞게 한다', async () => {
    mocks.order = { ...mocks.order, total: 20_000, shipping_fee: 3000, discount_total: 0, store_credit_total: 3000 };
    mocks.items = [{ id: 'item-1', good_name_snapshot: '홍실 아크릴 블록', qty: 2, unit_price: 10_000 }];

    await sendOrderConfirmationEmail(ORDER_ID);

    const { text, html } = mocks.send.mock.calls[0][0] as { text: string; html: string };
    expect(text).toContain('굿즈 합계: ₩20,000');
    expect(text).toContain('배송비: ₩3,000');
    expect(text).toContain('적립금 사용: −₩3,000');
    expect(text).toContain('총 결제금액: ₩20,000');
    expect(text).not.toContain('쿠폰 할인');
    expect(html).toContain('적립금 사용');
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

  it('배송 건 ID로 저장된 운송장을 본문에 넣는다', async () => {
    const result = await sendOrderShippedEmail({
      orderId: ORDER_ID,
      shipmentId: mocks.shipments[0].id,
    });

    expect(result.status).toBe('sent');
    expect(rpcCalls('claim_email_delivery')[0][1]).toMatchObject({
      target_dedupe_key: `order_shipped:${ORDER_ID}:${mocks.shipments[0].id}`,
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
  it('legacy 단일 배송건은 식별자를 생략해도 저장된 운송장을 읽는다', async () => {
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

describe('sendRestockAlertEmails (#326)', () => {
  const ALERT_ID = '11111111-1111-4111-8111-111111111111';

  it('notified 로 넘어간 신청자마다 클레임 → 발송한다', async () => {
    const results = await sendRestockAlertEmails('g13');

    expect(results).toEqual([{ status: 'sent' }]);
    expect(rpcCalls('claim_email_delivery')[0][1]).toMatchObject({
      target_dedupe_key: `restock_alert:${ALERT_ID}:2026-08-28T02:00:00.000Z`,
      target_template: 'restock_alert',
      target_recipient: 'fan@example.com',
      target_subject: '[ICONS] 재입고 알림 — 홍실 아크릴 블록',
    });
    expect(mocks.send).toHaveBeenCalledTimes(1);
    expect(mocks.send.mock.calls[0][0].text).toContain('홍실 아크릴 블록');
    expect(mocks.send.mock.calls[0][0].text).toContain('/shop/g13');
  });

  /* 재신청→재품절→재입고 사이클마다 새 메일이어야 한다. 키에 전이 시각이 없으면
     두 번째 재입고 메일이 첫 사이클의 sent 행에 막혀 조용히 사라진다. */
  it('사이클마다 다른 dedupe_key 를 쓴다', async () => {
    await sendRestockAlertEmails('g13');
    mocks.restockRows = [{
      ...mocks.restockRows[0],
      notified_at: '2026-09-01T02:00:00.000Z',
    }];
    await sendRestockAlertEmails('g13');

    const keys = rpcCalls('claim_email_delivery').map((call) => call[1].target_dedupe_key);
    expect(new Set(keys).size).toBe(2);
  });

  /* 재고를 건드릴 때마다 조건 없이 불린다 — 신청자 없는 굿즈가 절대다수다. */
  it('발송 대기 중 상품이 초안으로 내려가면 재입고 메일을 보내지 않는다', async () => {
    mocks.good = { ...mocks.good, published_at: null };
    expect(await sendRestockAlertEmails('g13')).toEqual([{ status: 'skipped', reason: 'good_unavailable' }]);
    expect(mocks.send).not.toHaveBeenCalled();
  });

  it('보낼 신청이 없으면 조용히 넘어간다', async () => {
    mocks.restockRows = [];

    const results = await sendRestockAlertEmails('g13');

    expect(results).toEqual([{ status: 'skipped', reason: 'no_notified_alerts' }]);
    expect(mocks.send).not.toHaveBeenCalled();
    expect(loggedLines()).toEqual([]);
  });

  it('이미 보낸 사이클은 클레임이 걸러 다시 보내지 않는다', async () => {
    mocks.rpc.mockImplementation(async (name: string) => (
      name === 'claim_email_delivery' ? { data: false, error: null } : { data: null, error: null }
    ));

    const results = await sendRestockAlertEmails('g13');

    expect(results).toEqual([{ status: 'skipped', reason: 'already_delivered' }]);
    expect(mocks.send).not.toHaveBeenCalled();
    expect(loggedLines()).toEqual([]);
  });

  it('한 수신자의 실패가 다른 수신자의 발송을 막지 않는다', async () => {
    mocks.restockRows = [
      { id: ALERT_ID, notified_at: '2026-08-28T02:00:00.000Z', profiles: { email: null } },
      {
        id: '22222222-2222-4222-8222-222222222222',
        notified_at: '2026-08-28T02:00:00.000Z',
        profiles: { email: 'fan2@example.com' },
      },
    ];

    const results = await sendRestockAlertEmails('g13');

    expect(results).toEqual([
      { status: 'skipped', reason: 'recipient_missing' },
      { status: 'sent' },
    ]);
    expect(mocks.send).toHaveBeenCalledTimes(1);
    expect(mocks.send.mock.calls[0][0].to).toBe('fan2@example.com');
    expect(loggedLines().some((line) => line.includes('recipient_missing'))).toBe(true);
  });

  it('service role 이 없으면 아무것도 읽지 않고 결과 하나로 접는다', async () => {
    mocks.serviceConfigured = false;

    const results = await sendRestockAlertEmails('g13');

    expect(results).toEqual([{ status: 'skipped', reason: 'service_role_not_configured' }]);
    expect(mocks.send).not.toHaveBeenCalled();
  });

  it('조회가 실패해도 던지지 않고 실패를 기록한다', async () => {
    mocks.restockError = { message: 'boom' };

    const results = await sendRestockAlertEmails('g13');

    expect(results).toEqual([{ status: 'failed', error: 'unexpected_email_failure' }]);
    expect(loggedLines().some((line) => line.includes('restock alert failed'))).toBe(true);
  });

  /* PD-11 — 옵션 단위 신청. service role 은 goods_variants 를 직접 읽지 못해 봉인된 RPC 로 옵션 이름을 받는다. */
  describe('옵션 단위 신청', () => {
    const VARIANT_ID = '00000000-0000-4000-8000-000000056711';
    const SECOND_ALERT = '22222222-2222-4222-8222-222222222222';

    function withOptionNames(rows: { variant_id: string; option_name: string }[] | null, error: { message: string } | null = null) {
      mocks.rpc.mockImplementation(async (name: string) => {
        if (name === 'claim_email_delivery') return { data: true, error: null };
        if (name === 'service_restock_alert_option_names') return { data: rows, error };
        return { data: null, error: null };
      });
    }

    it('굿즈 단위 신청만 있으면 옵션 이름을 읽지 않고 예전 키 형식 그대로 보낸다', async () => {
      await sendRestockAlertEmails('g13');

      expect(rpcCalls('service_restock_alert_option_names')).toHaveLength(0);
      expect(rpcCalls('claim_email_delivery')[0][1].target_dedupe_key).toBe(`restock_alert:${ALERT_ID}:2026-08-28T02:00:00.000Z`);
    });

    it('옵션 신청은 옵션 이름·옵션을 고른 링크·옵션 키로 보내고 굿즈 단위 신청은 그대로 둔다', async () => {
      withOptionNames([{ variant_id: VARIANT_ID, option_name: '빨강' }]);
      mocks.restockRows = [
        { id: ALERT_ID, notified_at: '2026-08-28T02:00:00.000Z', variant_id: null, profiles: { email: 'fan@example.com' } },
        { id: SECOND_ALERT, notified_at: '2026-10-23T01:00:00.000Z', variant_id: VARIANT_ID, profiles: { email: 'fan2@example.com' } },
      ];

      const results = await sendRestockAlertEmails('g13');

      expect(results).toEqual([{ status: 'sent' }, { status: 'sent' }]);
      expect(rpcCalls('service_restock_alert_option_names')).toEqual([['service_restock_alert_option_names', { target_good_id: 'g13' }]]);
      const claims = rpcCalls('claim_email_delivery').map((call) => call[1]);
      expect(claims[0]).toMatchObject({
        target_dedupe_key: `restock_alert:${ALERT_ID}:2026-08-28T02:00:00.000Z`,
        target_subject: '[ICONS] 재입고 알림 — 홍실 아크릴 블록',
      });
      expect(claims[1]).toMatchObject({
        target_dedupe_key: `restock_alert:${SECOND_ALERT}:${VARIANT_ID}:2026-10-23T01:00:00.000Z`,
        target_recipient: 'fan2@example.com',
        target_subject: '[ICONS] 재입고 알림 — 홍실 아크릴 블록 · 빨강',
      });
      const optionMail = mocks.send.mock.calls[1][0];
      expect(optionMail.text).toContain('홍실 아크릴 블록 · 빨강 옵션이 다시 판매를 시작했어요.');
      expect(optionMail.text).toContain(`/shop/g13?variant=${VARIANT_ID}`);
      const goodsMail = mocks.send.mock.calls[0][0];
      expect(goodsMail.text).toContain('홍실 아크릴 블록 굿즈가 다시 판매를 시작했어요.');
      expect(goodsMail.text).not.toContain('variant=');
    });

    it('옵션 이름을 못 읽으면 이번 배치를 보내지 않고 실패로 남긴다(클레임 전이라 다음 접점에서 다시 보낸다)', async () => {
      withOptionNames(null, { message: 'permission denied' });
      mocks.restockRows = [
        { id: SECOND_ALERT, notified_at: '2026-10-23T01:00:00.000Z', variant_id: VARIANT_ID, profiles: { email: 'fan2@example.com' } },
      ];

      const results = await sendRestockAlertEmails('g13');

      expect(results).toEqual([{ status: 'failed', error: 'unexpected_email_failure' }]);
      expect(rpcCalls('claim_email_delivery')).toHaveLength(0);
      expect(mocks.send).not.toHaveBeenCalled();
    });
  });
});

 it('같은 주문의 두 배송건에 각 품목만 담아 서로 다른 멱등 키로 보낸다', async () => {
  mocks.order = {...mocks.order,status:'shipping'};
  mocks.items = [{id:'item-1',good_name_snapshot:'김포 굿즈',qty:1,unit_price:1000},{id:'item-2',good_name_snapshot:'남양주 굿즈',qty:1,unit_price:1000}];
  mocks.shipments = [shipmentFixture({orderId:ORDER_ID}),shipmentFixture({id:'00000000-0000-4000-8000-000000044702',orderId:ORDER_ID,originName:'남양주',orderItemIds:['item-2'],trackingNumber:'9876543210'})];
  await sendOrderShippedEmail({orderId:ORDER_ID,shipmentId:mocks.shipments[0].id});
  await sendOrderShippedEmail({orderId:ORDER_ID,shipmentId:mocks.shipments[1].id});
  const claims = rpcCalls('claim_email_delivery');
  expect(claims[0][1].target_dedupe_key).not.toBe(claims[1][1].target_dedupe_key);
  expect(mocks.send.mock.calls[0][0].text).toContain('김포 굿즈');
  expect(mocks.send.mock.calls[0][0].text).not.toContain('남양주 굿즈');
  expect(mocks.send.mock.calls[1][0].text).toContain('남양주 굿즈');
  expect(mocks.send.mock.calls[1][0].text).not.toContain('김포 굿즈');
  expect(await sendOrderShippedEmail({orderId:ORDER_ID})).toEqual({status:'skipped',reason:'shipment_reference_required'});
 });
 it('다른 배송이 출발했어도 아직 준비 중인 배송건의 메일은 보내지 않는다', async () => {
  mocks.order = {...mocks.order,status:'shipping'};
  mocks.shipments[0].status='ready';
  expect(await sendOrderShippedEmail({orderId:ORDER_ID,shipmentId:mocks.shipments[0].id})).toEqual({status:'skipped',reason:'shipment_status_mismatch'});
  expect(mocks.send).not.toHaveBeenCalled();
 });


describe('gift audience isolation', () => {
  it('separates payer money and recipient private address under different dedupe keys', async () => {
    mocks.gift = true;
    expect(await sendOrderConfirmationEmail(ORDER_ID)).toEqual({ status: 'sent' });
    expect(mocks.send).toHaveBeenCalledTimes(2);
    const payer = mocks.send.mock.calls[0][0], recipient = mocks.send.mock.calls[1][0];
    expect(payer.to).toBe('buyer@example.com'); expect(payer.text).not.toContain('세종대로');
    expect(payer.text).not.toContain('010-1234'); expect(payer.text).toContain('27,000');
    expect(recipient.to).toBe('recipient@example.com'); expect(recipient.text).toContain('세종대로');
    expect(recipient.text).not.toContain('27,000'); expect(recipient.text).not.toContain('12,000');
    expect(recipient.text).not.toContain('buyer@example.com');
    expect(rpcCalls('claim_email_delivery').map(c => c[1].target_dedupe_key)).toEqual([
      `order_confirmation:${ORDER_ID}`, `order_confirmation:${ORDER_ID}:recipient`,
    ]);
  });
  it('hides recipient tracking in payer shipment messages and retries only selected recipient', async () => {
    mocks.gift = true; mocks.order = { ...mocks.order, status: 'shipping' };
    await sendOrderShippedEmail({ orderId: ORDER_ID });
    expect(mocks.send.mock.calls[0][0].text).not.toContain('123456789012');
    expect(mocks.send.mock.calls[1][0].text).toContain('123456789012');
    mocks.send.mockClear();
    await sendOrderShippedEmail({ orderId: ORDER_ID, shipmentId: mocks.shipments[0].id, audience: 'recipient' });
    expect(mocks.send).toHaveBeenCalledTimes(1); expect(mocks.send.mock.calls[0][0].to).toBe('recipient@example.com');
  });
  it('records a payer failure without suppressing the recipient attempt', async () => {
    mocks.gift = true; mocks.send.mockResolvedValueOnce({ status: 'failed', error: 'provider_http_503' });
    expect(await sendOrderConfirmationEmail(ORDER_ID)).toEqual({ status: 'failed', error: 'provider_http_503' });
    expect(mocks.send).toHaveBeenCalledTimes(2);
    expect(rpcCalls('complete_email_delivery').map(c => c[1].target_status)).toEqual(['failed', 'sent']);
  });
  it('does not report missing recipients or pending claims as fully delivered', async () => {
    mocks.gift = true; mocks.giftRecipientEmail = null;
    expect(await sendOrderConfirmationEmail(ORDER_ID)).toEqual({ status: 'skipped', reason: 'recipient_missing' });
    mocks.gift = false; mocks.deliveryStatus = 'pending';
    mocks.rpc.mockResolvedValue({ data: false, error: null });
    expect(await sendOrderConfirmationEmail(ORDER_ID)).toEqual({ status: 'skipped', reason: 'delivery_in_progress' });
  });
  it('reads all 1001 distinct line snapshots before rendering', async () => {
    mocks.items = Array.from({ length: 1001 }, (_, i) => ({ id: String(i).padStart(5,'0'), good_name_snapshot: `상품-${i}`, qty: 1, unit_price: 100 }));
    await sendOrderConfirmationEmail(ORDER_ID);
    expect(mocks.send.mock.calls[0][0].text).toContain('상품-1000');
  });
});

it('uses the v2 contractual totals and refuses inconsistent immutable item identity', async () => {
  const { transactionDisplay, transactionQuoteId } = await import('@/test/fixtures/cart-transaction');
  const row = transactionDisplay.lines[0];
  mocks.receipt = { orderId: ORDER_ID, quoteId: transactionQuoteId, display: transactionDisplay };
  mocks.order = { ...mocks.order, calculation_version: 2, total: 16000, volume_discount_total: 2000,
    discount_total: 1000, store_credit_total: 1000, shipping_fee: 0, shipping_collect_total: 3000 };
  mocks.items = [{ id: row.lineId, variant_id: row.variantId, good_name_snapshot: '거래 상품', qty: row.qty, unit_price: row.unitPrice }];
  expect(await sendOrderConfirmationEmail(ORDER_ID)).toEqual({ status: 'sent' });
  const text = mocks.send.mock.calls[0][0].text;
  expect(text).toContain('복수구매 할인: −₩2,000'); expect(text).toContain('온라인 결제금액: ₩16,000');
  expect(text).toContain('착불 배송비 · 수령 시 별도: ₩3,000'); expect(text).toContain('총 부담금액: ₩19,000');
  mocks.send.mockClear(); mocks.items[0].id = 'wrong-line';
  expect((await sendOrderConfirmationEmail(ORDER_ID)).status).toBe('failed'); expect(mocks.send).not.toHaveBeenCalled();
});
