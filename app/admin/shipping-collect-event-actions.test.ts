import { beforeEach, expect, it, vi } from 'vitest';
import { shippingCollectReceipt, shippingCollectRequest as request } from '@/test/fixtures/shipping-collect';
const mocks = vi.hoisted(() => ({ access: vi.fn(), rpc: vi.fn(), revalidate: vi.fn() }));
vi.mock('@/lib/admin/action-access.server', () => ({ requireAdminActionAccess: mocks.access }));
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({ rpc: mocks.rpc }) }));
vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidate }));
vi.mock('next/navigation', () => ({ unstable_rethrow: vi.fn() }));
import { readShippingCollectEventOperationAction, readShippingCollectEventsAction, saveShippingCollectEventAction } from './shipping-collect-event-actions';
beforeEach(() => { vi.clearAllMocks();mocks.access.mockResolvedValue({ user: { id: request.expectedActorId } });mocks.rpc.mockResolvedValue({ data: shippingCollectReceipt(), error: null }); });
it('주문·배송건·actor·revision·증빙을 그대로 묶어 저장하고 receipt를 대조한다', async () => {
  expect(await saveShippingCollectEventAction(request)).toEqual({ ok: true, value: shippingCollectReceipt() });
  expect(mocks.access).toHaveBeenCalledWith(`/admin/sales/orders/${request.orderId}`, { capability: 'sales.manage' });
  expect(mocks.rpc).toHaveBeenCalledWith('admin_record_shipping_collect_event', { p_order_id: request.orderId, p_shipment_id: request.shipmentId,
    p_expected_revision: 1, p_operation_id: request.operationId, p_event: 'collected', p_amount: 2250, p_occurred_at: request.occurredAt,
    p_party: request.party, p_reverses_operation_id: null, p_reference: request.reference, p_note: request.note, p_expected_actor_id: request.expectedActorId });
});
it.each([null, { user: { id: request.orderId } }])('거절된권한/교체된계정으로읽기·쓰기·이전결과조회를실행하지않는다', async auth => {
  mocks.access.mockResolvedValue(auth);
  expect((await saveShippingCollectEventAction(request)).ok).toBe(false);expect((await readShippingCollectEventsAction(request)).ok).toBe(false);
  expect((await readShippingCollectEventOperationAction(request)).ok).toBe(false);expect(mocks.rpc).not.toHaveBeenCalled();
});
it('변조영수증과network실패는동일요청확인으로남긴다', async () => {
  const other = shippingCollectReceipt();other.obligation.orderId = request.shipmentId;
  mocks.rpc.mockResolvedValueOnce({ data: other, error: null });expect(await saveShippingCollectEventAction(request)).toMatchObject({ ok: false, uncertain: true });
  mocks.rpc.mockRejectedValueOnce(new Error('transport'));expect(await saveShippingCollectEventAction(request)).toMatchObject({ ok: false, uncertain: true });
  expect(mocks.revalidate).not.toHaveBeenCalled();
});
it('명시된SQL충돌은미확정저장과구분한다', async () => {
  mocks.rpc.mockResolvedValueOnce({ error: { code: 'PT409', message: 'shipping_collect_changed' } });
  expect(await saveShippingCollectEventAction(request)).toMatchObject({ ok: false, uncertain: false, conflict: true });
});
it('이전결과null과현재다른주문내역을저장성공으로바꾸지않는다', async () => {
  mocks.rpc.mockResolvedValueOnce({ data: null, error: null });expect(await readShippingCollectEventOperationAction(request)).toEqual({ ok: true, value: null });
  const other = shippingCollectReceipt().obligation;other.orderId = request.shipmentId;
  mocks.rpc.mockResolvedValueOnce({ data: [other], error: null });expect((await readShippingCollectEventsAction(request)).ok).toBe(false);
});
