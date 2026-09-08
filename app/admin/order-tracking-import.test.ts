import { beforeEach, describe, expect, it, vi } from 'vitest';
import { bulkRegisterAdminOrderTrackingAction } from './order-actions';
const mocks = vi.hoisted(() => ({ auth: vi.fn(), rpc: vi.fn(), enqueue: vi.fn(), carriers: vi.fn(), refresh: vi.fn() }));
vi.mock('@/lib/auth/admin', () => ({ getCurrentAdminAuthState: mocks.auth }));
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({ rpc: mocks.rpc }) }));
vi.mock('@/lib/orders/shipment.server', () => ({ getShippingCarrierRegistry: mocks.carriers }));
vi.mock('@/lib/email/order-shipment-jobs.server', () => ({ enqueueOrderShippedEmails: mocks.enqueue }));
vi.mock('next/cache', () => ({ revalidatePath: mocks.refresh }));
function form(text: string) { const data = new FormData(); data.set('pasted', text); return data; }
beforeEach(() => {
  vi.clearAllMocks();
  mocks.auth.mockResolvedValue({ isConfigured: true, user: { id: 'staff' }, role: 'staff', isStaff: true });
  mocks.carriers.mockResolvedValue([{ code: 'hanjin', label: '한진택배', active: true, trackingUrlTemplate: 'https://example.test/{trackingNumber}' }]);
  mocks.enqueue.mockResolvedValue({ queued: 1 });
  mocks.rpc.mockImplementation(async (_name: string, { target_rows }: { target_rows: { line: number; reference: string }[] }) => ({ error: null,
    data: target_rows.map((row) => ({ ...row, ok: true, dispatched: true, orderId: `00000000-0000-4000-8000-${String(row.line).padStart(12, '0')}`, shipmentId: `10000000-0000-4000-8000-${String(row.line).padStart(12, '0')}` })) }));
});
describe('bulk tracking action', () => {
  it('requires staff before parsing or writing a shipment', async () => {
    mocks.auth.mockResolvedValue({ isConfigured: true, user: { id: 'buyer' }, role: 'user', isStaff: false });
    expect(await bulkRegisterAdminOrderTrackingAction({}, form('00000001,hanjin,12345678'))).toHaveProperty('errors.form');
    expect(mocks.carriers).not.toHaveBeenCalled(); expect(mocks.rpc).not.toHaveBeenCalled(); expect(mocks.enqueue).not.toHaveBeenCalled();
  });
  it('accepts exactly 1000 rows and queues them without synchronous delivery', async () => {
    const text = Array.from({ length: 1000 }, (_, i) => `${i.toString(16).padStart(8, '0')},hanjin,${String(10000000 + i)}`).join('\n');
    const result = await bulkRegisterAdminOrderTrackingAction({}, form(text));
    expect(result.report?.succeeded).toHaveLength(1000); expect(result.report?.failed).toEqual([]);
    expect(mocks.rpc).toHaveBeenCalledOnce(); expect(mocks.rpc.mock.calls[0][0]).toBe('admin_import_shipment_tracking_batch');
    expect(mocks.enqueue.mock.calls[0][0]).toHaveLength(1000);
  });
  it('rejects 1001 rows and files over 256KB before shipment writes', async () => {
    const text = Array.from({ length: 1001 }, (_, i) => `${i.toString(16).padStart(8, '0')},hanjin,${String(10000000 + i)}`).join('\n');
    expect(await bulkRegisterAdminOrderTrackingAction({}, form(text))).toHaveProperty('errors.form');
    const data = form('00000001,hanjin,12345678'); data.set('file', new File(['x'.repeat(256 * 1024 + 1)], 'tracking.csv'));
    expect(await bulkRegisterAdminOrderTrackingAction({}, data)).toHaveProperty('errors.form');
    expect(mocks.rpc).not.toHaveBeenCalled(); expect(mocks.enqueue).not.toHaveBeenCalled();
  });
  it('merges parser and database failures by original line while keeping successful IDs', async () => {
    mocks.rpc.mockResolvedValue({ error: null, data: [
      { line: 1, reference: '00000001', ok: true, orderId: 'order-one', shipmentId: 'shipment-one', dispatched: true },
      { line: 3, reference: '00000003', ok: false, error: 'shipment_not_found' },
    ] });
    const result = await bulkRegisterAdminOrderTrackingAction({}, form('00000001,hanjin,12345678\ninvalid,hanjin,12345679\n00000003,hanjin,12345680'));
    expect(result.report?.succeeded).toEqual(['00000001']);
    expect(result.report?.failed.map((failure) => failure.line)).toEqual([2, 3]);
    expect(result.report?.failed[1].reason).toBe('배송 건을 찾을 수 없습니다.');
    expect(mocks.enqueue).toHaveBeenCalledWith([{ orderId: 'order-one', shipmentId: 'shipment-one' }]);
  });
  it('keeps committed shipment success and visibly warns when queue confirmation fails', async () => {
    mocks.enqueue.mockRejectedValue(new Error('queue unavailable'));
    const result = await bulkRegisterAdminOrderTrackingAction({}, form('00000001,hanjin,12345678'));
    expect(result.report?.succeeded).toEqual(['00000001']); expect(result.errors).toBeUndefined();
    expect(result.message).toContain('배송 메일 대기열 확인이 필요합니다.');
    expect(result.queueWarning).toBe(true);
    expect(mocks.refresh).toHaveBeenCalledWith('/admin/sales/dispatch');
  });
  it('reports an indeterminate batch response without claiming any rows succeeded', async () => {
    mocks.rpc.mockResolvedValue({ error: null, data: [] });
    const result = await bulkRegisterAdminOrderTrackingAction({}, form('00000001,hanjin,12345678'));
    expect(result.errors?.form).toContain('등록 결과를 확인하지 못했습니다.');
    expect(result.report).toBeUndefined(); expect(mocks.enqueue).not.toHaveBeenCalled();
  });
});
