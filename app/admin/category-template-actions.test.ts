import { beforeEach, describe, expect, it, vi } from 'vitest';
const mock = vi.hoisted(() => ({ access: vi.fn(), rpc: vi.fn(), revalidate: vi.fn() }));
vi.mock('@/lib/admin/action-access.server', () => ({ requireAdminActionAccess: mock.access }));
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({ rpc: mock.rpc }) }));
vi.mock('next/cache', () => ({ revalidatePath: mock.revalidate }));
import { CATEGORY_TEMPLATE_LIST_FAILED, CATEGORY_TEMPLATE_UNCERTAIN } from '@/lib/admin/category-templates';
import { listCategoryTemplatesAction, loadRegisteredCategoryTemplateIdsAction, loadUsableCategoryTemplatesAction, saveCategoryTemplatesAction } from './category-template-actions';
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

/* 고르는 창·등록 창의 목록: 조회 함수는 20개씩 주므로 서버가 전부 읽어 창에 건넨다. */
describe('고르는 창과 등록 창이 쓰는 목록', () => {
  const templateId = (index: number) => `94700000-0000-4000-8000-${String(index).padStart(12, '0')}`;
  const rowAt = (index: number, extra: { usable?: boolean; archived?: boolean } = {}) => ({ categoryId: templateId(index), code: `code-${index}`, name: `분류${index}`, path: ['굿즈', `분류${index}`], usable: extra.usable ?? true, archived: extra.archived ?? false, revision: 1, createdAt: '2026-10-14T00:00:00Z' });
  /** 사용 중 목록(archived=false)과 보관 목록(archived=true)을 각각 20개씩 쪼개 돌려주는 가짜 조회 함수. */
  function serve(lists: { active: ReturnType<typeof rowAt>[]; archived?: ReturnType<typeof rowAt>[] }) {
    mock.rpc.mockImplementation(async (_name: string, args: { p_archived: boolean; p_page: number }) => {
      const all = args.p_archived ? lists.archived ?? [] : lists.active;
      return { data: { rows: all.slice((args.p_page - 1) * 20, args.p_page * 20), total: all.length, page: args.p_page, pageSize: 20 }, error: null };
    });
  }

  it('권한이 없으면 조회하지 않는다', async () => {
    mock.access.mockResolvedValue(null);
    expect(await loadUsableCategoryTemplatesAction()).toMatchObject({ ok: false });
    expect(await loadRegisteredCategoryTemplateIdsAction()).toMatchObject({ ok: false });
    expect(mock.rpc).not.toHaveBeenCalled();
  });

  it('고르는 창에는 지금 고를 수 있는 줄만 주고, 쪽을 넘어 모두 읽는다', async () => {
    const all = Array.from({ length: 25 }, (_, index) => rowAt(index + 1, { usable: index % 5 !== 0 }));
    serve({ active: all });
    const result = await loadUsableCategoryTemplatesAction();
    expect(result).toMatchObject({ ok: true });
    const rows = result.ok ? result.value : [];
    expect(rows).toHaveLength(20);
    expect(rows.every(row => row.usable && !row.archived)).toBe(true);
    expect(rows.map(row => row.categoryId)).toEqual(all.filter(row => row.usable).map(row => row.categoryId));
    expect(mock.rpc.mock.calls.every(([, args]) => args.p_archived === false)).toBe(true);
  });

  it('등록 창에는 사용 중인 것과 보관한 것을 모두 등록한 것으로 알려 준다', async () => {
    serve({ active: [rowAt(1), rowAt(2, { usable: false })], archived: [rowAt(3, { archived: true })] });
    expect(await loadRegisteredCategoryTemplateIdsAction()).toEqual({ ok: true, value: [templateId(1), templateId(2), templateId(3)] });
    expect(mock.rpc.mock.calls.map(([, args]) => args.p_archived).sort()).toEqual([false, true]);
  });

  it('너무 많으면 이유를 말하고, 읽지 못하면 다시 검색하라고 한다', async () => {
    serve({ active: Array.from({ length: 401 }, (_, index) => rowAt(index + 1)) });
    expect(await loadUsableCategoryTemplatesAction()).toEqual({ ok: false, error: '자주 쓰는 카테고리가 너무 많아 목록을 만들지 못했습니다.' });
    expect(await loadRegisteredCategoryTemplateIdsAction()).toEqual({ ok: false, error: '자주 쓰는 카테고리가 너무 많아 목록을 만들지 못했습니다.' });
    mock.rpc.mockResolvedValue({ data: null, error: { message: 'boom' } });
    expect(await loadUsableCategoryTemplatesAction()).toEqual({ ok: false, error: CATEGORY_TEMPLATE_LIST_FAILED });
    expect(await loadRegisteredCategoryTemplateIdsAction()).toEqual({ ok: false, error: CATEGORY_TEMPLATE_LIST_FAILED });
  });
});

it('저장 결과를 모를 때는 [저장됐는지 확인]을 누르라고 알린다', async () => {
  mock.rpc.mockRejectedValue(new Error('network'));
  const result = await saveCategoryTemplatesAction([{ categoryId: id, revision: 0 }], false, operation);
  expect(result).toEqual({ ok: false, error: CATEGORY_TEMPLATE_UNCERTAIN, uncertain: true });
  expect(result.ok ? '' : result.error).toContain('[저장됐는지 확인]');
});
