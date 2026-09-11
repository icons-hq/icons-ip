import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ guard: vi.fn(), rpc: vi.fn(), builder: vi.fn() }));
vi.mock('@/lib/admin/guard.server', () => ({ requireAdminScreenAccess: mocks.guard }));
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({ rpc: mocks.rpc }) }));
vi.mock('@/lib/admin/settled-workbook.server', () => ({ buildSettledWorkbook: mocks.builder }));
vi.mock('next/navigation', () => ({ unstable_rethrow: vi.fn() }));
import { GET } from './route';

const ID = '10000000-0000-4000-8000-000000004951';
beforeEach(() => { vi.clearAllMocks(); mocks.guard.mockResolvedValue({ user: { id: 'staff' } }); });
describe('보존된 거래확정 엑셀 다운로드', () => {
  it('권한을 확인한 뒤 영수증만 읽고 현재 주문 조회를 호출하지 않는다', async () => {
    const payload = { receiptId: ID }; mocks.rpc.mockResolvedValue({ data: payload, error: null }); mocks.builder.mockResolvedValue(Buffer.from('xlsx-evidence'));
    const response = await GET(new Request(`https://example.test/api/admin/settled-workbook?id=${ID}`));
    expect(mocks.guard).toHaveBeenCalledWith('/admin/sales/settled');
    expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith('admin_read_settled_export', { p_export_id: ID });
    expect(mocks.builder).toHaveBeenCalledWith(payload);
    expect(response.headers.get('content-type')).toContain('spreadsheetml.sheet');
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(response.headers.get('x-icons-export-receipt')).toBe(ID);
  });
  it('다른 운영자의 영수증은 파일로 만들지 않는다', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message: 'settled_export_not_found' } });
    const response = await GET(new Request(`https://example.test/api/admin/settled-workbook?id=${ID}`));
    expect(response.status).toBe(400); expect(mocks.builder).not.toHaveBeenCalled();
  });
  it('인증 거절은 RPC를 실행하지 않는다', async () => {
    mocks.guard.mockRejectedValue(new Error('NEXT_NOT_FOUND'));
    await expect(GET(new Request(`https://example.test/api/admin/settled-workbook?id=${ID}`))).rejects.toThrow('NEXT_NOT_FOUND');
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
});
