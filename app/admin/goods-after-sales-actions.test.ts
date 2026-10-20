import { beforeEach, expect, it, vi } from 'vitest';
const mock = vi.hoisted(() => ({ access: vi.fn(), rpc: vi.fn(), revalidate: vi.fn() }));
vi.mock('@/lib/admin/action-access.server', () => ({ requireAdminActionAccess: mock.access }));
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({ rpc: mock.rpc }) }));
vi.mock('next/cache', () => ({ revalidatePath: mock.revalidate }));
import { listGoodsAfterSalesTemplatesAction, loadGoodsAfterSalesAction, saveGoodsAfterSalesAction, saveGoodsAfterSalesTemplateAction } from './goods-after-sales-actions';
const id = '93800000-0000-4000-8000-000000000301', operationId = '93800000-0000-4000-8000-000000000302';
const values = { phone: '02-123', guide: 'A/S 안내', sellerSpecialNotes: '배송 기간' };
const saved = { ...values, goodId: 'good-1', goodName: '상품', revision: 2, updatedAt: '2026-10-13T14:00:00Z' };
beforeEach(() => { vi.clearAllMocks(); mock.access.mockResolvedValue({ user: { id: 'actor' } }); mock.rpc.mockResolvedValue({ data: saved, error: null }); });
it('checks current catalog permission for every entry before touching stored data', async () => {
  mock.access.mockResolvedValue(null);
  for (const work of [() => loadGoodsAfterSalesAction('good-1'), () => saveGoodsAfterSalesAction('good-1', values, 1, operationId), () => listGoodsAfterSalesTemplatesAction('', false, 1), () => saveGoodsAfterSalesTemplateAction(id, values, false, 0, operationId)]) expect(await work()).toMatchObject({ ok: false });
  expect(mock.rpc).not.toHaveBeenCalled(); expect(mock.access).toHaveBeenCalledTimes(4);
});
it('rejects invalid images and input before issuing a save', async () => {
  expect(await saveGoodsAfterSalesAction('good-1', { ...values, guide: '' }, 1, operationId)).toMatchObject({ ok: false });
  expect(await saveGoodsAfterSalesTemplateAction(id, { ...values, guide: '가'.repeat(1301) }, false, 0, operationId)).toMatchObject({ ok: false });
  expect(mock.rpc).not.toHaveBeenCalled();
});
it('binds the accepted receipt to the exact good, values and next revision', async () => {
  expect(await saveGoodsAfterSalesAction('good-1', values, 1, operationId)).toEqual({ ok: true, value: saved });
  expect(mock.rpc).toHaveBeenCalledWith('admin_save_goods_after_sales_content', { p_good_id: 'good-1', p_values: values, p_expected_revision: 1, p_operation_id: operationId });
  for (const changed of [{ ...saved, revision: 3 }, { ...saved, goodId: 'other' }, { ...saved, guide: '다른 내용' }]) {
    mock.rpc.mockResolvedValue({ data: changed, error: null }); expect(await saveGoodsAfterSalesAction('good-1', values, 1, operationId)).toMatchObject({ ok: false, uncertain: true });
  }
});
it('distinguishes confirmed version/operation conflicts from a lost response', async () => {
  for (const code of ['PT409', '23505']) {
    mock.rpc.mockResolvedValue({ data: null, error: { code, message: code === 'PT409' ? 'goods_after_saless_changed' : 'operation_conflict' } });
    expect(await saveGoodsAfterSalesAction('good-1', values, 1, operationId)).toMatchObject({ ok: false, conflict: true });
  }
  mock.rpc.mockRejectedValue(new Error('private backend details'));
  const result = await saveGoodsAfterSalesAction('good-1', values, 1, operationId);
  expect(result).toMatchObject({ ok: false, uncertain: true }); expect(JSON.stringify(result)).not.toContain('private');
});
it('does not treat failed reads as empty editable data or a different page as the requested page', async () => {
  mock.rpc.mockResolvedValue({ data: null, error: { code: '08006' } }); expect(await loadGoodsAfterSalesAction('good-1')).toMatchObject({ ok: false });
  mock.rpc.mockResolvedValue({ data: { rows: [], total: 0, page: 1, pageSize: 20 }, error: null });
  expect(await listGoodsAfterSalesTemplatesAction('', false, 2)).toMatchObject({ ok: false });
});
it('validates template archive/save receipts and leaves existing product text outside the mutation', async () => {
  const template = { ...values, id, archived: true, revision: 2, createdAt: '2026-10-13T14:00:00Z' };
  mock.rpc.mockResolvedValue({ data: template, error: null });
  expect(await saveGoodsAfterSalesTemplateAction(id, { ...values, guide: ' A/S 안내 ' }, true, 1, operationId)).toEqual({ ok: true, value: template });
  expect(mock.rpc).toHaveBeenCalledExactlyOnceWith('admin_save_goods_after_sales_template', { p_id: id, p_values: values, p_archived: true, p_expected_revision: 1, p_operation_id: operationId });
  mock.rpc.mockResolvedValue({ data: { ...template, archived: false }, error: null });
  expect(await saveGoodsAfterSalesTemplateAction(id, values, true, 1, operationId)).toMatchObject({ ok: false, uncertain: true });
});

it('accepts a cleared product receipt without accepting a cleared template', async () => {
  const empty = { phone: '', guide: '', sellerSpecialNotes: '' };
  mock.rpc.mockResolvedValue({ data: { ...saved, ...empty }, error: null });
  expect(await saveGoodsAfterSalesAction('good-1', empty, 1, operationId)).toMatchObject({ ok: true, value: { ...empty, revision: 2 } });
  mock.rpc.mockClear();
  expect(await saveGoodsAfterSalesTemplateAction(id, empty, false, 1, operationId)).toMatchObject({ ok: false });
  expect(mock.rpc).not.toHaveBeenCalled();
});
