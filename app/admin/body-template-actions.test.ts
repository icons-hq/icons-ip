import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ access: vi.fn(), rpc: vi.fn(), revalidate: vi.fn() }));
vi.mock('@/lib/admin/action-access.server', () => ({ requireAdminActionAccess: mocks.access }));
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({ rpc: mocks.rpc }) }));
vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidate }));
import { archiveBodyTemplateAction, listBodyTemplatesAction, readBodyTemplateAction, saveBodyTemplateAction } from './body-template-actions';
const id = '94000000-0000-4000-8000-000000000001', other = '94000000-0000-4000-8000-000000000002';
const request = { surface: 'goods' as const, expectedActorId: id, id, expectedRevision: 0, operationId: other, name: '배송 안내', bodyHtml: '<p>배송 안내</p>' };
const row = { id, name: request.name, revision: 1, archivedAt: null, createdAt: '2026-10-14T00:00:00Z', updatedAt: '2026-10-14T00:00:00Z', characterCount: 12, bodyHtml: request.bodyHtml };
beforeEach(() => { vi.clearAllMocks(); mocks.access.mockResolvedValue({ user: { id } }); mocks.rpc.mockResolvedValue({ data: row, error: null }); });
describe('개인 템플릿 서버 경계', () => {
  it('현재 actor와 surface 권한을 각각 확인하고 저장 후 같은 actor로 다시 읽는다', async () => {
    expect(await saveBodyTemplateAction(request)).toMatchObject({ ok: true, value: { bodyHtml: row.bodyHtml } });
    expect(mocks.access).toHaveBeenCalledWith('/admin/catalog/goods', { capability: 'catalog.manage' });
    expect(mocks.rpc).toHaveBeenNthCalledWith(1, 'admin_save_goods_body_template', { p_expected_actor_id: id, p_id: id, p_expected_revision: 0, p_operation_id: other, p_name: request.name, p_body_html: request.bodyHtml });
    expect(mocks.rpc).toHaveBeenNthCalledWith(2, 'admin_get_goods_body_template', { p_expected_actor_id: id, p_id: id });
    expect(mocks.revalidate).not.toHaveBeenCalled();
  });
  it('스토리는 별도 권한 wrapper를 사용하며 외부 링크를 저장 전에 정리한다', async () => {
    const bodyHtml = '<p><a href="https://example.com">본문</a></p>';
    mocks.rpc.mockResolvedValue({ data: { ...row, bodyHtml: '<p><span>본문</span></p>' }, error: null });
    expect(await saveBodyTemplateAction({ ...request, surface: 'story', bodyHtml })).toHaveProperty('ok', true);
    expect(mocks.access).toHaveBeenCalledWith('/admin/display/stories', { capability: 'store.manage' });
    expect(mocks.rpc.mock.calls[0][0]).toBe('admin_save_story_body_template'); expect(mocks.rpc.mock.calls[0][1].p_body_html).not.toContain('href');
  });
  it.each([false, { user: { id: other } }])('권한·actor가 달라지면 요청하지 않는다: %j', async access => { mocks.access.mockResolvedValue(access); expect(await saveBodyTemplateAction(request)).toHaveProperty('ok', false); expect(mocks.rpc).not.toHaveBeenCalled(); });
  it.each(['', '57014', 'XX000', 'PGRST000'])('알 수 없는 write 오류 %s는 operation을 버리지 않는다', async code => {
    mocks.rpc.mockResolvedValue({ error: { code, message: 'TypeError: fetch failed' } });
    expect(await saveBodyTemplateAction(request)).toHaveProperty('uncertain', true);
    expect(await archiveBodyTemplateAction({ ...request, expectedRevision: 1, archived: true, name: undefined, bodyHtml: undefined } as never)).toHaveProperty('ok', false);
    const archive = { surface: 'goods' as const, expectedActorId: id, id, operationId: other, expectedRevision: 1, archived: true };
    expect(await archiveBodyTemplateAction(archive)).toHaveProperty('uncertain', true);
  });
  it.each(['22023', '42501', '28000', '23514', '23503', 'P0002', 'PT409', '23505'])('확정 SQL 거절 %s는 불명확 요청이 아니다', async code => { mocks.rpc.mockResolvedValue({ error: { code, message: 'body_template_conflict' } }); expect(await saveBodyTemplateAction(request)).toHaveProperty('uncertain', false); });
  it('throw와 잘못된 receipt는 불명확 처리하고 읽기 불일치는 이미 처리된 요청으로 구별한다', async () => {
    mocks.rpc.mockRejectedValueOnce(new Error('lost')); expect(await saveBodyTemplateAction(request)).toHaveProperty('uncertain', true);
    mocks.rpc.mockResolvedValueOnce({ data: { ...row, id: other }, error: null }); expect(await saveBodyTemplateAction(request)).toHaveProperty('uncertain', true);
    mocks.rpc.mockResolvedValueOnce({ data: row, error: null }).mockResolvedValueOnce({ data: { ...row, revision: 2 }, error: null });
    expect(await saveBodyTemplateAction(request)).toMatchObject({ ok: false, committed: { id, revision: 1 } });
  });
  it('읽기의 다른 id·목록 본문 누출을 거부하며 모든 요청은 expected actor를 전달한다', async () => {
    mocks.rpc.mockResolvedValueOnce({ data: { ...row, id: other }, error: null }); expect(await readBodyTemplateAction({ surface: 'goods', expectedActorId: id, id })).toHaveProperty('ok', false);
    mocks.rpc.mockResolvedValueOnce({ data: { rows: [row], total: 1, archivedCount: 0, limit: 50 }, error: null });
    const result = await listBodyTemplatesAction({ surface: 'goods', expectedActorId: id, archived: false });
    expect(result.ok).toBe(true); if (result.ok) expect(result.value.rows[0]).not.toHaveProperty('bodyHtml');
    expect(mocks.rpc).toHaveBeenLastCalledWith('admin_list_goods_body_templates', { p_expected_actor_id: id, p_archived: false });
  });
});
