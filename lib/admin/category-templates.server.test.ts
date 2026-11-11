import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({ rpc: mocks.rpc }) }));

import { hasUsableCategoryTemplates } from './category-templates.server';

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
