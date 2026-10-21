import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ guard: vi.fn(), prepare: vi.fn(), record: vi.fn(), build: vi.fn(), encrypt: vi.fn() }));
vi.mock('@/lib/admin/guard.server', () => ({ requireAdminScreenAccess: mocks.guard }));
vi.mock('@/lib/admin/list-export.server', () => ({ buildAdminListExportWorkbook: mocks.build }));
vi.mock('@/lib/admin/encrypted-workbook.server', () => ({ encryptAdminWorkbook: mocks.encrypt }));
vi.mock('@/lib/admin/review-export.server', () => ({ prepareReviewExport: mocks.prepare,
  ReviewExportError: class extends Error { constructor(message: string, readonly status: number) { super(message); } },
}));
import { DELETE, GET, HEAD, OPTIONS, PATCH, POST, PUT, maxDuration, runtime } from './route';
import { ReviewExportError } from '@/lib/admin/review-export.server';
import { reviewExportId as id, reviewExportSnapshotFixture } from '@/test/fixtures/review-export';
const password = 'SyntheticQA-26!', actor = id(10);
let plain: Buffer;
beforeEach(() => {
  vi.clearAllMocks(); mocks.guard.mockResolvedValue({ user: { id: actor } });
  mocks.prepare.mockResolvedValue({ snapshot: reviewExportSnapshotFixture(), recordEncryptedFile: mocks.record });
  plain = Buffer.from('private-plaintext-workbook'); mocks.build.mockResolvedValue(plain);
  mocks.encrypt.mockReturnValue({ bytes: Buffer.from('encrypted-workbook'), sha256: 'b'.repeat(64) }); mocks.record.mockResolvedValue(id(30));
});
function request(query = '') {
  return new Request(`https://example.test/api/admin/reviews/export?${query}`, { method: 'POST',
    headers: { origin: 'https://example.test', 'content-type': 'application/json' }, body: JSON.stringify({ password, passwordConfirmation: password }) });
}
function privateResponse(response: Response) {
  expect(response.headers.get('cache-control')).toBe('private, no-store'); expect(response.headers.get('x-content-type-options')).toBe('nosniff');
}
describe('일반 리뷰 암호화 POST export', () => {
  it('GET/HEAD/OPTIONS 등 허용되지 않은 메서드는 DB나 파일 생성 없이 405다', async () => {
    for (const method of [GET, HEAD, PUT, PATCH, DELETE, OPTIONS]) {
      const response = method(); expect(response.status).toBe(405); expect(response.headers.get('allow')).toBe('POST'); privateResponse(response);
    }
    expect(mocks.guard).not.toHaveBeenCalled(); expect(mocks.prepare).not.toHaveBeenCalled(); expect(mocks.build).not.toHaveBeenCalled();
  });
  it('권한 거절은 private JSON이며 데이터 읽기를 시작하지 않는다', async () => {
    mocks.guard.mockRejectedValue(new Error('NEXT_NOT_FOUND'));
    const response = await POST(request()); expect(response.status).toBe(403); privateResponse(response); expect(mocks.prepare).not.toHaveBeenCalled();
  });
  it.each(['page=3', 'query=a&query=b', 'from=2026-02-30', 'from=2026-10-15&to=2026-10-01', 'sort=invalid', 'password=NeverInURL'])('잘못된 URL %s은 400이며 전체 조회하지 않는다', async query => {
    const response = await POST(request(query)); expect(response.status).toBe(400); privateResponse(response); expect(mocks.prepare).not.toHaveBeenCalled();
  });
  it('누락 Origin·교차 origin·잘못된 Host·과대 본문·암호 불일치를 거절한다', async () => {
    const absent = request(); absent.headers.delete('origin'); expect((await POST(absent)).status).toBe(403);
    const cross = request(); cross.headers.set('origin', 'https://other.test'); expect((await POST(cross)).status).toBe(403);
    const badHost = request(); badHost.headers.set('host', 'example.test@other.test'); expect((await POST(badHost)).status).toBe(403);
    const wrong = new Request('https://example.test/api/admin/reviews/export', { method: 'POST', headers: { origin: 'https://example.test', 'content-type': 'application/json' }, body: JSON.stringify({ password, passwordConfirmation: `${password}wrong` }) });
    expect((await POST(wrong)).status).toBe(400);
    const large = new Request('https://example.test/api/admin/reviews/export', { method: 'POST', headers: { origin: 'https://example.test', 'content-type': 'application/json' }, body: 'x'.repeat(4097) });
    expect((await POST(large)).status).toBe(413); expect(mocks.prepare).not.toHaveBeenCalled(); expect(mocks.build).not.toHaveBeenCalled();
  });
  it('snapshot→18열 생성→암호화→최종 감사 완료 뒤에만 파일을 내보낸다', async () => {
    const response = await POST(request('sort=helpful_desc&photo=with&reviewId=' + id(1)));
    expect(runtime).toBe('nodejs'); expect(maxDuration).toBe(60);
    expect(mocks.guard).toHaveBeenCalledExactlyOnceWith('/admin/cs/reviews', { capability: 'cs.manage' });
    expect(mocks.prepare).toHaveBeenCalledWith(actor, expect.objectContaining({ sort: 'helpful_desc', photo: 'with', reviewId: id(1) }));
    expect(mocks.build.mock.calls[0][0].columns).toHaveLength(18);
    expect(mocks.prepare.mock.invocationCallOrder[0]).toBeLessThan(mocks.build.mock.invocationCallOrder[0]);
    expect(mocks.build.mock.invocationCallOrder[0]).toBeLessThan(mocks.encrypt.mock.invocationCallOrder[0]);
    expect(mocks.encrypt.mock.invocationCallOrder[0]).toBeLessThan(mocks.record.mock.invocationCallOrder[0]);
    expect(mocks.record).toHaveBeenCalledExactlyOnceWith('b'.repeat(64)); expect(plain.every(byte => byte === 0)).toBe(true);
    expect(response.status).toBe(200); privateResponse(response);
    expect(response.headers.get('x-icons-export-audit')).toBe(id(30)); expect(response.headers.get('x-icons-export-rows')).toBe('1');
    expect(response.headers.get('x-icons-export-records')).toBe('1'); expect(response.headers.get('x-icons-export-encryption')).toBe('ECMA-376-Agile');
    expect(response.headers.get('content-disposition')).toContain('icons-reviews-'); expect(response.headers.get('content-disposition')).toContain(encodeURIComponent('리뷰'));
    expect(Buffer.from(await response.arrayBuffer()).toString()).toBe('encrypted-workbook');
  });
  it.each([403, 409, 503])('최종 감사 %s 실패는 암호문·평문을 응답하지 않는다', async status => {
    mocks.record.mockRejectedValue(new ReviewExportError('발급을 확인하지 못했습니다.', status));
    const response = await POST(request()); expect(response.status).toBe(status); privateResponse(response);
    expect(response.headers.get('content-type')).toContain('application/json'); expect(await response.text()).not.toContain('workbook');
    expect(plain.every(byte => byte === 0)).toBe(true);
  });
  it('암호화 오류의 내부 메시지와 암호를 숨기고 평문을 비운다', async () => {
    mocks.encrypt.mockImplementation(() => { throw new Error(`crypto failure ${password}`); });
    const response = await POST(request()); expect(response.status).toBe(503); privateResponse(response);
    expect(await response.text()).not.toContain(password); expect(mocks.record).not.toHaveBeenCalled(); expect(plain.every(byte => byte === 0)).toBe(true);
  });
  it('10,001건 상한은 파일 생성 전 422이고, 0건은 정상 파일이다', async () => {
    mocks.prepare.mockRejectedValueOnce(new ReviewExportError('최대 10,000건입니다.', 422));
    const over = await POST(request()); expect(over.status).toBe(422); privateResponse(over); expect(mocks.build).not.toHaveBeenCalled();
    mocks.prepare.mockResolvedValueOnce({ snapshot: reviewExportSnapshotFixture({ total: 0, rows: [] }), recordEncryptedFile: mocks.record });
    const zero = await POST(request()); expect(zero.status).toBe(200); expect(zero.headers.get('x-icons-export-rows')).toBe('0');
  });
});
