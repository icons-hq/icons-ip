import { legacyOperatorAccessFixture } from '@/lib/admin/access.test-fixtures';
import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ auth: vi.fn(), rpc: vi.fn() }));
vi.mock('@/lib/auth/admin', () => ({ getCurrentAdminAuthState: mocks.auth }));
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({ rpc: mocks.rpc }) }));
import { createSettledExportAction } from './settled-export-actions';

function form() { const data = new FormData(); data.set('requestId', '00000000-0000-4000-8000-000000004951'); data.set('from', '2026-09-01'); data.set('to', '2026-09-10'); data.set('query', '0000'); return data; }
beforeEach(() => { vi.clearAllMocks(); mocks.auth.mockResolvedValue({ operatorAccess: legacyOperatorAccessFixture(), isConfigured: true, user: { id: 'staff' }, isStaff: true, role: 'staff' }); });
describe('거래확정 엑셀 생성 동선', () => {
  it('고객 역할은 DB를 읽기 전에 거절한다', async () => {
    mocks.auth.mockResolvedValue({ operatorAccess: legacyOperatorAccessFixture(), isConfigured: true, user: { id: 'fan' }, isStaff: false, role: 'user' });
    expect(await createSettledExportAction({}, form())).toMatchObject({ error: '운영자 권한이 필요합니다.' });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it('잘못된 기간을 넓은 조회로 치환하지 않는다', async () => {
    const input = form(); input.set('to', '2026-02-30');
    expect((await createSettledExportAction({}, input)).error).toBeTruthy(); expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it('생성 성공 후 서버의 고정 영수증을 반환한다', async () => {
    const receipt = { id: '10000000-0000-4000-8000-000000004951', capturedAt: '2026-09-10T02:00:00Z', orderCount: 3 };
    mocks.rpc.mockResolvedValue({ data: receipt, error: null });
    expect(await createSettledExportAction({}, form())).toMatchObject({ receipt, requestId: expect.any(String) });
    expect(mocks.rpc).toHaveBeenCalledWith('admin_create_settled_export', { p_request_id: '00000000-0000-4000-8000-000000004951', p_filters: { from: '2026-09-01', to: '2026-09-10', query: '0000' } });
  });
  it('선택한 검색 대상과 응답 유실 재시도의 요청 번호를 DB에 그대로 보낸다', async () => {
    const input = form(); input.set('field', 'recipient');
    const receipt = { id: '10000000-0000-4000-8000-000000004951', capturedAt: '2026-09-10T02:00:00Z', orderCount: 1 };
    mocks.rpc.mockRejectedValueOnce(new Error('response lost')).mockResolvedValueOnce({ data: receipt, error: null });
    expect(await createSettledExportAction({}, input)).toMatchObject({ error: expect.any(String) });
    expect(await createSettledExportAction({}, input)).toMatchObject({ receipt });
    expect(mocks.rpc.mock.calls[0]).toEqual(mocks.rpc.mock.calls[1]);
    expect(mocks.rpc.mock.calls[1][1]).toMatchObject({ p_filters: { field: 'recipient' } });
  });
  it('중복 또는 미지원 검색 대상은 RPC를 호출하기 전에 거절한다', async () => {
    const duplicate = form(); duplicate.append('field', 'recipient'); duplicate.append('field', 'all');
    expect((await createSettledExportAction({}, duplicate)).error).toBeTruthy();
    const unknown = form(); unknown.set('field', 'all;drop');
    expect((await createSettledExportAction({}, unknown)).error).toBeTruthy();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it('상한 초과를 잘린 성공 파일로 처리하지 않는다', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message: 'settled_export_limit' } });
    const result = await createSettledExportAction({}, form());
    expect(result.error).toContain('조회 기간을 줄여주세요'); expect(result.receipt).toBeUndefined();
  });
});
