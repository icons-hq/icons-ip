import { describe, expect, it, vi } from 'vitest';
import type { AlimtalkSendResult, KakaoAlimtalkConfig } from './nhn.server';
import {
  sendOrderConfirmationAlimtalk,
  sendOrderShippedAlimtalk,
  visibleItemNames,
  type AlimtalkClaim,
  type AlimtalkNoticeRepository,
  type AlimtalkOrderSnapshot,
  type AlimtalkShipmentSnapshot,
} from './order-notices.server';

vi.mock('@/lib/supabase/service', () => ({
  createServiceClient: () => { throw new Error('service client must be injected in tests'); },
  getServiceRoleConfig: () => ({ isConfigured: false }),
}));

const ORDER_ID = '63000000-0000-4000-8000-000000000001';
const SHIPMENT_ID = '64000000-0000-4000-8000-000000000001';
const OTHER_SHIPMENT_ID = '64000000-0000-4000-8000-000000000002';
const CLAIM: Extract<AlimtalkClaim, { ok: true }> = {
  ok: true, deliveryId: '65000000-0000-4000-8000-000000000001', claimToken: '66000000-0000-4000-8000-000000000001', recipientNo: '01012345678',
};
const CONFIG: KakaoAlimtalkConfig = {
  appKey: 'AppKey1234abcd', secretKey: 'Secret12', senderKey: 'a'.repeat(40),
  templateCodes: { order_confirmation: 'XSQ_ORDER_PAID', order_shipped: 'XSQ_ORDER_SHIPPED' },
};

function order(overrides: Partial<AlimtalkOrderSnapshot> = {}): AlimtalkOrderSnapshot {
  return {
    orderId: ORDER_ID, orderNumber: '2026111910000001', status: 'paid', total: 32000,
    items: [
      { id: 'i1', goodId: 'keyring', name: '메이플스토리 아크릴 키링', random: false },
      { id: 'i2', goodId: 'random-box', name: '랜덤 포토카드', random: true },
      { id: 'i3', goodId: 'random-box', name: '랜덤 포토카드', random: true },
    ],
    ...overrides,
  };
}
function shipment(overrides: Partial<AlimtalkShipmentSnapshot> = {}): AlimtalkShipmentSnapshot {
  return { id: SHIPMENT_ID, status: 'shipping', carrierLabel: '한진택배', trackingNumber: '512345678901', orderItemIds: ['i1'], ...overrides };
}
function repository(overrides: Partial<AlimtalkNoticeRepository> = {}): AlimtalkNoticeRepository {
  return {
    loadOrder: vi.fn(async () => order()),
    loadShipments: vi.fn(async () => [shipment()]),
    isGiftOrder: vi.fn(async () => false),
    claim: vi.fn(async () => CLAIM),
    complete: vi.fn(async () => true),
    ...overrides,
  };
}
function sender(result: AlimtalkSendResult = { status: 'sent', requestId: 'req-1' }) {
  return { send: vi.fn(async () => result) };
}

describe('주문 접수 알림톡', () => {
  it('꺼져 있으면 주문도 장부도 읽지 않고 로그도 남기지 않는다', async () => {
    const repo = repository();
    const log = vi.fn();
    await expect(sendOrderConfirmationAlimtalk(ORDER_ID, { config: null, repository: repo, log })).resolves.toEqual({ status: 'skipped', reason: 'disabled' });
    await expect(sendOrderConfirmationAlimtalk(ORDER_ID, { config: { ...CONFIG, templateCodes: { order_confirmation: null, order_shipped: 'X' } }, repository: repo, log }))
      .resolves.toEqual({ status: 'skipped', reason: 'template_not_configured' });
    expect(repo.loadOrder).not.toHaveBeenCalled();
    expect(repo.claim).not.toHaveBeenCalled();
    expect(log).not.toHaveBeenCalled();
  });

  it('주문 상태가 맞을 때 클레임한 번호로 템플릿 변수만 보내고 결과를 장부에 남긴다', async () => {
    const repo = repository();
    const send = sender();
    await expect(sendOrderConfirmationAlimtalk(ORDER_ID, { config: CONFIG, repository: repo, sender: send, log: vi.fn() })).resolves.toEqual({ status: 'sent' });
    expect(repo.claim).toHaveBeenCalledWith('order_confirmation', ORDER_ID, null);
    expect(send.send).toHaveBeenCalledWith({
      templateCode: 'XSQ_ORDER_PAID',
      recipientNo: '01012345678',
      templateParameter: { 주문번호: '2026111910000001', 상품명: '메이플스토리 아크릴 키링 외 1건', 결제금액: '32,000', 주문ID: ORDER_ID },
      idempotencyKey: CLAIM.claimToken,
    });
    expect(repo.complete).toHaveBeenCalledWith(CLAIM, { status: 'sent', requestId: 'req-1' });
  });

  it('메일과 같은 사실성 게이트 — 결제 전·취소 주문에는 클레임조차 하지 않는다', async () => {
    for (const status of ['pending', 'canceled']) {
      const repo = repository({ loadOrder: vi.fn(async () => order({ status })) });
      const log = vi.fn();
      await expect(sendOrderConfirmationAlimtalk(ORDER_ID, { config: CONFIG, repository: repo, sender: sender(), log }))
        .resolves.toEqual({ status: 'skipped', reason: `order_status_mismatch:${status}` });
      expect(repo.claim).not.toHaveBeenCalled();
      expect(log).toHaveBeenCalledWith(`[alimtalk] order confirmation not sent (order:${ORDER_ID}): order_status_mismatch:${status}`);
    }
  });

  it('DB가 거절한 받는 사람·이미 보낸 안내는 보내지 않는다 — 정상 건너뜀은 로그가 없다', async () => {
    for (const reason of ['no_verified_phone', 'already_sent', 'unsupported_number', 'in_progress']) {
      const send = sender();
      const log = vi.fn();
      await expect(sendOrderConfirmationAlimtalk(ORDER_ID, { config: CONFIG, repository: repository({ claim: vi.fn(async (): Promise<AlimtalkClaim> => ({ ok: false, reason })) }), sender: send, log }))
        .resolves.toEqual({ status: 'skipped', reason });
      expect(send.send).not.toHaveBeenCalled();
      expect(log).not.toHaveBeenCalled();
    }
    const log = vi.fn();
    await sendOrderConfirmationAlimtalk(ORDER_ID, { config: CONFIG, repository: repository({ claim: vi.fn(async (): Promise<AlimtalkClaim> => ({ ok: false, reason: 'outcome_unknown' })) }), sender: sender(), log });
    expect(log).toHaveBeenCalledWith(`[alimtalk] order confirmation not sent (order:${ORDER_ID}): outcome_unknown`);
  });

  it('발송 실패·결과 불명을 장부에 그대로 남기고, 발송기가 던지면 unknown으로 닫는다', async () => {
    const failed = repository();
    await expect(sendOrderConfirmationAlimtalk(ORDER_ID, { config: CONFIG, repository: failed, sender: sender({ status: 'failed', error: 'provider_http_401' }), log: vi.fn() }))
      .resolves.toEqual({ status: 'failed', error: 'provider_http_401' });
    expect(failed.complete).toHaveBeenCalledWith(CLAIM, { status: 'failed', error: 'provider_http_401' });

    const thrown = repository();
    const log = vi.fn();
    await expect(sendOrderConfirmationAlimtalk(ORDER_ID, { config: CONFIG, repository: thrown, sender: { send: vi.fn(async () => { throw new Error('boom'); }) }, log }))
      .resolves.toEqual({ status: 'failed', error: 'unexpected_send_failure' });
    expect(thrown.complete).toHaveBeenCalledWith(CLAIM, { status: 'unknown', error: 'unexpected_send_failure' });
    expect(log).toHaveBeenCalledWith(`[alimtalk] order confirmation failed (order:${ORDER_ID}): unexpected_send_failure`);
  });

  it('절대 throw하지 않는다 — 주문을 못 읽거나 장부 기록이 실패해도 결과로 돌려준다', async () => {
    const log = vi.fn();
    await expect(sendOrderConfirmationAlimtalk(ORDER_ID, { config: CONFIG, repository: repository({ loadOrder: vi.fn(async () => { throw new Error('db'); }) }), sender: sender(), log }))
      .resolves.toEqual({ status: 'failed', error: 'unexpected_alimtalk_failure' });
    const unrecorded = repository({ complete: vi.fn(async () => { throw new Error('db'); }) });
    await expect(sendOrderConfirmationAlimtalk(ORDER_ID, { config: CONFIG, repository: unrecorded, sender: sender(), log })).resolves.toEqual({ status: 'sent' });
    expect(log).toHaveBeenCalledWith(`[alimtalk] delivery_record_failed (order:${ORDER_ID})`);
    await expect(sendOrderConfirmationAlimtalk('not-a-uuid', { config: CONFIG, repository: repository(), sender: sender(), log }))
      .resolves.toEqual({ status: 'skipped', reason: 'invalid_order_reference' });
  });

  it('service role 설정이 없으면 시도하지 않는다', async () => {
    await expect(sendOrderConfirmationAlimtalk(ORDER_ID, { config: CONFIG, sender: sender(), log: vi.fn() }))
      .resolves.toEqual({ status: 'skipped', reason: 'service_role_not_configured' });
  });
});

describe('발송 시작 알림톡', () => {
  it('배송 건의 상품·택배사·송장번호로 보내고 배송 건 단위로 클레임한다', async () => {
    const repo = repository({
      loadOrder: vi.fn(async () => order({ status: 'shipping' })),
      loadShipments: vi.fn(async () => [shipment({ id: OTHER_SHIPMENT_ID, orderItemIds: ['i1'] }), shipment({ orderItemIds: ['i3'] })]),
    });
    const send = sender();
    await expect(sendOrderShippedAlimtalk({ orderId: ORDER_ID, shipmentId: SHIPMENT_ID }, { config: CONFIG, repository: repo, sender: send, log: vi.fn() }))
      .resolves.toEqual({ status: 'sent' });
    expect(repo.claim).toHaveBeenCalledWith('order_shipped', ORDER_ID, SHIPMENT_ID);
    expect(send.send).toHaveBeenCalledWith(expect.objectContaining({
      templateCode: 'XSQ_ORDER_SHIPPED',
      templateParameter: { 주문번호: '2026111910000001', 상품명: '랜덤 포토카드', 택배사: '한진택배', 송장번호: '512345678901', 주문ID: ORDER_ID },
    }));
  });

  it('선물 주문·운송장 없는 배송 건·아직 발송 전인 배송 건에는 보내지 않는다', async () => {
    const shippingOrder = vi.fn(async () => order({ status: 'shipping' }));
    const cases: [Partial<AlimtalkNoticeRepository>, string][] = [
      [{ isGiftOrder: vi.fn(async () => true) }, 'gift_order'],
      [{ loadShipments: vi.fn(async () => [shipment({ trackingNumber: ' ' })]) }, 'tracking_missing'],
      [{ loadShipments: vi.fn(async () => [shipment({ carrierLabel: null })]) }, 'tracking_missing'],
      [{ loadShipments: vi.fn(async () => [shipment({ status: 'preparing' })]) }, 'shipment_status_mismatch'],
      [{ loadShipments: vi.fn(async () => [shipment({ orderItemIds: [] })]) }, 'shipment_items_missing'],
    ];
    for (const [overrides, reason] of cases) {
      const repo = repository({ loadOrder: shippingOrder, ...overrides });
      await expect(sendOrderShippedAlimtalk({ orderId: ORDER_ID, shipmentId: SHIPMENT_ID }, { config: CONFIG, repository: repo, sender: sender(), log: vi.fn() }))
        .resolves.toEqual({ status: 'skipped', reason });
      expect(repo.claim).not.toHaveBeenCalled();
    }
  });

  it('배송 건 id가 없으면 배송 건이 하나뿐인 주문에서만 보낸다(어드민 단건 상태 변경)', async () => {
    const single = repository({ loadOrder: vi.fn(async () => order({ status: 'shipping' })) });
    await expect(sendOrderShippedAlimtalk({ orderId: ORDER_ID }, { config: CONFIG, repository: single, sender: sender(), log: vi.fn() })).resolves.toEqual({ status: 'sent' });
    expect(single.claim).toHaveBeenCalledWith('order_shipped', ORDER_ID, SHIPMENT_ID);
    const multiple = repository({
      loadOrder: vi.fn(async () => order({ status: 'shipping' })),
      loadShipments: vi.fn(async () => [shipment(), shipment({ id: OTHER_SHIPMENT_ID })]),
    });
    await expect(sendOrderShippedAlimtalk({ orderId: ORDER_ID }, { config: CONFIG, repository: multiple, sender: sender(), log: vi.fn() }))
      .resolves.toEqual({ status: 'skipped', reason: 'shipment_reference_required' });
  });

  it('결제 확인만 된 주문에는 발송 안내를 보내지 않는다', async () => {
    const repo = repository();
    await expect(sendOrderShippedAlimtalk({ orderId: ORDER_ID, shipmentId: SHIPMENT_ID }, { config: CONFIG, repository: repo, sender: sender(), log: vi.fn() }))
      .resolves.toEqual({ status: 'skipped', reason: 'order_status_mismatch:paid' });
    expect(repo.isGiftOrder).not.toHaveBeenCalled();
  });
});

describe('visibleItemNames', () => {
  it('옵션 이름 없이 상품 이름만, 랜덤 배정 행은 상품마다 한 줄로 합친다', () => {
    expect(visibleItemNames(order().items)).toEqual(['메이플스토리 아크릴 키링', '랜덤 포토카드']);
    expect(visibleItemNames([
      { id: 'a', goodId: 'g', name: '키링', random: false },
      { id: 'b', goodId: 'g', name: '키링', random: false },
    ])).toEqual(['키링', '키링']);
  });
});
