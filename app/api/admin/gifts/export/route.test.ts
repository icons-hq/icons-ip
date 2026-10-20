import { beforeEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ guard: vi.fn(), rpc: vi.fn(), service: vi.fn(), build: vi.fn(), encrypt: vi.fn() }));
vi.mock('@/lib/admin/guard.server', () => ({ requireAdminScreenAccess: mocks.guard }));
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({ rpc: mocks.rpc }) }));
vi.mock('@/lib/supabase/service', () => ({ createServiceClient: () => ({ rpc: mocks.service }) }));
vi.mock('@/lib/admin/list-export.server', () => ({ buildAdminListExportWorkbook: mocks.build }));
vi.mock('@/lib/admin/encrypted-workbook.server', () => ({ encryptAdminWorkbook: mocks.encrypt }));
vi.mock('next/navigation', () => ({ unstable_rethrow: vi.fn() }));
import { GET, POST } from './route';
import { adminGiftRow, giftConsoleId as id } from '../../../../../test/fixtures/admin-gifts';
let plain: Buffer;
beforeEach(() => { vi.clearAllMocks(); mocks.guard.mockResolvedValue({ user: { id: id(10) } });
  mocks.rpc.mockResolvedValue({ data: { rows: [adminGiftRow], total: 1, asOf: adminGiftRow.createdAt, receiptId: id(20), fingerprint: 'a'.repeat(64) }, error: null });
  mocks.service.mockResolvedValue({ data: id(21), error: null }); plain = Buffer.from('plaintext-workbook'); mocks.build.mockResolvedValue(plain);
  mocks.encrypt.mockReturnValue({ bytes: Buffer.from('encrypted-workbook'), sha256: 'b'.repeat(64) }); });
function request(query = 'state=all&query=상품') { return new Request(`https://example.test/api/admin/gifts/export?${query}`, {
  method: 'POST', headers: { origin: 'https://example.test', 'content-type': 'application/json' }, body: JSON.stringify({ password: 'StrongTEST123!', passwordConfirmation: 'StrongTEST123!' }) }); }
it('GET·다른 origin·URL비밀번호는 파일과 DB 읽기를 시작하지 않는다', async () => {
  expect((await GET()).status).toBe(405); const other = request(); other.headers.set('origin', 'https://evil.test'); expect((await POST(other)).status).toBe(403);
  expect((await POST(request('password=bad'))).status).toBe(400); expect(mocks.rpc).not.toHaveBeenCalled(); expect(mocks.build).not.toHaveBeenCalled();
});
it('검색조건 전체 snapshot→암호화→현재 권한 감사 뒤에만 파일을 응답한다', async () => {
  const response = await POST(request()); expect(response.status).toBe(200);
  expect(mocks.guard).toHaveBeenCalledWith('/admin/sales/gifts', { capability: 'sales.read' });
  expect(mocks.rpc).toHaveBeenCalledWith('admin_prepare_gift_export', { p_expected_actor_id: id(10), p_state: null, p_search: '상품' });
  expect(mocks.service).toHaveBeenCalledWith('service_record_gift_export', { p_actor_id: id(10), p_receipt_id: id(20), p_fingerprint: 'a'.repeat(64), p_file_sha256: 'b'.repeat(64) });
  expect(mocks.encrypt.mock.invocationCallOrder[0]).toBeLessThan(mocks.service.mock.invocationCallOrder[0]);
  expect(response.headers.get('x-icons-export-encryption')).toBe('ECMA-376-Agile'); expect(response.headers.get('x-icons-export-rows')).toBe('1');
  expect(Buffer.from(await response.arrayBuffer()).toString()).toBe('encrypted-workbook'); expect(plain.every(byte => byte === 0)).toBe(true);
});
it.each(['encryption', 'audit'])('%s 실패는 평문을 지우고 파일을 반환하지 않는다', async kind => {
  if (kind === 'encryption') mocks.encrypt.mockImplementationOnce(() => { throw new Error('failed'); }); else mocks.service.mockResolvedValueOnce({ error: { code: '42501' }, data: null });
  const response = await POST(request()); expect(response.status).toBe(500); expect(response.headers.get('content-type')).toContain('json'); expect(plain.every(byte => byte === 0)).toBe(true);
});
it('권한 거절과 최대 건수 초과는 workbook을 만들지 않는다', async () => {
  mocks.guard.mockRejectedValueOnce(new Error('denied')); await expect(POST(request())).rejects.toThrow('denied'); expect(mocks.rpc).not.toHaveBeenCalled();
  mocks.rpc.mockResolvedValueOnce({ error: { code: '54000' }, data: null }); expect((await POST(request())).status).toBe(400); expect(mocks.build).not.toHaveBeenCalled();
});
