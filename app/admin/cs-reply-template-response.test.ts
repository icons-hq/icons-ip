const { legacyOperatorAccessFixture } = await vi.hoisted(() => import('@/lib/admin/access.test-fixtures'));
import { beforeEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ auth: { isConfigured: true, isStaff: true, operatorAccess: legacyOperatorAccessFixture(), user: { id: 'staff' } }, rpc: vi.fn(), from: vi.fn(), single: vi.fn(), select: vi.fn(), eq: vi.fn() }));
vi.mock('@/lib/auth/admin', () => ({ getCurrentAdminAuthState: () => mocks.auth }));
vi.mock('@/lib/supabase/server', () => ({ createClient: () => ({ rpc: mocks.rpc, from: mocks.from }) }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
import { readCsReplyTemplateAction, saveCsReplyTemplateAction } from './cs-reply-actions';
const id = '11111111-1111-4111-8111-111111111111';
const request = { id, surface: 'review', category: 'other', title: ' 저장 문구 ', body: ' 답변 내용 ', revision: 1 };
const saved = { id, surface: 'review', category: 'other', title: '저장 문구', body: '답변 내용', revision: 2, archived_at: null, updated_at: '2026-10-13T00:00:00Z' };
beforeEach(() => {
  vi.clearAllMocks(); mocks.auth.isStaff = true;
  const query = { select: mocks.select, eq: mocks.eq, maybeSingle: mocks.single };
  mocks.from.mockReturnValue(query); mocks.select.mockReturnValue(query); mocks.eq.mockReturnValue(query);
});
it('새 저장과 동일 문구 no-op의 확인된 응답만 성공으로 반환한다', async () => {
  mocks.rpc.mockResolvedValueOnce({ data: saved, error: null }); expect((await saveCsReplyTemplateAction(request)).ok).toBe(true);
  mocks.rpc.mockResolvedValueOnce({ data: { ...saved, revision: 1 }, error: null }); expect((await saveCsReplyTemplateAction(request)).ok).toBe(true);
  for (const patch of [{ id: '22222222-2222-4222-8222-222222222222' }, { surface: 'product_question' }, { body: '다른 문구' }, { revision: 4 }]) {
    mocks.rpc.mockResolvedValueOnce({ data: { ...saved, ...patch }, error: null }); expect(await saveCsReplyTemplateAction(request)).toMatchObject({ ok: false, uncertain: true });
  }
});
it('확정 버전 충돌과 전송 불명확을 구분한다', async () => {
  mocks.rpc.mockResolvedValueOnce({ data: null, error: { code: 'PT409', message: 'cs_reply_template_changed' } });
  expect(await saveCsReplyTemplateAction(request)).toMatchObject({ ok: false, uncertain: false });
  mocks.rpc.mockResolvedValueOnce({ data: null, error: { message: 'network failure' } });
  expect(await saveCsReplyTemplateAction(request)).toMatchObject({ ok: false, uncertain: true });
});
it('최신본 조회도 권한·표면·대상 ID를 검사하며 원래 템플릿만 반환한다', async () => {
  mocks.auth.isStaff = false; expect((await readCsReplyTemplateAction({ id, surface: 'review' })).ok).toBe(false); expect(mocks.from).not.toHaveBeenCalled();
  mocks.auth.isStaff = true; mocks.single.mockResolvedValueOnce({ data: saved, error: null });
  expect(await readCsReplyTemplateAction({ id, surface: 'review' })).toMatchObject({ ok: true, template: { id, surface: 'review', revision: 2 } });
  expect(mocks.eq.mock.calls).toEqual([['id', id], ['surface', 'review']]);
  mocks.single.mockResolvedValueOnce({ data: { ...saved, surface: 'product_question' }, error: null });
  expect((await readCsReplyTemplateAction({ id, surface: 'review' })).ok).toBe(false);
});
