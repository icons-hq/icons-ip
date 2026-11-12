import { legacyOperatorAccessFixture } from '@/lib/admin/access.test-fixtures';
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
beforeEach(() => { vi.resetAllMocks(); mocks.auth.mockResolvedValue({ operatorAccess: legacyOperatorAccessFixture(), isConfigured: true, user: { id: 'staff' }, isStaff: true }); });
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
    mocks.auth.mockResolvedValue({ operatorAccess: legacyOperatorAccessFixture(), isConfigured: true, user: { id: 'customer' }, isStaff: false });
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

describe('shipment promise change rows', () => {
  const ids = { shipmentId: '11111111-1111-4111-8111-111111111111', orderId: '22222222-2222-4222-8222-222222222222' };
  const bulk = '33333333-3333-4333-8333-333333333333';
  const row = (extra: object) => ({ id: '44444444-4444-4444-8444-444444444444', fromDate: '2099-10-15', toDate: '2099-10-15', reason: 'r', actorName: null, changedAt: '2099-09-01T00:00:00Z', ...extra });
  const read = async (changes: object[]) => {
    mocks.rpc.mockResolvedValue({ data: { ...ids, status: 'ready', originalExpectedShipDate: '2099-10-01', expectedShipDate: '2099-10-15', updatedAt: '2099-09-01T00:00:00Z', changes }, error: null });
    return readShipmentPreorderPromiseAction(ids.shipmentId, ids.orderId);
  };
  it('reads bulkChangeId and noticeOnly, and tolerates rows from a database without them', async () => {
    const result = await read([row({ bulkChangeId: bulk, noticeOnly: true }), row({})]);
    expect(result).toMatchObject({ ok: true, promise: { changes: [{ bulkChangeId: bulk, noticeOnly: true }, { bulkChangeId: null, noticeOnly: false }] } });
  });
});
