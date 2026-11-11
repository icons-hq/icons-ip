import { beforeEach, describe, expect, it, vi } from 'vitest';
const mock = vi.hoisted(() => ({ access: vi.fn(), rpc: vi.fn(), revalidate: vi.fn() }));
vi.mock('@/lib/admin/action-access.server', () => ({ requireAdminActionAccess: mock.access }));
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({ rpc: mock.rpc }) }));
vi.mock('next/cache', () => ({ revalidatePath: mock.revalidate }));
import { deleteReviewEventTemplateAction, listReviewEventTemplatesAction, saveReviewEventTemplateAction } from './review-event-actions';

/* SHEET-017: 리뷰이벤트 문구 템플릿 서버 액션. 권한·입력·영수증 대조와 불확실 응답 구분을 고정한다. */
const id = '93100000-0000-4000-8000-000000000101', operationId = '93100000-0000-4000-8000-000000001001';
const saved = { id, title: '포토리뷰 이벤트', description: '사진과 함께 후기를 남겨주세요', revision: 1, createdAt: '2026-11-11T01:00:00Z', updatedAt: '2026-11-11T01:00:00Z' };
const page = { total: 1, page: 1, pageSize: 20, rows: [saved] };
beforeEach(() => { vi.clearAllMocks(); mock.access.mockResolvedValue({ user: { id: 'actor' } }); mock.rpc.mockResolvedValue({ data: saved, error: null }); });

describe('review event template actions', () => {
  it('checks the review management permission before any read or write', async () => {
    mock.access.mockResolvedValue(null);
    for (const work of [() => listReviewEventTemplatesAction('', 1), () => saveReviewEventTemplateAction(id, 0, operationId, saved), () => deleteReviewEventTemplateAction(id, 1, operationId)]) {
      expect(await work()).toEqual({ ok: false, error: '리뷰 관리 권한이 필요합니다.' });
    }
    expect(mock.rpc).not.toHaveBeenCalled();
    expect(mock.access).toHaveBeenCalledWith('/admin/cs/review-events', { capability: 'cs.manage' });
  });

  it('trims the wording, rejects what the event fields would reject, and never consults the credit policy', async () => {
    expect(await saveReviewEventTemplateAction(id, 0, operationId, { title: ' 포토리뷰 이벤트 ', description: '사진과 함께 후기를 남겨주세요 ' })).toEqual({ ok: true, value: saved });
    expect(mock.rpc).toHaveBeenCalledExactlyOnceWith('admin_save_review_event_template', { p_id: id, p_expected_revision: 0, p_operation_id: operationId, p_title: '포토리뷰 이벤트', p_description: '사진과 함께 후기를 남겨주세요' });
    mock.rpc.mockClear();
    for (const input of [{ title: '1'.repeat(16), description: '내용' }, { title: '제목', description: '첫 줄\n둘째 줄' }, { title: '', description: '내용' }, null, ['제목', '내용']]) {
      expect(await saveReviewEventTemplateAction(id, 0, operationId, input)).toMatchObject({ ok: false });
    }
    expect(await saveReviewEventTemplateAction('not-a-uuid', 0, operationId, saved)).toMatchObject({ ok: false });
    expect(await saveReviewEventTemplateAction(id, -1, operationId, saved)).toMatchObject({ ok: false });
    expect(mock.rpc).not.toHaveBeenCalled();
  });

  it('accepts only the receipt for this template, wording and next revision', async () => {
    for (const changed of [{ ...saved, revision: 2 }, { ...saved, id: '93100000-0000-4000-8000-000000000102' }, { ...saved, description: '다른 내용' }, null]) {
      mock.rpc.mockResolvedValue({ data: changed, error: null });
      expect(await saveReviewEventTemplateAction(id, 0, operationId, saved)).toMatchObject({ ok: false, uncertain: true });
    }
  });

  it('separates confirmed conflicts from lost responses without leaking backend details', async () => {
    for (const [code, message] of [['PT409', 'review_event_template_changed'], ['23505', 'operation_conflict']]) {
      mock.rpc.mockResolvedValue({ data: null, error: { code, message } });
      expect(await saveReviewEventTemplateAction(id, 1, operationId, saved)).toMatchObject({ ok: false, conflict: true });
      expect(await deleteReviewEventTemplateAction(id, 1, operationId)).toMatchObject({ ok: false, conflict: true });
    }
    mock.rpc.mockResolvedValue({ data: null, error: { code: '22023', message: 'invalid_review_event_template' } });
    expect(await saveReviewEventTemplateAction(id, 1, operationId, saved)).toEqual({ ok: false, error: expect.stringContaining('1~15자'), conflict: false });
    mock.rpc.mockRejectedValue(new Error('private backend details'));
    const lost = await saveReviewEventTemplateAction(id, 1, operationId, saved);
    expect(lost).toMatchObject({ ok: false, uncertain: true }); expect(JSON.stringify(lost)).not.toContain('private');
    expect(await deleteReviewEventTemplateAction(id, 1, operationId)).toMatchObject({ ok: false, uncertain: true });
  });

  it('deletes only with a read revision and a matching receipt', async () => {
    expect(await deleteReviewEventTemplateAction(id, 0, operationId)).toMatchObject({ ok: false });
    expect(mock.rpc).not.toHaveBeenCalled();
    mock.rpc.mockResolvedValue({ data: { id, deleted: true }, error: null });
    expect(await deleteReviewEventTemplateAction(id, 2, operationId)).toEqual({ ok: true, value: { id } });
    expect(mock.rpc).toHaveBeenCalledExactlyOnceWith('admin_delete_review_event_template', { p_id: id, p_expected_revision: 2, p_operation_id: operationId });
    mock.rpc.mockResolvedValue({ data: { id: '93100000-0000-4000-8000-000000000102', deleted: true }, error: null });
    expect(await deleteReviewEventTemplateAction(id, 2, operationId)).toMatchObject({ ok: false, uncertain: true });
  });

  it('reads the requested page only and does not treat a failed read as an empty list', async () => {
    mock.rpc.mockResolvedValue({ data: page, error: null });
    expect(await listReviewEventTemplatesAction(' 포토 ', 1)).toEqual({ ok: true, value: page });
    expect(mock.rpc).toHaveBeenCalledExactlyOnceWith('admin_list_review_event_templates', { p_query: '포토', p_page: 1 });
    expect(await listReviewEventTemplatesAction('', 2)).toMatchObject({ ok: false });
    mock.rpc.mockResolvedValue({ data: null, error: { code: '08006' } });
    expect(await listReviewEventTemplatesAction('', 1)).toMatchObject({ ok: false });
    expect(await listReviewEventTemplatesAction('가'.repeat(101), 1)).toMatchObject({ ok: false });
    expect(mock.revalidate).not.toHaveBeenCalled();
  });
});
