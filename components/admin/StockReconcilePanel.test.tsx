import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { StockReconcileDocument } from '@/lib/admin/stock-reconcile';
import { StockReconcilePanel, StockReconcileResult, stockReconcileFileError } from './StockReconcilePanel';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn(), replace: vi.fn() }) }));
vi.mock('@/app/admin/stock-reconcile-actions', () => ({ readStockReconcileFileAction: vi.fn(), previewStockReconcileAction: vi.fn(), applyStockReconcileAction: vi.fn() }));

const item = { goodId: 'g1', goodsCode: 'G1', goodsName: '키링', sourceRow: 2, matchKind: 'option_code' as const, appliedDelta: null, stockAfter: null, preorder: false };
const snapshot: StockReconcileDocument = {
  id: '60000000-0000-4000-8000-000000000001', originId: null, originName: null, sourceLabel: '서원 재고.xlsx', asOf: '2031-05-01T00:00:00Z',
  createdAt: '2031-05-01T00:05:00Z', createdByName: '운영자', rowCount: 4, matchedCount: 3, issueCount: 1, changedCount: 2,
  appliedAt: null, appliedByName: null, applyReason: null, applyResult: null,
  items: [
    { ...item, variantId: '60000000-0000-4000-8000-000000000011', optionName: '핑크', optionCode: 'G1-01', fileQty: 20, stockQty: 10, pendingQty: 8, shippedSinceQty: 1, difference: 1, targetQty: 11 },
    { ...item, variantId: '60000000-0000-4000-8000-000000000012', optionName: '블루', optionCode: 'G1-02', fileQty: 5, stockQty: 10, pendingQty: 9, shippedSinceQty: 0, difference: -14, targetQty: 0 },
    { ...item, variantId: '60000000-0000-4000-8000-000000000013', optionName: '그린', optionCode: 'G1-03', fileQty: 3, stockQty: 3, pendingQty: 0, shippedSinceQty: 0, difference: 0, targetQty: 3 },
  ],
  issues: [{ row: 5, key: 'NOPE', fileQty: 1, reason: 'not_found' }],
};

describe('재고 파일 대조 화면', () => {
  it('바뀌는 옵션만 먼저 보이고 늘림·부족·반영 안 함을 센다', () => {
    const html = renderToStaticMarkup(<StockReconcileResult snapshot={snapshot} showSame={false} onToggleSame={() => {}} />);
    expect(html).toContain('늘림 1');
    expect(html).toContain('부족 1');
    expect(html).toContain('같음 1');
    expect(html).toContain('반영 안 함 1');
    expect(html).toContain('창고 재고보다 출고할 주문이 많은 옵션 1개');
    expect(html).toContain('늘림 +1');
    expect(html).toContain('부족 4');
    expect(html).toContain('키링 / 핑크');
    expect(html).not.toContain('키링 / 그린');
    expect(html).toContain('같은 옵션 1개도 보기');
    expect(html).toContain('사이트에서 찾지 못함');
    const all = renderToStaticMarkup(<StockReconcileResult snapshot={snapshot} showSame />);
    expect(all).toContain('키링 / 그린');
  });

  it('반영한 기록은 반영 전·뒤 재고수량을 보인다', () => {
    const applied = { ...snapshot, appliedAt: '2031-05-01T00:10:00Z', appliedByName: '운영자', applyReason: '대조',
      applyResult: { changed: 2, increased: 1, decreased: 1, shortages: 1, totalDelta: -9 },
      items: snapshot.items.map((entry, index) => index === 0 ? { ...entry, appliedDelta: 1, stockAfter: 11 } : entry) };
    const html = renderToStaticMarkup(<StockReconcileResult snapshot={applied} showSame={false} />);
    expect(html).toContain('반영 결과');
    expect(html).toContain('반영 전 재고수량');
    expect(html).toContain('반영 뒤 재고수량');
  });

  it('다시 연 미리보기는 사유 칸과 반영 버튼을, 24시간이 지나면 안내를 보인다', () => {
    const fresh = renderToStaticMarkup(<StockReconcilePanel origins={[{ id: 'o1', name: '남양주', active: true }]} initialSnapshot={snapshot} now="2031-05-01T01:00:00Z" />);
    expect(fresh).toContain('옵션 2개 재고 반영');
    expect(fresh).toContain('value="재고 파일 대조 · 서원 재고.xlsx"');
    expect(fresh).toContain('value="2031-05-01T10:00"');
    const stale = renderToStaticMarkup(<StockReconcilePanel origins={[]} initialSnapshot={snapshot} now="2031-05-02T01:00:00Z" />);
    expect(stale).toContain('24시간이 지난 미리보기는 반영할 수 없습니다');
    expect(stale).not.toContain('옵션 2개 재고 반영');
  });

  it('파일은 형식·크기를 먼저 본다', () => {
    expect(stockReconcileFileError({ name: 'a.xls', size: 10 })).toContain('XLSX로 다시 저장');
    expect(stockReconcileFileError({ name: 'a.xlsx', size: 0 })).toContain('선택해주세요');
    expect(stockReconcileFileError({ name: 'a.xlsx', size: 2_000_000 })).toContain('KB 이하');
    expect(stockReconcileFileError({ name: 'a.csv', size: 10 })).toBeNull();
  });
});
