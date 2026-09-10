import { beforeEach, describe, expect, it, vi } from 'vitest';
import { emptyGoodsKcModel } from '@/lib/admin/goods-kc';
const mocks = vi.hoisted(() => ({ auth: vi.fn(), rpc: vi.fn(), revalidate: vi.fn() }));
vi.mock('@/lib/auth/admin', () => ({ getCurrentAdminAuthState: mocks.auth }));
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({ rpc: mocks.rpc }) }));
vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidate }));
vi.mock('next/navigation', () => ({ unstable_rethrow: vi.fn() }));
import { readGoodsKcAction, saveGoodsKcAction } from './goods-kc-actions';

const contextFingerprint = 'a'.repeat(64);
const configuration = { revision: 1, status: 'unreviewed', models: [emptyGoodsKcModel()], contextFingerprint,
  publishedAt: null, archivedAt: null, reviewedAt: null, reviewerName: null, variants: [], history: [] };
const input = { models: [emptyGoodsKcModel()], status: 'unreviewed', expectedRevision: null,
  expectedContextFingerprint: contextFingerprint, attested: false };
beforeEach(() => {
  vi.resetAllMocks();
  mocks.auth.mockResolvedValue({ isConfigured: true, user: { id: 'staff' }, isStaff: true });
});
describe('KC 조회·저장 서버 경계', () => {
  it('일반 회원과 미인증은 내부 검토를 조회하거나 저장하지 못한다', async () => {
    mocks.auth.mockResolvedValue({ isConfigured: true, user: { id: 'buyer' }, isStaff: false });
    expect(await readGoodsKcAction('g1')).toMatchObject({ ok: false });
    expect(await saveGoodsKcAction('g1', input)).toMatchObject({ ok: false });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it('공란 초안은 저장하지만 증빙 없는 완료와 클라이언트 검토자 지정은 거절한다', async () => {
    mocks.rpc.mockResolvedValue({ data: { changed: true, configuration }, error: null });
    expect(await saveGoodsKcAction('g1', input)).toMatchObject({ ok: true, configuration });
    expect(mocks.rpc).toHaveBeenCalledWith('admin_save_goods_kc', {
      p_good_id: 'g1', p_models: input.models, p_status: 'unreviewed', p_expected_revision: null,
      p_expected_context_fingerprint: contextFingerprint, p_attested: false,
    });
    mocks.rpc.mockClear();
    expect(await saveGoodsKcAction('g1', { ...input, status: 'reviewed', attested: true })).toMatchObject({ ok: false });
    expect(await saveGoodsKcAction('g1', { ...input, reviewerId: 'someone' })).toMatchObject({ ok: false });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it('stale 응답은 변경 충돌로 설명하고 성공/재검토를 꾸미지 않는다', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code: 'PT409', message: 'goods_kc_review_changed' } });
    expect(await saveGoodsKcAction('g1', input)).toMatchObject({ ok: false, error: expect.stringContaining('변경') });
    expect(mocks.revalidate).not.toHaveBeenCalled();
  });
  it('공개 중 정보 변경은 먼저 비공개로 전환하도록 설명한다', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message: 'goods_kc_published_edit_requires_draft' } });
    expect(await saveGoodsKcAction('g1', input)).toMatchObject({ ok: false, error: expect.stringContaining('먼저 비공개') });
  });
  it('모호한 성공 응답으로 입력이 사라지지 않게 성공을 반환하지 않는다', async () => {
    mocks.rpc.mockResolvedValue({ data: { changed: true }, error: null });
    expect(await saveGoodsKcAction('g1', input)).toMatchObject({ ok: false, error: expect.stringContaining('결과를 확인하지 못했습니다') });
    expect(mocks.revalidate).not.toHaveBeenCalled();
  });
});
