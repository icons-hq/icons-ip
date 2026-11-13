import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { StockReconcileDocument } from '@/lib/admin/stock-reconcile';
import { StockReconcileScreen } from './screens/StockReconcileScreen';
import { StockReconcileConflictNotice, StockReconcilePanel, StockReconcileResult, stockReconcileFileError } from './StockReconcilePanel';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn(), replace: vi.fn() }) }));
vi.mock('@/app/admin/stock-reconcile-actions', () => ({ readStockReconcileFileAction: vi.fn(), previewStockReconcileAction: vi.fn(), applyStockReconcileAction: vi.fn() }));

const item = { goodId: 'g1', goodsCode: 'G1', goodsName: '키링', sourceRow: 2, matchKind: 'option_code' as const, appliedDelta: null, stockAfter: null, preorder: false,
  returnedSinceQty: 0, awaitingReturnQty: 0, adjustedSinceCount: 0, adjustedSinceQty: 0,
  stockBefore: null, appliedPendingQty: null, appliedShippedSinceQty: null, appliedReturnedSinceQty: null, appliedAwaitingReturnQty: null };
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
    expect(html).toContain('기준 시각 뒤 회수');
    expect(html).toContain('회수 뒤 미반영');
    expect(html).not.toContain('기준 시각 뒤 재고를 직접 바꾼 옵션');
  });

  it('기준 시각 뒤 재고 조정·다른 대조가 있으면 반영 전에 알린다', () => {
    const adjusted = { ...snapshot, items: snapshot.items.map((entry, index) => index === 0
      ? { ...entry, returnedSinceQty: 2, awaitingReturnQty: 1, adjustedSinceCount: 1, adjustedSinceQty: 5 } : entry) };
    const html = renderToStaticMarkup(<StockReconcileResult snapshot={adjusted} showSame={false} />);
    expect(html).toContain('기준 시각 뒤 재고를 직접 바꾼 옵션 1개');
    expect(html).toContain('기준 시각 뒤 직접 변경 1건 (+5)');
    const applied = renderToStaticMarkup(<StockReconcileResult snapshot={{ ...adjusted, appliedAt: '2031-05-01T00:10:00Z', appliedByName: '운영자',
      applyReason: '대조', applyResult: { changed: 2, increased: 1, decreased: 1, shortages: 1, totalDelta: -9 } }} showSame={false} />);
    expect(applied).not.toContain('기준 시각 뒤 재고를 직접 바꾼 옵션');
  });

  it('반영한 기록은 반영할 때 다시 잰 재고수량·출고 대기로 칸끼리 계산이 맞게 보인다(QA1 S-T07-01)', () => {
    /* 미리보기: 재고 10·출고 대기 2·파일 9 → 맞춘 뒤 7. 반영 전에 그 주문이 출고돼 출고 대기 0·기준 시각 뒤 출고 2가 됐다. */
    const moved = { ...snapshot.items[0], fileQty: 9, stockQty: 10, pendingQty: 2, shippedSinceQty: 0, difference: -3, targetQty: 7,
      appliedDelta: -3, stockAfter: 7, stockBefore: 10, appliedPendingQty: 0, appliedShippedSinceQty: 2, appliedReturnedSinceQty: 0, appliedAwaitingReturnQty: 0 };
    const html = renderToStaticMarkup(<StockReconcileResult snapshot={{ ...snapshot, items: [moved], issues: [], appliedAt: '2031-05-01T00:10:00Z',
      appliedByName: '운영자', applyReason: '대조', applyResult: { changed: 1, increased: 0, decreased: 1, shortages: 0, totalDelta: -3 } }} showSame={false} />);
    expect(html).toContain('반영할 때 다시 잰 값');
    const body = html.match(/<tbody[^>]*>([\s\S]*?)<\/tbody>/)?.[1] ?? '';
    const cells = [...body.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((cell) => cell[1].replace(/<[^>]+>/g, ''));
    /* 파일 9 · 기준 시각 뒤 출고 2 · 회수 0 · 출고 대기 0 · 회수 뒤 미반영 0 · 반영 전 10 · 반영 뒤 7 · 줄임 -3 */
    expect(cells.slice(3, 10)).toEqual(['9', '2', '0', '0', '0', '10', '7']);
    expect(cells[10]).toContain('줄임 -3');
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

  it('반영을 거절한 옵션은 미리보기 값·지금 값·이유를 보이고 다시 미리보기로 잇는다', () => {
    const conflict = { variantId: '60000000-0000-4000-8000-000000000011', goodsName: '키링', optionName: '핑크', optionCode: 'G1-01',
      previewStockQty: 10, currentStockQty: 9, previewPendingQty: 0, currentPendingQty: 1, previewTargetQty: 7, currentTargetQty: 6,
      previewDifference: -3, currentDifference: -3, reason: 'pending_changed' as const };
    const html = renderToStaticMarkup(<StockReconcileConflictNotice conflicts={[conflict]} busy={false} onRepreview={() => {}} onRestart={() => {}} />);
    expect(html).toContain('미리보기 뒤 재고가 바뀐 옵션 1개가 있어 반영하지 않았습니다');
    expect(html).toContain('재고수량은 하나도 바꾸지 않았습니다');
    expect(html).toContain('키링 / 핑크');
    expect(html).toContain('10 → 7');
    expect(html).toContain('9 → 6');
    expect(html).toContain('0 → 1');
    expect(html).toContain('출고 대기 변동');
    expect(html).toContain('다시 미리보기');
    expect(html).not.toContain('새 파일 대조');
    const fromHistory = renderToStaticMarkup(<StockReconcileConflictNotice conflicts={[{ ...conflict, reason: 'stock_changed' }]} busy={false} onRestart={() => {}} />);
    expect(fromHistory).toContain('재고 변동');
    expect(fromHistory).toContain('같은 파일을 다시 올려 미리보기 해주세요');
    expect(fromHistory).toContain('새 파일 대조');
    expect(fromHistory).not.toContain('>다시 미리보기<');
  });

  it('파일 선택 라벨은 파일 입력을 가리키고 화면 안 id가 겹치지 않는다', () => {
    const html = renderToStaticMarkup(<StockReconcileScreen origins={[]} history={[]} snapshot={null} digest={null} canManageDigest={false} now="2031-05-01T01:00:00Z" />);
    const ids = [...html.matchAll(/ id="([^"]+)"/g)].map((match) => match[1]);
    expect(new Set(ids).size).toBe(ids.length);
    expect(html).toMatch(/<label[^>]*for="stock-reconcile-file-input"[^>]*>또는 파일 선택<\/label>/);
    expect(html).toMatch(/<input[^>]*(?:id="stock-reconcile-file-input"[^>]*type="file"|type="file"[^>]*id="stock-reconcile-file-input")/);
  });

  it('파일은 형식·크기를 먼저 본다', () => {
    expect(stockReconcileFileError({ name: 'a.xls', size: 10 })).toContain('XLSX로 다시 저장');
    expect(stockReconcileFileError({ name: 'a.xlsx', size: 0 })).toContain('선택해주세요');
    expect(stockReconcileFileError({ name: 'a.xlsx', size: 2_000_000 })).toContain('KB 이하');
    expect(stockReconcileFileError({ name: 'a.csv', size: 10 })).toBeNull();
  });
});
