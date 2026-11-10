import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ user: vi.fn(), claims: vi.fn(), rpc: vi.fn(), service: vi.fn(), createService: vi.fn() }));
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({ auth: { getUser: mocks.user, getClaims: mocks.claims }, rpc: mocks.rpc }) }));
vi.mock('@/lib/supabase/service', () => ({ createServiceClient: mocks.createService }));
import { prepareReviewExport } from './review-export.server';
import { reviewExportId as id, reviewExportFilterFixture, reviewExportSnapshotFixture } from '@/test/fixtures/review-export';
const actor = id(10), session = id(20), sha = 'b'.repeat(64);
beforeEach(() => {
  vi.clearAllMocks();
  mocks.user.mockResolvedValue({ data: { user: { id: actor } }, error: null });
  mocks.claims.mockResolvedValue({ data: { claims: { sub: actor, session_id: session } }, error: null });
  mocks.rpc.mockResolvedValue({ data: reviewExportSnapshotFixture(), error: null });
  mocks.createService.mockReturnValue({ rpc: mocks.service }); mocks.service.mockResolvedValue({ data: id(30), error: null });
});
describe('일반 리뷰 snapshot과 최종 파일 감사', () => {
  it('actor를 입력받지 않는 caller RPC 한 번 후에만 별도 service 감사를 한다', async () => {
    const filters = reviewExportFilterFixture(), prepared = await prepareReviewExport(actor, filters);
    expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith('admin_export_reviews_v2', { p_filters: filters }); expect(mocks.createService).not.toHaveBeenCalled();
    expect(await prepared.recordEncryptedFile(sha)).toBe(id(30));
    expect(mocks.user).toHaveBeenCalledTimes(2); expect(mocks.claims).toHaveBeenCalledTimes(2);
    expect(mocks.service).toHaveBeenCalledExactlyOnceWith('service_record_review_export_v2', { p_actor_id: actor, p_session_id: session, p_filters: filters,
      p_fingerprint: 'a'.repeat(64), p_row_count: 1, p_captured_at: prepared.snapshot.capturedAt, p_file_sha256: sha });
  });
  it.each(['user', 'claims', 'session'])('%s 불일치는 caller 데이터 조회 전 거절한다', async kind => {
    if (kind === 'user') mocks.user.mockResolvedValue({ data: { user: { id: id(99) } }, error: null });
    else mocks.claims.mockResolvedValue({ data: { claims: { sub: kind === 'claims' ? id(99) : actor, session_id: kind === 'session' ? 'bad' : session } }, error: null });
    await expect(prepareReviewExport(actor, reviewExportFilterFixture())).rejects.toMatchObject({ status: 403 });
    expect(mocks.rpc).not.toHaveBeenCalled(); expect(mocks.createService).not.toHaveBeenCalled();
  });
  it('파일 생성 중 세션이 바뀌면 service RPC를 시작하지 않는다', async () => {
    const prepared = await prepareReviewExport(actor, reviewExportFilterFixture());
    mocks.claims.mockResolvedValue({ data: { claims: { sub: actor, session_id: id(21) } }, error: null });
    await expect(prepared.recordEncryptedFile(sha)).rejects.toMatchObject({ status: 403 }); expect(mocks.createService).not.toHaveBeenCalled();
  });
  it.each([['54000', 422], ['42501', 403], ['22023', 400], ['XX000', 503]] as const)('snapshot %s 오류를 안전한 %s 응답으로 매핑한다', async (code, status) => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code, message: 'PRIVATE DATABASE DETAIL' } });
    await expect(prepareReviewExport(actor, reviewExportFilterFixture())).rejects.toMatchObject({ status }); expect(mocks.createService).not.toHaveBeenCalled();
  });
  it('잘못된 도움수를 포함한 DTO는 파일 준비 전에 거절한다', async () => {
    const snapshot = reviewExportSnapshotFixture(); mocks.rpc.mockResolvedValue({ data: { ...snapshot, rows: [{ ...snapshot.rows[0], helpfulCount: '7' }] }, error: null });
    await expect(prepareReviewExport(actor, snapshot.filters)).rejects.toMatchObject({ status: 503 }); expect(mocks.createService).not.toHaveBeenCalled();
  });
  it.each([['PT409', 409], ['54000', 409], ['42501', 403], ['XX000', 503]] as const)('최종 감사 %s 실패는 발급을 거절한다', async (code, status) => {
    const prepared = await prepareReviewExport(actor, reviewExportFilterFixture()); mocks.service.mockResolvedValue({ data: null, error: { code, message: 'PRIVATE DETAIL' } });
    await expect(prepared.recordEncryptedFile(sha)).rejects.toMatchObject({ status });
  });
});
