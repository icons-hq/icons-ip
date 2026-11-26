import { configuredOperatorAccessFixture, legacyOperatorAccessFixture } from '@/lib/admin/access.test-fixtures';
import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ auth: vi.fn(), rpc: vi.fn(), revalidate: vi.fn() }));
vi.mock('@/lib/auth/admin', () => ({ getCurrentAdminAuthState: mocks.auth }));
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({ rpc: mocks.rpc }) }));
vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidate }));
vi.mock('next/navigation', () => ({ unstable_rethrow: vi.fn(), redirect: (path: string) => { throw new Error(`NEXT_REDIRECT:${path}`); } }));
import { readDispatchShipmentDeliveryAction, recordDispatchShipmentDeliveryAction } from './dispatch-delivery-actions';

const shipmentId = '00000000-0000-4000-8000-000000000001';
const orderId = '00000000-0000-4000-8000-000000000003';
const originId = '00000000-0000-4000-8000-000000000004';
const operationId = '00000000-0000-4000-8000-000000000002';
const as = (operatorAccess: ReturnType<typeof legacyOperatorAccessFixture>) =>
  mocks.auth.mockResolvedValue({ operatorAccess, isConfigured: true, user: { id: 'operator' }, role: 'staff', isStaff: true });
function handoff() {
  const form = new FormData();
  for (const [key, value] of Object.entries({ shipmentId, operationId, kind: 'quick_handoff', updatedAt: '2026-11-11T09:00:00.123456Z',
    operatorName: '물류 담당', providerName: '퀵 업체', providerPhone: '010-0000-0000', handoffReference: '인계 기록', occurredAt: '2026-11-11T18:30' })) form.set(key, value);
  return form;
}
const delivery = (shippingFee: number | null) => ({ shipmentId, orderId, originId, status: 'ready', orderStatus: 'confirmed', updatedAt: '2026-11-11T09:00:00.123456Z',
  shippingFee, exportedAt: null, canSelect: true, canTransition: true, preorderReady: true,
  summary: { method: 'quick', providerName: null, canIssueReceipt: false, policy: { version: 1, policyId: operationId, revision: 1,
    feeRule: 'order_fee_unchanged', confirmationRule: 'recipient_code', allowDelegate: false, contactName: '운영 담당', contactPhone: '02-0000-0000',
    handoffLocation: '인계 장소', handoffInstructions: '인계 안내', appointmentInstructions: '예약 안내', completionInstructions: '수령 기록',
    cancellationInstructions: '취소 안내' } }, policies: [], history: [] });

beforeEach(() => { vi.resetAllMocks(); as(configuredOperatorAccessFixture('logistics')); });

describe('dispatch non-parcel handoff actions (1014-084)', () => {
  it('lets the logistics role record a non-parcel handoff from the dispatch console', async () => {
    mocks.rpc.mockResolvedValue({ data: { ok: true, replayed: false }, error: null });
    expect(await recordDispatchShipmentDeliveryAction(handoff())).toEqual({ ok: true, message: '인계를 기록하고 배송중으로 바꿨습니다.' });
    expect(mocks.rpc).toHaveBeenCalledWith('admin_record_shipment_delivery', expect.objectContaining({ p_kind: 'quick_handoff', p_receipt_code: null,
      p_operation_id: operationId, p_evidence: expect.objectContaining({ operatorName: '물류 담당', occurredAt: '2026-11-11T09:30:00.000Z' }) }));
    expect(mocks.revalidate).toHaveBeenCalledWith('/admin/sales/shipping');
  });
  it('keeps the same access for order managers and closes it to managers without dispatch', async () => {
    mocks.rpc.mockResolvedValue({ data: { ok: true, replayed: true }, error: null });
    for (const access of [configuredOperatorAccessFixture('primary'), configuredOperatorAccessFixture('owner'), legacyOperatorAccessFixture('staff')]) {
      as(access); expect(await recordDispatchShipmentDeliveryAction(handoff())).toMatchObject({ ok: true });
    }
    mocks.rpc.mockClear();
    for (const role of ['deputy', 'influencer', 'agency'] as const) {
      as(configuredOperatorAccessFixture(role));
      /* 권한 문장은 출고 화면이 함께 쓰는 한 문장이다(설정 화면의 낱말 '출고 권한'). */
      expect(await recordDispatchShipmentDeliveryAction(handoff())).toEqual({ ok: false, error: '출고 권한이 없거나 로그인이 끝났습니다. 로그인한 계정을 확인하고, 권한이 없으면 계정 주매니저에게 요청해주세요.' });
      expect(await readDispatchShipmentDeliveryAction(shipmentId)).toMatchObject({ ok: false, error: expect.stringContaining('출고 권한이 없거나') });
    }
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it('rejects receipts without the customer one-time value before the database', async () => {
    const form = handoff(); form.set('kind', 'quick_receive'); form.delete('providerName'); form.delete('providerPhone'); form.delete('handoffReference');
    form.set('recipientKind', 'self'); form.set('receiptReference', '수령 기록');
    /* 오류 문구가 가리키는 칸 이름('고객이 보여 준 확인값')이 이 창의 칸 이름과 같다. */
    expect(await recordDispatchShipmentDeliveryAction(form)).toEqual({ ok: false, error: '담당자·시각·확인 내용을 모두 적어주세요. 수령 기록에는 고객이 보여 준 확인값 12자리도 필요합니다.' });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it('reads handoff conditions without returning the shipping fee, method policies or method-change availability', async () => {
    mocks.rpc.mockResolvedValue({ data: delivery(null), error: null });
    const result = await readDispatchShipmentDeliveryAction(shipmentId);
    expect(result).toMatchObject({ ok: true, shipment: { shipmentId, canTransition: true, summary: { method: 'quick' } } });
    expect(result.ok && result.shipment).not.toHaveProperty('shippingFee');
    expect(result.ok && result.shipment).not.toHaveProperty('policies');
    expect(result.ok && result.shipment).not.toHaveProperty('canSelect');
    mocks.rpc.mockResolvedValue({ data: delivery(3000), error: null });
    expect(await readDispatchShipmentDeliveryAction(shipmentId)).toMatchObject({ ok: true });
    mocks.rpc.mockResolvedValue({ data: null, error: { message: 'operator_capability_required' } });
    expect(await readDispatchShipmentDeliveryAction(shipmentId)).toEqual({ ok: false, error: '인계·수령 정보를 불러오지 못했습니다.' });
  });

  /*
   * QA-O 고칠 것 5: 시각 칸은 분 단위다. 발주확인(16:00:48)한 그 분 안에 처음 값(16:00) 그대로 기록하면 16:00:00이 발주확인보다 앞이라 DB가 거절했다.
   * '지금 분'을 적은 것은 지금이라는 뜻이므로, 거절되면(아무것도 남지 않았다) 초까지 채운 지금 시각으로 한 번 더 기록한다. DB 검사는 그대로다.
   */
  it('지금 분으로 적은 시각이 발주확인보다 앞이라 거절되면 초까지 채운 지금 시각으로 한 번 더 기록한다', async () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-11-11T09:30:55.400Z'));
    try {
      mocks.rpc.mockResolvedValueOnce({ data: null, error: { code: '23514', message: 'invalid_delivery_evidence' } })
        .mockResolvedValueOnce({ data: { ok: true, replayed: false }, error: null });
      expect(await recordDispatchShipmentDeliveryAction(handoff())).toEqual({ ok: true, message: '인계를 기록하고 배송중으로 바꿨습니다.' });
      expect(mocks.rpc.mock.calls.map(([, input]) => (input as { p_evidence: { occurredAt: string } }).p_evidence.occurredAt))
        .toEqual(['2026-11-11T09:30:00.000Z', '2026-11-11T09:30:54.400Z']);
      /* 같은 처리 번호·같은 나머지 내용으로 보낸다. */
      expect(mocks.rpc.mock.calls[1][1]).toMatchObject({ p_operation_id: operationId, p_kind: 'quick_handoff', p_evidence: { operatorName: '물류 담당', providerName: '퀵 업체' } });
    } finally { vi.useRealTimers(); }
  });

  it('다른 분을 적었거나 다시 해도 거절되면 한 번만 보내고, 시각이 원인이라고 그 칸을 짚어 말한다', async () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-11-11T10:15:00.000Z'));
    try {
      mocks.rpc.mockResolvedValue({ data: null, error: { code: '23514', message: 'invalid_delivery_evidence' } });
      expect(await recordDispatchShipmentDeliveryAction(handoff())).toEqual({ ok: false, error: '인계 시각이 발주확인보다 앞이거나 지금보다 뒤입니다. 발주확인 뒤부터 지금까지의 시각으로 고쳐 주세요.' });
      expect(mocks.rpc).toHaveBeenCalledTimes(1);
    } finally { vi.useRealTimers(); }
  });

  it('칸이 비었거나 길이를 넘어 거절되면 시각이 아니라 그 칸들을 말한다', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code: '22023', message: 'invalid_delivery_evidence' } });
    expect(await recordDispatchShipmentDeliveryAction(handoff())).toEqual({ ok: false,
      error: '인계한 담당자·배송 업체·기사·업체 연락처·인계 확인 내용을 모두 적어주세요. 담당자와 업체 이름은 100자, 연락처는 40자, 확인 내용은 2,000자까지입니다.' });
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
  });
});
