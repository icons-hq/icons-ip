import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ guard: vi.fn(), rpc: vi.fn(), parse: vi.fn(), sheet: vi.fn(), build: vi.fn(), access: vi.fn() }));
vi.mock('@/lib/admin/guard.server', () => ({ requireAdminScreenAccess: mocks.guard }));
vi.mock('@/lib/admin/pii-access-log.server', () => ({ recordPiiAccess: mocks.access }));
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({ rpc: mocks.rpc }) }));
vi.mock('@/lib/admin/review-event-export', async importOriginal => ({ ...await importOriginal<typeof import('@/lib/admin/review-event-export')>(), parseReviewEventExportSnapshot: mocks.parse, reviewEventExportSheet: mocks.sheet }));
vi.mock('@/lib/admin/list-export.server', () => ({ buildAdminListExportWorkbook: mocks.build }));
import { GET } from './route';
const fingerprint = 'a'.repeat(64), auditId = 'bfc03000-0000-4000-8000-000000000401';
const request = (query = 'mode=events&privacyConfirmed=yes&q=hello&state=ready') => new Request(`http://local/api/admin/review-events/export?${query}`);
beforeEach(() => { vi.clearAllMocks(); mocks.guard.mockResolvedValue({ user: { id: 'staff-1' } }); mocks.access.mockResolvedValue('3');mocks.parse.mockReturnValue({ total: 2, fingerprint }); mocks.sheet.mockReturnValue({}); mocks.build.mockResolvedValue(Buffer.from('xlsx')); mocks.rpc.mockImplementation(async name => name === 'admin_export_review_events' ? { data: {}, error: null } : { data: auditId, error: null }); });
describe('review event download boundary', () => {
  it('requires cs screen access and acknowledgement before reading data', async () => {
    expect((await GET(request('mode=events'))).status).toBe(400); expect(mocks.guard).toHaveBeenCalledWith('/admin/cs/review-events'); expect(mocks.rpc).not.toHaveBeenCalled();
    mocks.guard.mockRejectedValue(new Error('denied')); await expect(GET(request())).rejects.toThrow('denied'); expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it('builds then revalidates the same filters and fingerprint before exposing bytes', async () => {
    const response = await GET(request()); expect(response.status).toBe(200); expect(await response.text()).toBe('xlsx'); expect(response.headers.get('cache-control')).toBe('private, no-store'); expect(response.headers.get('x-icons-export-audit')).toBe(auditId);
    const filters = { mode: 'events', query: 'hello', state: 'ready', dateField: 'created', from: null, to: null };
    expect(mocks.rpc).toHaveBeenNthCalledWith(1, 'admin_export_review_events', { p_filters: filters });
    expect(mocks.rpc).toHaveBeenNthCalledWith(2, 'admin_record_review_event_export', { p_filters: filters, p_fingerprint: fingerprint, p_row_count: 2 });
    expect(mocks.build.mock.invocationCallOrder[0]).toBeLessThan(mocks.rpc.mock.invocationCallOrder[1]);
    // 이벤트 목록에는 응모자 정보가 없어 개인정보 접속기록을 남기지 않는다.
    expect(mocks.access).not.toHaveBeenCalled();
  });
  it('응모 목록은 리뷰 ID·건수·감사 번호로 개인정보 접속기록을 남기고, 실패하면 파일을 내보내지 않는다', async () => {
    const eventId = 'bfc03000-0000-4000-8000-000000000402', reviewId = 'bfc03000-0000-4000-8000-000000000403';
    mocks.parse.mockReturnValue({ total: 1, fingerprint, rows: [{ reviewId, nickname: '응모자' }] });
    const response = await GET(request(`mode=entries&privacyConfirmed=yes&eventId=${eventId}&q=응모자`));
    expect(response.status).toBe(200);
    expect(mocks.access).toHaveBeenCalledExactlyOnceWith({ actorId: 'staff-1', action: 'export', surface: 'export.review_events', path: '/api/admin/review-events/export',
      subjectKind: 'review', subjectIds: [reviewId], subjectCount: 1, detail: { eventId, auditId } });
    expect(JSON.stringify(mocks.access.mock.calls)).not.toContain('응모자');
    mocks.access.mockRejectedValueOnce(new Error('pii log down'));
    const failed = await GET(request(`mode=entries&privacyConfirmed=yes&eventId=${eventId}`));
    expect(failed.status).toBe(503); expect(failed.headers.get('content-type')).not.toContain('spreadsheetml');
  });
  it('returns 409 instead of stale file bytes when data changes or crosses the cap during build', async () => {
    for (const message of ['review_event_export_changed', 'review_event_export_limit', 'review_event_not_found']) {
      mocks.rpc.mockImplementation(async name => name === 'admin_export_review_events' ? { data: {}, error: null } : { error: { message } });
      const response = await GET(request()); expect(response.status).toBe(409); expect(response.headers.get('content-type')).not.toContain('spreadsheetml');
    }
  });
  it('never serves partial data or a file without a valid audit receipt', async () => {
    mocks.rpc.mockResolvedValueOnce({ error: { message: 'review_event_export_limit' } }); expect((await GET(request())).status).toBe(422); expect(mocks.build).not.toHaveBeenCalled();
    mocks.parse.mockReturnValueOnce(null); expect((await GET(request())).status).toBe(503);
    mocks.rpc.mockImplementation(async name => name === 'admin_export_review_events' ? { data: {}, error: null } : { error: { message: 'operator_capability_required' } }); expect((await GET(request())).status).toBe(503);
  });
});
