import { beforeEach, describe, expect, it, vi } from 'vitest';
import { applyStockReconcileAction, previewStockReconcileAction, readStockReconcileFileAction } from './stock-reconcile-actions';

const mocks = vi.hoisted(() => ({ access: vi.fn(), rpc: vi.fn(), revalidate: vi.fn(), readFile: vi.fn() }));
vi.mock('@/lib/admin/action-access.server', () => ({ requireAdminActionAccess: mocks.access }));
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({ rpc: mocks.rpc }) }));
vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidate }));
vi.mock('next/navigation', () => ({ unstable_rethrow: () => {} }));
vi.mock('@/lib/admin/erp-item-file.server', () => ({ readErpItemFile: mocks.readFile }));

const snapshotId = '60000000-0000-4000-8000-000000000001';
const originId = '60000000-0000-4000-8000-0000000000a1';
const document = {
  id: snapshotId, originId, originName: '남양주', sourceLabel: '서원 재고.xlsx', asOf: '2031-05-01T00:00:00Z', createdAt: '2031-05-01T00:05:00Z',
  createdByName: '운영자', rowCount: 1, matchedCount: 1, issueCount: 0, changedCount: 1, appliedAt: null, appliedByName: null, applyReason: null,
  applyResult: null, items: [], issues: [],
};
const asOf = () => new Date(Date.now() - 60 * 60 * 1000).toISOString();

beforeEach(() => {
  vi.clearAllMocks();
  mocks.access.mockResolvedValue({ user: { id: 'staff' } });
  mocks.rpc.mockResolvedValue({ data: document, error: null });
});

describe('재고 파일 대조 액션', () => {
  it('catalog.manage 권한이 없으면 DB에 닿지 않는다', async () => {
    mocks.access.mockResolvedValue(null);
    expect(await previewStockReconcileAction({ originId: null, asOf: asOf(), sourceLabel: 'x', rows: [{ row: 1, optionCode: 'A', qty: 1 }] }))
      .toEqual({ ok: false, error: '재고를 대조할 권한이 없습니다.' });
    expect(await applyStockReconcileAction({ snapshotId, expectedChanges: 1, reason: '대조' })).toMatchObject({ ok: false });
    expect(mocks.access).toHaveBeenCalledWith('/admin/catalog/stock-reconcile', { capability: 'catalog.manage' });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('브라우저 행을 다시 검사해 정확한 매개변수로 미리보기를 만든다', async () => {
    const at = asOf();
    const result = await previewStockReconcileAction({ originId, asOf: at, sourceLabel: ' 서원 재고.xlsx ', rows: [{ row: 2, optionCode: ' G1-01 ', qty: 20 }, { row: 3, erpCode: 'E2', qty: 0 }] });
    expect(result).toMatchObject({ ok: true, snapshot: { id: snapshotId } });
    expect(mocks.rpc).toHaveBeenCalledWith('admin_preview_stock_reconcile', {
      p_origin_id: originId, p_as_of: new Date(at).toISOString(), p_source_label: '서원 재고.xlsx',
      p_rows: [{ row: 2, qty: 20, optionCode: 'G1-01' }, { row: 3, qty: 0, erpCode: 'E2' }],
    });
    expect(mocks.revalidate).toHaveBeenCalledWith('/admin/catalog/stock-reconcile');
  });

  it('잘못된 행·기준 시각·출고지는 DB에 보내지 않는다', async () => {
    const cases = [
      { originId: null, asOf: asOf(), sourceLabel: 'x', rows: [{ row: 1, optionCode: 'A', qty: -1 }] },
      { originId: null, asOf: asOf(), sourceLabel: 'x', rows: [{ row: 1, qty: 1 }] },
      { originId: null, asOf: asOf(), sourceLabel: 'x', rows: [{ row: 1, optionCode: 'A', qty: 1 }, { row: 1, optionCode: 'B', qty: 1 }] },
      { originId: null, asOf: new Date(Date.now() + 60 * 60 * 1000).toISOString(), sourceLabel: 'x', rows: [{ row: 1, optionCode: 'A', qty: 1 }] },
      { originId: null, asOf: new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString(), sourceLabel: 'x', rows: [{ row: 1, optionCode: 'A', qty: 1 }] },
      { originId: 'not-uuid', asOf: asOf(), sourceLabel: 'x', rows: [{ row: 1, optionCode: 'A', qty: 1 }] },
      { originId: null, asOf: asOf(), sourceLabel: '', rows: [{ row: 1, optionCode: 'A', qty: 1 }] },
      { originId: null, asOf: asOf(), sourceLabel: 'x', rows: [] },
    ];
    for (const input of cases) expect(await previewStockReconcileAction(input), JSON.stringify(input)).toMatchObject({ ok: false });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('DB 오류 코드를 운영 문구로 바꾸고 모르는 응답은 성공으로 보지 않는다', async () => {
    mocks.rpc.mockResolvedValueOnce({ data: null, error: { code: '22023', message: 'invalid_stock_reconcile_as_of' } });
    expect(await previewStockReconcileAction({ originId: null, asOf: asOf(), sourceLabel: 'x', rows: [{ row: 1, optionCode: 'A', qty: 1 }] }))
      .toEqual({ ok: false, error: '재고 기준 시각은 지금부터 7일 안이어야 합니다.' });
    mocks.rpc.mockResolvedValueOnce({ data: { id: 'broken' }, error: null });
    expect(await previewStockReconcileAction({ originId: null, asOf: asOf(), sourceLabel: 'x', rows: [{ row: 1, optionCode: 'A', qty: 1 }] }))
      .toMatchObject({ ok: false });
  });

  it('반영은 미리보기 ID·바뀌는 옵션 수·사유를 그대로 보내고 충돌을 돌려준다', async () => {
    mocks.rpc.mockResolvedValueOnce({ data: { status: 'applied', replayed: false, snapshot: { ...document, appliedAt: '2031-05-01T00:10:00Z', appliedByName: '운영자',
      applyReason: '서원 대조', applyResult: { changed: 1, increased: 1, decreased: 0, shortages: 0, totalDelta: 2 } } }, error: null });
    expect(await applyStockReconcileAction({ snapshotId, expectedChanges: 1, reason: ' 서원 대조 ' })).toMatchObject({ ok: true, outcome: { status: 'applied' } });
    expect(mocks.rpc).toHaveBeenCalledWith('admin_apply_stock_reconcile', { p_snapshot_id: snapshotId, p_expected_changes: 1, p_reason: '서원 대조' });
    expect(mocks.revalidate).toHaveBeenCalledWith('/admin/catalog/goods');
    mocks.rpc.mockResolvedValueOnce({ data: { status: 'conflict', conflicts: [{ variantId: 'v', goodsName: '키링', optionName: '기본 옵션', optionCode: 'G1-01',
      previewDifference: 1, currentDifference: 2, reason: 'changed' }] }, error: null });
    expect(await applyStockReconcileAction({ snapshotId, expectedChanges: 1, reason: '서원 대조' })).toMatchObject({ ok: true, outcome: { status: 'conflict' } });
    mocks.rpc.mockResolvedValueOnce({ data: null, error: { code: 'PT409', message: 'stock_reconcile_already_applied' } });
    expect(await applyStockReconcileAction({ snapshotId, expectedChanges: 1, reason: '다른 사유' })).toMatchObject({ ok: false, error: expect.stringContaining('이미 반영한') });
  });

  it('반영 입력이 틀리면 DB에 보내지 않는다', async () => {
    for (const input of [{ snapshotId: 'x', expectedChanges: 1, reason: 'r' }, { snapshotId, expectedChanges: -1, reason: 'r' }, { snapshotId, expectedChanges: 1, reason: ' ' },
      { snapshotId, expectedChanges: 1, reason: 'r'.repeat(201) }]) {
      expect(await applyStockReconcileAction(input)).toMatchObject({ ok: false });
    }
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('파일은 형식·크기를 먼저 보고 ERP 반입과 같은 읽기 경계를 쓴다', async () => {
    const form = (file: File) => { const data = new FormData(); data.set('file', file); return data; };
    expect(await readStockReconcileFileAction(form(new File(['a'], 'stock.xls')))).toMatchObject({ ok: false, error: expect.stringContaining('XLSX로 다시 저장') });
    expect(await readStockReconcileFileAction(form(new File(['a'], 'stock.pdf')))).toMatchObject({ ok: false });
    expect(mocks.readFile).not.toHaveBeenCalled();
    mocks.readFile.mockResolvedValue({ table: [['관리코드', '재고수량']], numericColumns: [], warnings: [], sheetName: 'Sheet1' });
    expect(await readStockReconcileFileAction(form(new File(['a,b'], 'stock.csv')))).toEqual({ ok: true, fileName: 'stock.csv', table: [['관리코드', '재고수량']],
      numericColumns: [], warnings: [], sheetName: 'Sheet1' });
    mocks.readFile.mockRejectedValue(new Error('한 번에 5,000행까지 반입할 수 있습니다. 파일을 나누어 반입해주세요.'));
    expect(await readStockReconcileFileAction(form(new File(['a,b'], 'stock.csv')))).toMatchObject({ ok: false, error: expect.stringContaining('대조할 수 있습니다') });
  });
});
