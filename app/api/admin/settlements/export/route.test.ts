import { beforeEach, expect, it, vi } from 'vitest';
const mock = vi.hoisted(() => ({ access: vi.fn(), rpc: vi.fn(), workbook: vi.fn() }));
vi.mock('@/lib/admin/guard.server', () => ({ requireAdminScreenAccess: mock.access }));
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({ rpc: mock.rpc }) }));
vi.mock('@/lib/settlements/export.server', () => ({ buildPgSettlementWorkbook: mock.workbook }));
vi.mock('next/navigation', () => ({ unstable_rethrow: () => {} }));
import { GET } from './route';
import { settlementReportFixture } from '@/lib/settlements/fixture';
const report = settlementReportFixture();
const url = `http://localhost/api/admin/settlements/export?from=2026-10-01&to=2026-10-31&mode=test&import=${report.snapshot!.id}`;
beforeEach(() => { vi.clearAllMocks(); mock.access.mockResolvedValue(true); mock.workbook.mockResolvedValue(Buffer.from('xlsx'));
  mock.rpc.mockImplementation(async name => name === 'admin_export_pg_settlement_report' ? { data: { ...report, pagination: { ...report.pagination, pageSize: 20000 } }, error: null } : { data: '287b949d-af67-4398-b0d2-09adbd123456', error: null }); });
it('downloads a fixed complete snapshot only after current permission and export audit succeed', async () => {
  const result = await GET(new Request(url)); expect(result.status).toBe(200); expect(result.headers.get('Cache-Control')).toBe('private, no-store');
  expect(result.headers.get('X-ICONS-Settlement-Import')).toBe(report.snapshot!.id);
  expect(mock.rpc).toHaveBeenLastCalledWith('admin_record_pg_settlement_export', expect.objectContaining({ p_fingerprint: report.fingerprint, p_record_count: 1 }));
  expect(mock.access).toHaveBeenCalledWith('/admin/settlements', { capability: 'sales.manage', adminOnly: true });
});
it('never exports a partial result, implicit latest snapshot, or unaudited file', async () => {
  expect((await GET(new Request(url.replace(`&import=${report.snapshot!.id}`, '')))).status).toBe(400); expect(mock.workbook).not.toHaveBeenCalled();
  mock.rpc.mockResolvedValue({ data: { ...report, pagination: { ...report.pagination, total: 2 } }, error: null });
  expect((await GET(new Request(url))).status).toBe(503); expect(mock.workbook).not.toHaveBeenCalled();
  mock.rpc.mockResolvedValueOnce({ data: report, error: null }).mockResolvedValueOnce({ data: null, error: { code: '42501' } });
  const denied = await GET(new Request(url)); expect(denied.status).toBe(503); expect(denied.headers.get('Content-Type')).toContain('application/json');
});
