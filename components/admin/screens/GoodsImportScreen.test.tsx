import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({
  commit: vi.fn(),
  preview: vi.fn(),
  prepare: vi.fn(),
  replace: vi.fn(),
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: mocks.replace }),
}));
vi.mock('@/app/admin/goods-import-actions', () => ({
  commitNextGoodsImport: mocks.commit,
  previewGoodsImport: mocks.preview,
  prepareGoodsImport: mocks.prepare,
}));
vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({ storage: { from: () => ({ upload: vi.fn() }) } }),
}));
import { GoodsImportScreen } from './GoodsImportScreen';
const group = {
  index: 0,
  code: 'G0001',
  name: '검증한 상품',
  rows: [5, 6],
  kind: 'update' as const,
  errors: [],
  warnings: ['공개 상품의 가격·재고가 변경됩니다.'],
  result: null,
};
const view = {
  id: 'batch',
  fileName: 'goods.xlsx',
  state: 'ready' as const,
  groups: [group],
};
describe('goods workbook confirmation screen', () => {
  beforeEach(() => vi.clearAllMocks());
  it('finishes unchanged groups without suggesting product changes', () => {
    const html = renderToStaticMarkup(
      <GoodsImportScreen
        initialView={{
          ...view,
          groups: [{ ...group, kind: 'unchanged', warnings: [] }],
        }}
      />,
    );
    expect(html).toContain('변경 없이 완료');
    expect(html).not.toContain('검증한 1개 상품 적용');
  });
  it('shows row numbers and published-change warning without applying on load', () => {
    const html = renderToStaticMarkup(<GoodsImportScreen initialView={view} />);
    expect(html).toContain('5, 6');
    expect(html).toContain('공개 상품의 가격·재고가 변경됩니다.');
    expect(mocks.commit).not.toHaveBeenCalled();
    expect(html).toContain('검증한 1개 상품 적용');
  });
  it('reports completed results without exposing a second save button', () => {
    const html = renderToStaticMarkup(
      <GoodsImportScreen
        initialView={{
          ...view,
          state: 'complete',
          groups: [{ ...group, result: { status: 'success', id: 'good' } }],
        }}
      />,
    );
    expect(html).toContain('저장 완료');
    expect(html).not.toContain('검증한 1개 상품 적용');
  });
  it('offers a reusable failure workbook and keeps upload available', () => {
    const html = renderToStaticMarkup(
      <GoodsImportScreen
        initialView={{
          ...view,
          state: 'complete',
          groups: [
            {
              ...group,
              result: { status: 'failed', error: '재고가 바뀌었습니다.' },
            },
          ],
        }}
      />,
    );
    expect(html).toContain('mode=failures');
    expect(html).toContain('실패 행 내려받기');
    expect(html).toContain('상품 XLSX');
  });
});
