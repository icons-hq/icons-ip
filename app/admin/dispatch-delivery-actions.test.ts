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
    expect(await recordDispatchShipmentDeliveryAction(handoff())).toMatchObject({ ok: true, message: expect.stringContaining('배송 중') });
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
      expect(await recordDispatchShipmentDeliveryAction(handoff())).toMatchObject({ ok: false });
      expect(await readDispatchShipmentDeliveryAction(shipmentId)).toMatchObject({ ok: false });
    }
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it('rejects receipts without the customer one-time value before the database', async () => {
    const form = handoff(); form.set('kind', 'quick_receive'); form.delete('providerName'); form.delete('providerPhone'); form.delete('handoffReference');
    form.set('recipientKind', 'self'); form.set('receiptReference', '수령 기록');
    expect(await recordDispatchShipmentDeliveryAction(form)).toMatchObject({ ok: false });
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
    expect(await readDispatchShipmentDeliveryAction(shipmentId)).toEqual({ ok: false, error: '배송 인계 정보를 불러오지 못했습니다.' });
  });
});
