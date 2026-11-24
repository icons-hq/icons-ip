import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ guard: vi.fn(), load: vi.fn(), record: vi.fn(), build: vi.fn(), encrypt: vi.fn() }));
vi.mock('@/lib/admin/guard.server', () => ({ requireAdminScreenAccess: mocks.guard }));
vi.mock('@/lib/admin/list-export.server', () => ({ buildAdminListExportWorkbook: mocks.build }));
vi.mock('@/lib/admin/encrypted-workbook.server', () => ({ encryptAdminWorkbook: mocks.encrypt }));
vi.mock('@/lib/admin/pii-access-log.server', () => {
  class PiiAccessLogError extends Error { constructor() { super('개인정보 접속기록을 남기지 못해 요청을 처리하지 않았습니다. 잠시 후 다시 시도해주세요.'); } }
  class PiiAccessLogExportLimitError extends Error { constructor() { super('한 번에 내려받을 수 있는 기록은 10,000건입니다. 기간이나 조건을 좁혀주세요.'); } }
  return { PiiAccessLogError, PiiAccessLogExportLimitError, loadPiiAccessLogExport: mocks.load, recordPiiAccess: mocks.record };
});
vi.mock('next/navigation', () => ({ unstable_rethrow: vi.fn() }));
import { GET, POST, maxDuration, runtime } from './route';
import { PiiAccessLogError, PiiAccessLogExportLimitError } from '@/lib/admin/pii-access-log.server';

const ACTOR = 'a9000000-0000-4000-8000-000000000002';
const row = { id: '12', at: '2026-11-05T01:00:00Z', actorId: ACTOR, actorName: '점검 합성', actorAccess: 'owner', ip: '203.0.113.9', action: 'view', surface: 'order.detail',
  path: '/admin/sales/orders/x', subjectKind: 'order', subjectIds: [], subjectCount: 1, memberIds: [], memberCount: 0, detail: {}, flags: [] };
let plain: Buffer;
beforeEach(() => {
  vi.clearAllMocks(); mocks.guard.mockResolvedValue({ user: { id: 'inspector' } });
  mocks.load.mockResolvedValue({ from: '2026-11-01', to: '2026-11-10', total: 1, capturedAt: '2026-11-18T01:00:00Z', rows: [row] });
  plain = Buffer.from('plaintext-workbook'); mocks.build.mockResolvedValue(plain);
  mocks.encrypt.mockReturnValue({ bytes: Buffer.from('encrypted-workbook'), sha256: 'c'.repeat(64) });
  mocks.record.mockResolvedValue('77');
});
const request = (query = `from=2026-11-01&to=2026-11-10&actor=${ACTOR}&flag=any`, origin = 'https://example.test') => new Request(`https://example.test/api/admin/pii-access-log/export?${query}`, {
  method: 'POST', headers: { origin, 'content-type': 'application/json' }, body: JSON.stringify({ password: 'StrongTEST123!', passwordConfirmation: 'StrongTEST123!' }) });

describe('개인정보 접속기록 엑셀', () => {
  it('GET·다른 출처·URL 비밀번호·잘못된 조건은 읽기 전에 거절한다', async () => {
    expect((await GET()).status).toBe(405);
    expect((await POST(request(undefined, 'https://evil.test'))).status).toBe(403);
    expect((await POST(request('from=2026-11-01&to=2026-11-10&password=x'))).status).toBe(400);
    expect((await POST(request('from=2026-11-01&to=2026-11-10&flag=weird'))).status).toBe(400);
    expect(mocks.load).not.toHaveBeenCalled(); expect(mocks.record).not.toHaveBeenCalled();
  });
  it('점검 권한으로 같은 조건 전체를 암호화하고, 내려받은 기록이 남아야 응답한다', async () => {
    const response = await POST(request());
    expect(runtime).toBe('nodejs'); expect(maxDuration).toBe(60);
    expect(mocks.guard).toHaveBeenCalledWith('/admin/settings/access-log');
    expect(mocks.load).toHaveBeenCalledWith(expect.objectContaining({ from: '2026-11-01', to: '2026-11-10', actor: ACTOR, flag: 'any' }));
    expect(mocks.build.mock.calls[0][0]).toMatchObject({ screenLabel: '개인정보 접속기록', recordCount: 1 });
    expect(mocks.build.mock.calls[0][0].conditions).toContainEqual(['운영자', '점검 합성']);
    expect(mocks.record).toHaveBeenCalledExactlyOnceWith({ actorId: 'inspector', action: 'export', surface: 'access_log', path: '/api/admin/pii-access-log/export', subjectKind: 'none',
      detail: { from: '2026-11-01', to: '2026-11-10', records: 1, actorFiltered: true, subjectFiltered: false, action: null, surface: null, flag: 'any' } });
    expect(mocks.encrypt.mock.invocationCallOrder[0]).toBeLessThan(mocks.record.mock.invocationCallOrder[0]);
    expect(response.status).toBe(200); expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(response.headers.get('x-icons-export-audit')).toBe('77'); expect(response.headers.get('x-icons-export-encryption')).toBe('ECMA-376-Agile');
    expect(decodeURIComponent(response.headers.get('content-disposition')!)).toMatch(/xsquare-개인정보접속기록-\d{8}-\d{4}\.xlsx/);
    expect(Buffer.from(await response.arrayBuffer()).toString()).toBe('encrypted-workbook'); expect(plain.every(byte => byte === 0)).toBe(true);
  });
  it('기록 실패·한도 초과는 파일 없이 오류로 끝낸다', async () => {
    mocks.record.mockRejectedValueOnce(new PiiAccessLogError());
    const failed = await POST(request()); expect(failed.status).toBe(500); expect((await failed.json()).error).toContain('개인정보 접속기록을 남기지 못해');
    mocks.load.mockRejectedValueOnce(new PiiAccessLogExportLimitError());
    const limited = await POST(request()); expect(limited.status).toBe(400); expect((await limited.json()).error).toContain('10,000건');
  });
});
