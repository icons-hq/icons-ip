import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ auth: vi.fn(), rpc: vi.fn(), revalidate: vi.fn() }));
vi.mock('@/lib/auth/admin', () => ({ getCurrentAdminAuthState: mocks.auth }));
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({ rpc: mocks.rpc }) }));
vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidate }));
vi.mock('next/navigation', () => ({ unstable_rethrow: vi.fn() }));
import { changeShipmentPreorderDateAction, readShipmentPreorderPromiseAction } from './preorder-shipment-actions';
const shipmentId = '00000000-0000-4000-8000-000000000001';
function form(reason = '공급 일정 재확인') {
  const data = new FormData(); data.set('shipmentId', shipmentId); data.set('expectedShipDate', '2099-10-01');
  data.set('updatedAt', '2099-09-10T00:00:00.123456Z'); data.set('reason', reason); return data;
}
beforeEach(() => { vi.resetAllMocks(); mocks.auth.mockResolvedValue({ isConfigured: true, user: { id: 'staff' }, isStaff: true }); });
describe('shipment promise changes', () => {
  it('preserves the exact observed timestamp and requires a recorded reason', async () => {
    expect(await changeShipmentPreorderDateAction(form(''))).toMatchObject({ ok: false });
    expect(mocks.rpc).not.toHaveBeenCalled();
    mocks.rpc.mockResolvedValue({ data: { changed: true }, error: null });
    expect(await changeShipmentPreorderDateAction(form())).toMatchObject({ ok: true });
    expect(mocks.rpc).toHaveBeenCalledWith('admin_change_shipment_preorder_date', {
      p_shipment_id: shipmentId, p_expected_ship_date: '2099-10-01', p_reason: '공급 일정 재확인', p_expected_updated_at: '2099-09-10T00:00:00.123456Z',
    });
  });
  it('rejects non-staff reads and changes and does not call the database', async () => {
    mocks.auth.mockResolvedValue({ isConfigured: true, user: { id: 'customer' }, isStaff: false });
    expect(await readShipmentPreorderPromiseAction(shipmentId)).toMatchObject({ ok: false });
    expect(await changeShipmentPreorderDateAction(form())).toMatchObject({ ok: false });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it('returns a refresh prompt after a conflict without reporting a changed promise', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code: 'PT409', message: 'shipment_promise_changed' } });
    expect(await changeShipmentPreorderDateAction(form())).toMatchObject({ ok: false, error: expect.stringContaining('변경되었습니다') });
    expect(mocks.revalidate).not.toHaveBeenCalled();
  });
});
