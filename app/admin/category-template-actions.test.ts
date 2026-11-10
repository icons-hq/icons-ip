import { beforeEach, expect, it, vi } from 'vitest';
const mock = vi.hoisted(() => ({ access: vi.fn(), rpc: vi.fn(), revalidate: vi.fn() }));
vi.mock('@/lib/admin/action-access.server', () => ({ requireAdminActionAccess: mock.access }));
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({ rpc: mock.rpc }) }));
vi.mock('next/cache', () => ({ revalidatePath: mock.revalidate }));
import { listCategoryTemplatesAction, saveCategoryTemplatesAction } from './category-template-actions';
const id = '94700000-0000-4000-8000-000000000101', operation = '94700000-0000-4000-8000-000000001000';
const row = { categoryId: id, code: 'stationery', name: '문구', path: ['굿즈', '문구'], usable: true, archived: true, revision: 2, createdAt: '2026-10-14T00:00:00Z' };
beforeEach(() => { vi.clearAllMocks(); mock.access.mockResolvedValue({ user: { id: 'actor' } }); mock.rpc.mockResolvedValue({ data: { rows: [row] }, error: null }); });
it('requires the current catalog write capability before reads or writes', async () => {
  mock.access.mockResolvedValue(null);
  expect(await listCategoryTemplatesAction('', false, 1)).toMatchObject({ ok: false });
  expect(await saveCategoryTemplatesAction([{ categoryId: id, revision: 1 }], true, operation)).toMatchObject({ ok: false });
  expect(mock.rpc).not.toHaveBeenCalled();
});
it('binds the mutation receipt to every selected category, revision and archived flag', async () => {
  expect(await saveCategoryTemplatesAction([{ categoryId: id, revision: 1 }], true, operation)).toEqual({ ok: true, value: [row] });
  for (const rows of [[], [{ ...row, revision: 1 }], [{ ...row, archived: false }], [{ ...row, categoryId: operation }], [row, row]]) {
    mock.rpc.mockResolvedValue({ data: { rows }, error: null });
    expect(await saveCategoryTemplatesAction([{ categoryId: id, revision: 1 }], true, operation)).toMatchObject({ ok: false, uncertain: true });
  }
});
it('distinguishes confirmed rollback from a lost response', async () => {
  mock.rpc.mockResolvedValue({ error: { code: 'PT409', message: 'category_templates_changed' } });
  expect(await saveCategoryTemplatesAction([{ categoryId: id, revision: 1 }], true, operation)).toMatchObject({ ok: false, conflict: true });
  mock.rpc.mockRejectedValue(new Error('private error details'));
  const result = await saveCategoryTemplatesAction([{ categoryId: id, revision: 1 }], true, operation);
  expect(result).toMatchObject({ ok: false, uncertain: true }); expect(JSON.stringify(result)).not.toContain('private error');
});
it('rejects a response for a different page or archive state', async () => {
  mock.rpc.mockResolvedValue({ data: { rows: [row], page: 1, total: 1, pageSize: 20 }, error: null });
  expect(await listCategoryTemplatesAction('', true, 2)).toMatchObject({ ok: false });
  expect(await listCategoryTemplatesAction('', false, 1)).toMatchObject({ ok: false });
  expect(await listCategoryTemplatesAction('', true, 1)).toMatchObject({ ok: true });
});
