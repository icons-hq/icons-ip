import { beforeEach, expect, it, vi } from 'vitest';
const mock = vi.hoisted(() => ({ access: vi.fn(), rpc: vi.fn(), revalidate: vi.fn() }));
vi.mock('@/lib/admin/action-access.server', () => ({ requireAdminActionAccess: mock.access }));
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({ rpc: mock.rpc }) }));
vi.mock('next/cache', () => ({ revalidatePath: mock.revalidate }));
import { listGoodsSizeTemplatesAction, loadGoodsSizeChartAction, saveGoodsSizeChartAction, saveGoodsSizeTemplateAction } from './goods-size-chart-actions';
const chart = { unit: 'cm' as const, sizes: ['단일'], measurements: [{ name: '너비', values: ['37.4'] }], note: '' };
const values = { enabled: true, chart }, id = '99200000-0000-4000-8000-000000000001', operation = '99200000-0000-4000-8000-000000000002';
const saved = { goodId: 'size-synthetic', goodName: '합성 상품', values, revision: 2, updatedAt: '2026-10-14T00:00:00Z' };
beforeEach(() => { vi.clearAllMocks(); mock.access.mockResolvedValue(true); });
it('checks capability before every read and write', async () => {
  mock.access.mockResolvedValue(false);
  for (const result of [await loadGoodsSizeChartAction('size-synthetic'), await saveGoodsSizeChartAction('size-synthetic', values, 1, operation), await listGoodsSizeTemplatesAction('', false, 1), await saveGoodsSizeTemplateAction(id, '합성 표', chart, false, 0, operation)]) expect(result).toMatchObject({ ok: false });
  expect(mock.rpc).not.toHaveBeenCalled();
});
it('rejects invalid decimal text and revisions before reaching RPC', async () => {
  expect(await saveGoodsSizeChartAction('size-synthetic', { ...values, chart: { ...chart, measurements: [{ name: '너비', values: ['37.49'] }] } }, 1, operation)).toMatchObject({ ok: false });
  expect(await saveGoodsSizeChartAction('size-synthetic', values, 2147483647, operation)).toMatchObject({ ok: false });
  expect(mock.rpc).not.toHaveBeenCalled();
});
it('accepts only the requested normalized table and revision in its write receipt', async () => {
  mock.rpc.mockResolvedValue({ data: saved, error: null });
  expect(await saveGoodsSizeChartAction('size-synthetic', values, 1, operation)).toEqual({ ok: true, value: saved });
  expect(mock.revalidate).toHaveBeenCalledWith('/shop/size-synthetic');
  for (const wrong of [{ ...saved, revision: 3 }, { ...saved, goodId: 'another-good' }, { ...saved, values: { ...values, enabled: false } }]) {
    mock.rpc.mockResolvedValue({ data: wrong, error: null });
    expect(await saveGoodsSizeChartAction('size-synthetic', values, 1, operation)).toMatchObject({ ok: false, uncertain: true });
  }
});
it('distinguishes conflicts from unknown network or receipt outcomes', async () => {
  mock.rpc.mockResolvedValue({ data: null, error: { code: 'PT409', message: 'goods_size_chart_changed' } });
  expect(await saveGoodsSizeChartAction('size-synthetic', values, 1, operation)).toMatchObject({ ok: false, conflict: true });
  mock.rpc.mockRejectedValue(new Error('network'));
  expect(await saveGoodsSizeChartAction('size-synthetic', values, 1, operation)).toMatchObject({ ok: false, uncertain: true });
  expect(await loadGoodsSizeChartAction('size-synthetic')).toMatchObject({ ok: false });
});
it('validates template lifecycle receipts and name codepoints', async () => {
  const row = { id, name: '😀'.repeat(50), chart, revision: 1, archived: false, createdAt: saved.updatedAt, updatedAt: saved.updatedAt };
  mock.rpc.mockResolvedValue({ data: row, error: null });
  expect(await saveGoodsSizeTemplateAction(id, row.name, chart, false, 0, operation)).toEqual({ ok: true, value: row });
  mock.rpc.mockResolvedValue({ data: { ...row, archived: true }, error: null });
  expect(await saveGoodsSizeTemplateAction(id, row.name, chart, false, 0, operation)).toMatchObject({ ok: false, uncertain: true });
  expect(await saveGoodsSizeTemplateAction(id, '😀'.repeat(51), chart, false, 0, operation)).toMatchObject({ ok: false });
});
