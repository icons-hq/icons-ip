import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { StockDispatchWarnings } from '@/lib/admin/stock-reconcile';
import { StockDispatchWarning } from './StockDispatchWarning';

const base: StockDispatchWarnings = { originId: null, checkedAt: '2031-05-01T00:00:00Z', batchVariantCount: 2, latestAsOf: '2031-05-01T00:00:00Z',
  warnings: [], unreconciledCount: 0, unreconciled: [] };
const warning = { variantId: 'v1', goodsName: '키링', goodsCode: 'G1', optionName: '핑크', optionCode: 'G1-01', asOf: '2031-05-01T00:00:00Z',
  fileQty: 5, stockQty: 10, pendingQty: 9, shippedSinceQty: 0, returnedSinceQty: 0, awaitingReturnQty: 0, expectedQty: 5, difference: -14, shortageQty: 4 };

describe('출고지시 전 재고 경고', () => {
  it('불러오지 못했거나 경고할 것이 없으면 그리지 않는다(출고를 막지 않는다)', () => {
    expect(renderToStaticMarkup(<StockDispatchWarning data={null} />)).toBe('');
    expect(renderToStaticMarkup(<StockDispatchWarning data={base} />)).toBe('');
  });

  it('부족은 위험 상자로 출고 대기·창고 예상 수량을 보인다', () => {
    const html = renderToStaticMarkup(<StockDispatchWarning data={{ ...base, warnings: [{ ...warning, kind: 'shortage' }], unreconciledCount: 1,
      unreconciled: [{ variantId: 'v4', goodsName: '배지', optionName: '기본 옵션', optionCode: 'G4-01', pendingQty: 1 }] }} />);
    expect(html).toContain('data-admin-notice="danger"');
    expect(html).toContain('창고 재고보다 출고할 주문이 많은 옵션 1개');
    expect(html).toContain('출고 대기 9개 · 창고 예상 5개 · 부족 4개');
    expect(html).toContain('재고 파일로 대조한 적 없는 출고 대기 옵션도 1개 있습니다.');
    expect(html).toContain('href="/admin/catalog/stock-reconcile"');
  });

  it('창고 예상 수량이 0 아래면 음수로 보여 출고 대기와의 차이가 부족 수로 읽힌다', () => {
    const html = renderToStaticMarkup(<StockDispatchWarning data={{ ...base, warnings: [{ ...warning, kind: 'shortage', pendingQty: 6, expectedQty: -1, shortageQty: 7 }] }} />);
    expect(html).toContain('출고 대기 6개 · 창고 예상 −1개 · 부족 7개');
    expect(html).not.toContain('-1개');
  });

  it('차이는 주의 상자, 대조 기록만 없으면 안내 상자다', () => {
    const mismatch = renderToStaticMarkup(<StockDispatchWarning data={{ ...base, warnings: [{ ...warning, kind: 'mismatch', difference: 3, shortageQty: 0 }] }} />);
    expect(mismatch).toContain('data-admin-notice="warning"');
    expect(mismatch).toContain('재고 파일과 차이 +3개');
    const unreconciled = renderToStaticMarkup(<StockDispatchWarning data={{ ...base, unreconciledCount: 4,
      unreconciled: [{ variantId: 'v4', goodsName: '배지', optionName: '기본 옵션', optionCode: 'G4-01', pendingQty: 1 }] }} />);
    expect(unreconciled).toContain('data-admin-notice="info"');
    expect(unreconciled).toContain('재고 파일로 대조한 적 없는 출고 대기 옵션 4개');
    // 이름은 받은 목록에서 앞 3개까지, 나머지는 전체 건수에서 보인 이름 수를 뺀다.
    expect(unreconciled).toContain('배지 외 3개');
  });

  /* 물류출고관리(1014-084)는 발송 화면의 경고는 보지만 재고 대조 화면(catalog.manage)은 열 수 없다. */
  it('재고 대조 권한이 없으면 열 수 없는 링크 대신 요청 안내를 둔다', () => {
    const html = renderToStaticMarkup(<StockDispatchWarning canReconcile={false} data={{ ...base, warnings: [{ ...warning, kind: 'shortage' }] }} />);
    expect(html).toContain('창고 재고보다 출고할 주문이 많은 옵션 1개');
    expect(html).not.toContain('href="/admin/catalog/stock-reconcile"');
    expect(html).toContain('재고 대조 권한이 있는 운영자에게 요청해 주세요');
  });
});
