import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ guard: vi.fn(), rpc: vi.fn(), builder: vi.fn(), encrypt: vi.fn(), audit: vi.fn() }));
vi.mock('@/lib/admin/guard.server', () => ({ requireAdminScreenAccess: mocks.guard }));
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({ rpc: mocks.rpc }) }));
vi.mock('@/lib/admin/settled-workbook.server', () => ({ buildSettledWorkbook: mocks.builder }));
vi.mock('@/lib/admin/encrypted-workbook.server', () => ({ encryptAdminWorkbook: mocks.encrypt }));
vi.mock('@/lib/admin/encrypted-export-audit.server', () => ({ recordEncryptedSettledExport: mocks.audit }));
vi.mock('next/navigation', () => ({ unstable_rethrow: vi.fn() }));
import { GET, POST } from './route';

const ID = '10000000-0000-4000-8000-000000004951';
function request(extra = '') { return new Request(`https://example.test/api/admin/settled-workbook?id=${ID}${extra}`, {
  method: 'POST', headers: { origin: 'https://example.test', 'content-type': 'application/json' },
  body: JSON.stringify({ password: 'StrongTEST123!', passwordConfirmation: 'StrongTEST123!' }),
}); }
beforeEach(() => {
  vi.clearAllMocks(); mocks.guard.mockResolvedValue({ user: { id: 'staff' } });
  mocks.rpc.mockResolvedValue({ data: { receiptId: ID }, error: null });
  mocks.builder.mockResolvedValue(Buffer.from('xlsx-evidence'));
  mocks.encrypt.mockReturnValue({ bytes: Buffer.from('encrypted-evidence'), sha256: 'a'.repeat(64) });
  mocks.audit.mockResolvedValue('audit-id');
});
describe('보존된 거래확정 암호화 엑셀 다운로드', () => {
  it('권한→보존 기록→생성→암호화→감사 순서 후 파일을 응답한다', async () => {
    const response = await POST(request());
    expect(mocks.guard).toHaveBeenCalledWith('/admin/sales/settled');
    expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith('admin_read_settled_export', { p_export_id: ID });
    expect(mocks.builder).toHaveBeenCalledWith({ receiptId: ID });
    expect(mocks.audit).toHaveBeenCalledWith('staff', ID, 'a'.repeat(64));
    expect(mocks.builder.mock.invocationCallOrder[0]).toBeLessThan(mocks.encrypt.mock.invocationCallOrder[0]);
    expect(mocks.encrypt.mock.invocationCallOrder[0]).toBeLessThan(mocks.audit.mock.invocationCallOrder[0]);
    expect(response.headers.get('content-type')).toContain('spreadsheetml.sheet');
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(response.headers.get('x-icons-export-receipt')).toBe(ID);
    expect(response.headers.get('x-icons-export-encryption')).toBe('ECMA-376-Agile');
    expect(Buffer.from(await response.arrayBuffer()).toString()).toBe('encrypted-evidence');
  });
  it('기존 GET 링크는 같은 기록의 암호 입력 화면으로만 이동한다', async () => {
    const response = await GET(new Request(`https://example.test/api/admin/settled-workbook?id=${ID}`));
    expect(response.status).toBe(303); expect(response.headers.get('location')).toBe(`/admin/sales/settled?exportReceipt=${ID}`);
    expect(mocks.rpc).not.toHaveBeenCalled(); expect(mocks.builder).not.toHaveBeenCalled();
    expect(await response.text()).toBe('');
  });
  it('다른 운영자의 기록과 변경된 권한은 파일로 만들지 않는다', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message: 'settled_export_not_found' } });
    expect((await POST(request())).status).toBe(400); expect(mocks.builder).not.toHaveBeenCalled();
    mocks.guard.mockRejectedValue(new Error('NEXT_NOT_FOUND'));
    await expect(POST(request())).rejects.toThrow('NEXT_NOT_FOUND');
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
  });
  it('암호화나 감사 실패는 파일을 응답하지 않는다', async () => {
    mocks.encrypt.mockImplementationOnce(() => { throw new Error('crypto'); });
    expect((await POST(request())).status).toBe(500); expect(mocks.audit).not.toHaveBeenCalled();
    mocks.audit.mockRejectedValue(new Error('revoked'));
    const response = await POST(request());
    expect(response.status).toBe(500); expect(response.headers.get('content-type')).toContain('json');
    expect(await response.text()).not.toContain('evidence');
  });
  it('URL 암호와 교차 origin은 자료를 읽기 전에 거부한다', async () => {
    expect((await POST(request('&password=NeverInUrl'))).status).toBe(400);
    const cross = request(); cross.headers.set('origin', 'https://evil.test');
    expect((await POST(cross)).status).toBe(403); expect(mocks.rpc).not.toHaveBeenCalled();
  });
});
