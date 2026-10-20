import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ rpc: vi.fn(), service: vi.fn() }));
vi.mock('@/lib/supabase/service', () => ({ createServiceClient: mocks.service }));
import { recordEncryptedListExport, recordEncryptedSettledExport } from './encrypted-export-audit.server';
import type { AdminListExportSheet } from './list-export';
beforeEach(() => { vi.clearAllMocks(); mocks.service.mockReturnValue({ rpc: mocks.rpc }); mocks.rpc.mockResolvedValue({ data: 'audit-id', error: null }); });
describe('서버 전용 암호화 파일 발급 감사', () => {
  it('검증된 운영자와 실제 파일 해시만 service RPC로 전달한다', async () => {
    const sheet: AdminListExportSheet = { title: '주문', columns: [], conditions: [], notes: [], screen: 'orders', filters: { query: '홍' }, rows: [[1], [2]], recordCount: 1 };
    await recordEncryptedListExport('actor-id', sheet, 'a'.repeat(64));
    expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith('service_record_encrypted_list_export', {
      p_actor_id: 'actor-id', p_screen: 'orders', p_filters: { query: '홍' }, p_row_count: 2, p_record_count: 1, p_file_sha256: 'a'.repeat(64),
    });
    await recordEncryptedSettledExport('actor-id', 'receipt-id', 'b'.repeat(64));
    expect(mocks.rpc).toHaveBeenLastCalledWith('service_record_encrypted_settled_export', { p_actor_id: 'actor-id', p_export_id: 'receipt-id', p_file_sha256: 'b'.repeat(64) });
  });
  it('현재 권한 거절이나 감사 실패를 파일 응답 전에 실패시킨다', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message: 'operator_capability_required' } });
    await expect(recordEncryptedSettledExport('actor-id', 'receipt-id', 'a'.repeat(64))).rejects.toThrow('다운로드 기록');
  });
});
