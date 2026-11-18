import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ headers: vi.fn(), after: vi.fn(), service: vi.fn(), createService: vi.fn(), rpc: vi.fn() }));
vi.mock('next/headers', () => ({ headers: mocks.headers }));
vi.mock('next/server', () => ({ after: mocks.after }));
vi.mock('@/lib/supabase/service', () => ({ createServiceClient: mocks.createService }));
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({ rpc: mocks.rpc }) }));
import { loadPiiAccessLog, loadPiiAccessLogExport, notePiiAccess, piiAccessClientIp, PiiAccessLogError, PiiAccessLogExportLimitError, recordPiiAccess } from './pii-access-log.server';
import { normalizePiiAccessLogFilters } from './pii-access-log';

const ACTOR = 'a9000000-0000-4000-8000-000000000002';
const MEMBER = 'a9000000-0000-4000-8000-000000000001';
const ORDER = 'a9000000-0000-4000-8000-000000000101';
const requestHeaders = (values: Record<string, string>) => new Headers(values);

beforeEach(() => {
  vi.clearAllMocks();
  mocks.headers.mockResolvedValue(requestHeaders({ 'x-real-ip': '203.0.113.10', 'x-forwarded-for': '198.51.100.1, 10.0.0.1' }));
  mocks.service.mockResolvedValue({ data: 41, error: null });
  mocks.createService.mockReturnValue({ rpc: mocks.service });
  mocks.after.mockImplementation((task: () => Promise<void>) => { void task(); });
});
afterEach(() => { vi.restoreAllMocks(); });

describe('접속지(IP)', () => {
  it('Vercel이 덮어쓰는 x-real-ip를 먼저, 없으면 x-forwarded-for의 첫 값을 읽고 IP 형식이 아니면 비운다', () => {
    expect(piiAccessClientIp(requestHeaders({ 'x-real-ip': '203.0.113.10', 'x-forwarded-for': '198.51.100.1' }))).toBe('203.0.113.10');
    expect(piiAccessClientIp(requestHeaders({ 'x-forwarded-for': ' 2001:db8::1 , 10.0.0.1' }))).toBe('2001:db8::1');
    expect(piiAccessClientIp(requestHeaders({ 'x-real-ip': 'not-an-ip' }))).toBeNull();
    expect(piiAccessClientIp(requestHeaders({}))).toBeNull();
  });
});

describe('기록 남기기', () => {
  it('서비스 키로 기록 RPC를 부르고, 경로의 쿼리·잘못된 ID·중복을 거른다', async () => {
    expect(await recordPiiAccess({ actorId: ACTOR, action: 'search', surface: 'order.search', path: '/admin/sales/orders?query=01012345678',
      subjectKind: 'order', subjectIds: [ORDER, ORDER.toUpperCase(), 'not-a-uuid', null], subjectCount: 7, detail: { field: 'phone', page: 1, skipped: undefined } })).toBe('41');
    expect(mocks.service).toHaveBeenCalledExactlyOnceWith('service_record_operator_pii_access', {
      p_actor_id: ACTOR, p_action: 'search', p_surface: 'order.search', p_path: '/admin/sales/orders', p_client_ip: '203.0.113.10',
      p_subject_kind: 'order', p_subject_ids: [ORDER], p_subject_count: 7, p_detail: { field: 'phone', page: 1 },
    });
    expect(JSON.stringify(mocks.service.mock.calls)).not.toContain('01012345678');
  });
  it('대상 없음은 ID와 건수를 0으로 보내고, 대상 수는 ID 수보다 작아지지 않는다', async () => {
    await recordPiiAccess({ actorId: ACTOR, action: 'view', surface: 'access_log', path: '/admin/settings/access-log', subjectKind: 'none', subjectIds: [MEMBER], subjectCount: 3 });
    expect(mocks.service.mock.calls[0][1]).toMatchObject({ p_subject_kind: 'none', p_subject_ids: [], p_subject_count: 0 });
    await recordPiiAccess({ actorId: ACTOR, action: 'view', surface: 'customer.detail', path: '/admin/customers/x', subjectKind: 'member', subjectIds: [MEMBER], subjectCount: 0 });
    expect(mocks.service.mock.calls[1][1]).toMatchObject({ p_subject_ids: [MEMBER], p_subject_count: 1 });
  });
  it('기록 실패·요청 밖 호출은 PiiAccessLogError로 바꿔 호출자가 응답하지 않게 한다', async () => {
    mocks.service.mockResolvedValueOnce({ data: null, error: { code: 'XX000', message: 'raw detail' } });
    await expect(recordPiiAccess({ actorId: ACTOR, action: 'export', surface: 'export.list', path: '/api/admin/list-export', subjectKind: 'order', subjectCount: 2 })).rejects.toBeInstanceOf(PiiAccessLogError);
    mocks.headers.mockRejectedValueOnce(new Error('outside request'));
    await expect(recordPiiAccess({ actorId: ACTOR, action: 'export', surface: 'export.list', path: '/api/admin/list-export', subjectKind: 'order', subjectCount: 2 })).rejects.toBeInstanceOf(PiiAccessLogError);
    mocks.createService.mockImplementationOnce(() => { throw new Error('Missing SUPABASE_SERVICE_ROLE_KEY'); });
    await expect(recordPiiAccess({ actorId: ACTOR, action: 'reveal', surface: 'refund_account', path: '/api/admin/bank-transfer-refund-account', subjectKind: 'claim', subjectIds: [ORDER] }))
      .rejects.toThrow('개인정보 접속기록을 남기지 못해');
  });
  it('화면 열람 기록은 접속지를 먼저 읽고 응답 뒤(after)에 남기며, 실패해도 던지지 않고 개인정보 없이 로그만 남긴다', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    mocks.service.mockResolvedValueOnce({ data: null, error: { message: 'down' } });
    await expect(notePiiAccess({ actorId: ACTOR, action: 'view', surface: 'customer.detail', path: `/admin/customers/${MEMBER}`, subjectKind: 'member', subjectIds: [MEMBER] })).resolves.toBeUndefined();
    await vi.waitFor(() => expect(error).toHaveBeenCalledTimes(1));
    expect(mocks.after).toHaveBeenCalledTimes(1);
    expect(mocks.headers.mock.invocationCallOrder[0]).toBeLessThan(mocks.after.mock.invocationCallOrder[0]);
    expect(JSON.stringify(error.mock.calls)).not.toContain(MEMBER);
    expect(error.mock.calls[0][1]).toEqual({ surface: 'customer.detail', action: 'view' });
  });
  it('after를 쓸 수 없는 곳에서는 바로 남기고, 요청 헤더가 없어도 접속지 없이 남긴다', async () => {
    mocks.after.mockImplementationOnce(() => { throw new Error('outside request scope'); });
    mocks.headers.mockRejectedValueOnce(new Error('outside request'));
    await notePiiAccess({ actorId: ACTOR, action: 'view', surface: 'order.detail', path: `/admin/sales/orders/${ORDER}`, subjectKind: 'order', subjectIds: [ORDER] });
    expect(mocks.service).toHaveBeenCalledExactlyOnceWith('service_record_operator_pii_access', expect.objectContaining({ p_client_ip: null, p_subject_ids: [ORDER] }));
  });
});

describe('점검 읽기', () => {
  const filters = normalizePiiAccessLogFilters({ from: '2026-11-01', to: '2026-11-10', flag: 'any' }, new Date('2026-11-18T03:00:00Z'));
  it('사용자 세션으로 점검 RPC를 부르고 계약과 다른 응답은 오류로 끝낸다', async () => {
    mocks.rpc.mockResolvedValueOnce({ data: { from: '2026-11-01', to: '2026-11-10', page: 1, pageSize: 50, total: 0, summary: { total: 0, offHours: 0, bulk: 0, burst: 0, flagged: 0 }, items: [], actors: [] }, error: null });
    expect(await loadPiiAccessLog(filters)).toMatchObject({ total: 0, items: [] });
    expect(mocks.rpc).toHaveBeenCalledWith('admin_pii_access_log', { p_from: '2026-11-01', p_to: '2026-11-10', p_actor: null, p_action: null, p_surface: null, p_subject: null, p_flag: 'any', p_page: 1 });
    mocks.rpc.mockResolvedValueOnce({ data: { from: '2026-11-02', to: '2026-11-10' }, error: null });
    await expect(loadPiiAccessLog(filters)).rejects.toThrow('개인정보 접속기록을 불러오지 못했습니다');
  });
  it('내려받기 한도 초과는 전용 오류로 알린다', async () => {
    mocks.rpc.mockResolvedValueOnce({ data: null, error: { code: '54000', message: 'pii_access_log_export_limit' } });
    await expect(loadPiiAccessLogExport(filters)).rejects.toBeInstanceOf(PiiAccessLogExportLimitError);
    expect(mocks.rpc).toHaveBeenCalledWith('admin_export_pii_access_log', expect.not.objectContaining({ p_page: expect.anything() }));
  });
});
