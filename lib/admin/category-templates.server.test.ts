import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({ rpc: mocks.rpc }) }));

import { CATEGORY_TEMPLATE_READ_LIMIT, hasUsableCategoryTemplates, readCategoryTemplates } from './category-templates.server';

const row = (usable: boolean, index = 1) => ({
  categoryId: `94700000-0000-4000-8000-${String(index).padStart(12, '0')}`, code: 'code', name: '키링', path: ['문구', '키링'], usable, archived: false, revision: 1, createdAt: '2026-10-14T00:00:00Z',
});
const page = (rows: ReturnType<typeof row>[], total = rows.length) => ({ data: { rows, total, page: 1, pageSize: 20 }, error: null });

beforeEach(() => { mocks.rpc.mockReset(); });

describe('자주 쓰는 카테고리 유무', () => {
  it('사용 중 목록의 첫 쪽만 가볍게 조회한다', async () => {
    mocks.rpc.mockResolvedValue(page([row(true)]));
    await expect(hasUsableCategoryTemplates()).resolves.toBe(true);
    expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith('admin_list_catalog_category_templates', { p_query: '', p_archived: false, p_page: 1 });
  });

  it('0건이거나 지금 고를 수 있는 항목이 없으면 없음이다', async () => {
    mocks.rpc.mockResolvedValue(page([]));
    await expect(hasUsableCategoryTemplates()).resolves.toBe(false);
    mocks.rpc.mockResolvedValue(page([row(false)]));
    await expect(hasUsableCategoryTemplates()).resolves.toBe(false);
  });

  it('첫 쪽이 전부 고를 수 없어도 다음 쪽이 있으면 있다고 본다', async () => {
    mocks.rpc.mockResolvedValue(page(Array.from({ length: 20 }, (_, index) => row(false, index)), 21));
    await expect(hasUsableCategoryTemplates()).resolves.toBe(true);
  });

  it('조회가 실패해도 화면을 깨지 않고 없음으로 답한다', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message: 'operator_capability_required' } });
    await expect(hasUsableCategoryTemplates()).resolves.toBe(false);
    mocks.rpc.mockResolvedValue({ data: { rows: 'broken' }, error: null });
    await expect(hasUsableCategoryTemplates()).resolves.toBe(false);
    mocks.rpc.mockRejectedValue(new Error('network'));
    await expect(hasUsableCategoryTemplates()).resolves.toBe(false);
  });
});

/* 조회 함수는 20개씩만 준다. 고르는 창·등록 창은 목록을 한 번에 가져다 쓰므로 모든 쪽을 읽어 합친다. */
describe('자주 쓰는 카테고리 전체 읽기', () => {
  type Args = { p_page: number; p_archived: boolean };
  const rowAt = (index: number, archived = false) => ({ ...row(true, index), archived });
  const pageRows = (pageNumber: number, total: number, archived = false) => Array.from({ length: Math.max(0, Math.min(20, total - (pageNumber - 1) * 20)) }, (_, offset) => rowAt((pageNumber - 1) * 20 + offset + 1, archived));
  const pageData = (pageNumber: number, rows: unknown[], total: number) => ({ data: { rows, total, page: pageNumber, pageSize: 20 }, error: null });
  /** 요청한 쪽에 맞는 줄을 돌려주는 가짜 조회 함수. */
  const serve = (total: number) => mocks.rpc.mockImplementation(async (_name: string, args: Args) => pageData(args.p_page, pageRows(args.p_page, total, args.p_archived), total));
  const failed = { ok: false, reason: 'failed' };

  it('한 쪽이면 한 번만 읽는다', async () => {
    serve(3);
    const result = await readCategoryTemplates(false);
    expect(result.ok && result.rows).toHaveLength(3);
    expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith('admin_list_catalog_category_templates', { p_query: '', p_archived: false, p_page: 1 });
  });

  it('첫 쪽의 전체 개수로 쪽 수를 정해 나머지를 읽고 쪽 순서대로 합친다', async () => {
    serve(45);
    const result = await readCategoryTemplates(false);
    expect(mocks.rpc.mock.calls.map(([, args]) => args.p_page).sort((left, right) => left - right)).toEqual([1, 2, 3]);
    expect(result.ok && result.rows.map(item => item.categoryId)).toEqual(Array.from({ length: 45 }, (_, index) => row(true, index + 1).categoryId));
  });

  it('보관한 항목은 보관 조건으로 읽는다', async () => {
    serve(2);
    const result = await readCategoryTemplates(true);
    expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith('admin_list_catalog_category_templates', { p_query: '', p_archived: true, p_page: 1 });
    expect(result.ok && result.rows.every(item => item.archived)).toBe(true);
  });

  it('읽는 사이에 쪽이 밀려 같은 줄이 두 번 와도 한 번만 담는다', async () => {
    mocks.rpc.mockImplementation(async (_name: string, args: Args) => pageData(args.p_page, args.p_page === 1 ? pageRows(1, 40) : [pageRows(1, 40)[19], ...pageRows(2, 40).slice(0, 19)], 40));
    const result = await readCategoryTemplates(false);
    expect(result.ok && result.rows).toHaveLength(39);
  });

  it(`${CATEGORY_TEMPLATE_READ_LIMIT}개를 넘으면 첫 쪽만 읽고 너무 많다고 답한다`, async () => {
    serve(CATEGORY_TEMPLATE_READ_LIMIT + 1);
    await expect(readCategoryTemplates(false)).resolves.toEqual({ ok: false, reason: 'too_many' });
    expect(mocks.rpc).toHaveBeenCalledOnce();
  });

  it(`${CATEGORY_TEMPLATE_READ_LIMIT}개까지는 읽는다`, async () => {
    serve(CATEGORY_TEMPLATE_READ_LIMIT);
    const result = await readCategoryTemplates(false);
    expect(result.ok && result.rows).toHaveLength(CATEGORY_TEMPLATE_READ_LIMIT);
    expect(mocks.rpc).toHaveBeenCalledTimes(CATEGORY_TEMPLATE_READ_LIMIT / 20);
  });

  it('뒤쪽 한 쪽이라도 못 읽으면 일부만 쓰지 않고 실패로 답한다', async () => {
    mocks.rpc.mockImplementation(async (_name: string, args: Args) => args.p_page === 2 ? { data: null, error: { message: 'boom' } } : pageData(args.p_page, pageRows(args.p_page, 45), 45));
    await expect(readCategoryTemplates(false)).resolves.toEqual(failed);
  });

  it('다른 쪽이나 다른 보관 상태의 응답은 받지 않는다', async () => {
    mocks.rpc.mockResolvedValue(pageData(2, [rowAt(1)], 1));
    await expect(readCategoryTemplates(false)).resolves.toEqual(failed);
    mocks.rpc.mockResolvedValue(pageData(1, [rowAt(1)], 1));
    await expect(readCategoryTemplates(true)).resolves.toEqual(failed);
  });

  it('조회가 던져도 화면을 깨지 않고 실패로 답한다', async () => {
    mocks.rpc.mockRejectedValue(new Error('network'));
    await expect(readCategoryTemplates(false)).resolves.toEqual(failed);
  });
});
