import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ auth: vi.fn(), rpc: vi.fn(), revalidate: vi.fn() }));
vi.mock('@/lib/auth/admin', () => ({ getCurrentAdminAuthState: mocks.auth }));
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({ rpc: mocks.rpc }) }));
vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidate }));
vi.mock('next/navigation', () => ({ unstable_rethrow: vi.fn() }));
import { recordShipmentDeliveryAction, saveDeliveryPolicyAction, selectShipmentDeliveryMethodAction } from './shipment-delivery-actions';
const shipmentId = '00000000-0000-4000-8000-000000000001';
const operationId = '00000000-0000-4000-8000-000000000002';
function receipt() {
  const form = new FormData();
  for (const [key, value] of Object.entries({ shipmentId, operationId, kind: 'pickup_receive', updatedAt: '2026-09-10T09:00:00.123456Z',
    operatorName: '인계 담당', occurredAt: '2026-09-10T18:30', recipientKind: 'self', receiptReference: '수령 기록 1', receiptCode: '1234-ABCD-5678' })) form.set(key, value);
  return form;
}
beforeEach(() => { vi.resetAllMocks(); mocks.auth.mockResolvedValue({ isConfigured: true, user: { id: 'staff' }, role: 'staff', isStaff: true }); });
describe('delivery method server actions', () => {
  it('requires admin for operating policy changes but allows staff receipt evidence', async () => {
    expect(await saveDeliveryPolicyAction(new FormData())).toMatchObject({ ok: false }); expect(mocks.rpc).not.toHaveBeenCalled();
    mocks.rpc.mockResolvedValue({ data: { ok: true, replayed: false }, error: null });
    expect(await recordShipmentDeliveryAction(receipt())).toMatchObject({ ok: true });
    expect(mocks.rpc).toHaveBeenCalledWith('admin_record_shipment_delivery', expect.objectContaining({ p_operation_id: operationId,
      p_expected_updated_at: '2026-09-10T09:00:00.123456Z', p_receipt_code: '1234ABCD5678',
      p_evidence: { operatorName: '인계 담당', occurredAt: '2026-09-10T09:30:00.000Z', recipientKind: 'self', receiptReference: '수령 기록 1' } }));
  });
  it('requires positive customer fee-consent evidence without sending a new fee to the database', async () => {
    const form = new FormData();
    for (const [key, value] of Object.entries({ shipmentId, operationId, method: 'parcel', policyId: '', updatedAt: '2026-09-10T09:00:00Z', customerRequestReference: '고객 요청 1' })) form.set(key, value);
    expect(await selectShipmentDeliveryMethodAction(form)).toMatchObject({ ok: false }); expect(mocks.rpc).not.toHaveBeenCalled();
    form.set('feeConsentReference', '배송비 유지 동의 1'); form.set('feeUnchanged', 'on');
    mocks.rpc.mockResolvedValue({ data: { ok: true }, error: null });
    expect(await selectShipmentDeliveryMethodAction(form)).toMatchObject({ ok: true });
    expect(mocks.rpc.mock.calls[0][1]).toMatchObject({ p_policy_id: null, p_fee_unchanged: true });
    expect(mocks.rpc.mock.calls[0][1]).not.toHaveProperty('shippingFee');
  });
  it('treats a committed bad-code attempt as failure without reporting a completed shipment', async () => {
    mocks.rpc.mockResolvedValue({ data: { ok: false, error: 'delivery_receipt_code_invalid', remainingAttempts: 4 }, error: null });
    expect(await recordShipmentDeliveryAction(receipt())).toMatchObject({ ok: false, error: expect.stringContaining('일치하지') });
    expect(mocks.revalidate).not.toHaveBeenCalled();
  });
  it('rejects non-staff before touching an order', async () => {
    mocks.auth.mockResolvedValue({ isConfigured: true, user: { id: 'customer' }, isStaff: false });
    expect(await recordShipmentDeliveryAction(receipt())).toMatchObject({ ok: false }); expect(mocks.rpc).not.toHaveBeenCalled();
  });
});
