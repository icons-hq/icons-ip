import { describe, expect, it } from 'vitest';
import {
  STOCK_RECONCILE_ROW_LIMIT,
  assignStockColumnTarget,
  buildStockReconcilePlan,
  defaultStockColumnMapping,
  kstDateTimeLocalToIso,
  kstDateTimeLocalValue,
  normalizeStockRowInput,
  parseStockDispatchWarnings,
  parseStockQuantity,
  parseStockReconcileApplyOutcome,
  parseStockReconcileDocument,
  stockAsOfError,
  stockReconcileDisplayItem,
  stockReconcileErrorMessage,
  stockReconcileRowPayload,
  stockReconcileRowState,
  stockReconcileShortage,
} from './stock-reconcile';

const document = {
  id: '60000000-0000-4000-8000-000000000001', originId: '60000000-0000-4000-8000-0000000000a1', originName: '남양주',
  sourceLabel: '서원 재고.xlsx', asOf: '2031-05-01T00:00:00+00:00', createdAt: '2031-05-01T00:05:00+00:00', createdByName: '운영자',
  rowCount: 3, matchedCount: 2, issueCount: 1, changedCount: 1, appliedAt: null, appliedByName: null, applyReason: null, applyResult: null,
  items: [{ variantId: '60000000-0000-4000-8000-000000000011', goodId: 'g1', goodsCode: 'G1', goodsName: '키링', optionName: '핑크', optionCode: 'G1-01',
    sourceRow: 2, matchKind: 'option_code', fileQty: 20, stockQty: 10, pendingQty: 8, shippedSinceQty: 1, returnedSinceQty: 2,
    awaitingReturnQty: 1, adjustedSinceCount: 1, adjustedSinceQty: -3, difference: 0, targetQty: 10,
    appliedDelta: null, stockAfter: null, preorder: false }],
  issues: [{ row: 3, key: 'NOPE', fileQty: 1, reason: 'not_found' }],
};

describe('재고 파일 대조 — 표 읽기', () => {
  it('ERP·창고 파일 머리글을 자동으로 짝짓는다(상품코드는 ERP 코드로 읽는다)', () => {
    expect(defaultStockColumnMapping(['품목코드', '품목명', '바코드', '현재고', '판매자상품코드', '관리코드']))
      .toEqual(['erpCode', 'ignore', 'barcode', 'quantity', 'goodsCode', 'optionCode']);
    expect(defaultStockColumnMapping(['상품코드', '재고 수량'])).toEqual(['erpCode', 'quantity']);
    expect(defaultStockColumnMapping(['재고', '실재고'])).toEqual(['ignore', 'quantity']);
  });

  it('대상마다 한 열만 갖는다', () => {
    expect(assignStockColumnTarget(['erpCode', 'quantity', 'ignore'], 2, 'quantity')).toEqual(['erpCode', 'ignore', 'quantity']);
    expect(assignStockColumnTarget(['erpCode', 'quantity'], 0, 'ignore')).toEqual(['ignore', 'quantity']);
  });

  it('수량은 쉼표·개를 지운 0 이상 정수만 받는다', () => {
    expect(parseStockQuantity('1,234 개')).toEqual({ ok: true, value: 1234 });
    expect(parseStockQuantity('12.0')).toEqual({ ok: true, value: 12 });
    expect(parseStockQuantity('0')).toEqual({ ok: true, value: 0 });
    expect(parseStockQuantity('')).toEqual({ ok: false, reason: 'missing_quantity' });
    expect(parseStockQuantity('-3')).toEqual({ ok: false, reason: 'negative_quantity' });
    expect(parseStockQuantity('1.5')).toEqual({ ok: false, reason: 'invalid_quantity' });
    expect(parseStockQuantity('100000001')).toEqual({ ok: false, reason: 'invalid_quantity' });
  });

  it('제목 행 아래 머리글을 찾고, 빈 행·합계 행을 건너뛰며 행별 사유를 남긴다', () => {
    const plan = buildStockReconcilePlan([
      ['서원 재고 현황', '', ''],
      ['품번', '품명', '재고수량'],
      ['000123', '키링', '12'],
      ['', '', ''],
      ['000124', '배지', '-2'],
      ['', '합계', ''],
      ['000125', '스티커', ''],
      ['', '엽서', '3'],
    ], { numericColumns: [0] });
    expect(plan.headerIndex).toBe(1);
    expect(plan.columns.map((column) => column.target)).toEqual(['erpCode', 'ignore', 'quantity']);
    expect(plan.rows).toEqual([{ row: 3, erpCode: '000123', qty: 12 }]);
    expect(plan.issues).toEqual([
      { row: 5, key: '000124', reason: 'negative_quantity' },
      { row: 7, key: '000125', reason: 'missing_quantity' },
      { row: 8, key: '', reason: 'missing_key' },
    ]);
    expect(plan.skippedRowCount).toBe(1);
    expect(plan.blocking).toBeNull();
    expect(plan.warnings.join('\n')).toContain('ERP 코드(품번) 열에 숫자 형식 셀이 있습니다');
  });

  it('수량 열이나 코드 열이 없으면 막고, 행 수 상한을 지킨다', () => {
    expect(buildStockReconcilePlan([['품번', '품명'], ['A', 'B']]).blocking).toContain('재고 수량 열');
    expect(buildStockReconcilePlan([['품명', '재고수량'], ['A', '1']]).blocking).toContain('한 열 이상');
    const many = [['관리코드', '재고수량'], ...Array.from({ length: STOCK_RECONCILE_ROW_LIMIT + 1 }, (_, index) => [`C${index}`, '1'])];
    expect(buildStockReconcilePlan(many).blocking).toContain('2,000행');
    expect(buildStockReconcilePlan([['관리코드', '재고수량']]).blocking).toBe('대조할 행이 없습니다.');
  });

  it('서버는 브라우저 행을 다시 검사하고 RPC 형식으로 바꾼다', () => {
    expect(normalizeStockRowInput({ row: 3, qty: 5, optionCode: ' G1-01 ', barcode: '' })).toEqual({ row: 3, optionCode: 'G1-01', qty: 5 });
    expect(normalizeStockRowInput({ row: 3, qty: -1, optionCode: 'A' })).toBeNull();
    expect(normalizeStockRowInput({ row: 3, qty: 1 })).toBeNull();
    expect(normalizeStockRowInput({ row: 3, qty: 1, optionCode: 'A', note: 'x' })).toBeNull();
    expect(normalizeStockRowInput({ row: 0, qty: 1, optionCode: 'A' })).toBeNull();
    expect(normalizeStockRowInput({ row: 3, qty: 1, optionCode: 'A\u0000' })).toBeNull();
    expect(stockReconcileRowPayload({ row: 2, erpCode: 'E1', qty: 4 })).toEqual({ row: 2, qty: 4, erpCode: 'E1' });
  });
});

describe('재고 파일 대조 — 기준 시각', () => {
  it('KST 입력값과 ISO를 오간다', () => {
    expect(kstDateTimeLocalValue(new Date('2031-05-01T00:05:00Z'))).toBe('2031-05-01T09:05');
    expect(kstDateTimeLocalToIso('2031-05-01T09:05')).toBe('2031-05-01T00:05:00.000Z');
    expect(kstDateTimeLocalToIso('2031-05-01 09:05')).toBeNull();
  });
  it('미래·7일보다 오래된 기준 시각을 거절한다', () => {
    const now = new Date('2031-05-10T00:00:00Z');
    expect(stockAsOfError('2031-05-09T00:00:00Z', now)).toBeNull();
    expect(stockAsOfError('2031-05-03T00:00:00Z', now)).toBeNull();
    expect(stockAsOfError('2031-05-10T01:00:00Z', now)).toContain('지금보다 뒤');
    expect(stockAsOfError('2031-05-02T23:59:00Z', now)).toContain('7일');
    expect(stockAsOfError(null, now)).toContain('입력');
  });
});

describe('재고 파일 대조 — 문서', () => {
  it('미리보기 문서를 읽고 모르는 모양은 막는다', () => {
    const parsed = parseStockReconcileDocument(document);
    expect(parsed?.items[0]).toMatchObject({ fileQty: 20, pendingQty: 8, shippedSinceQty: 1, returnedSinceQty: 2, awaitingReturnQty: 1,
      adjustedSinceCount: 1, adjustedSinceQty: -3, difference: 0, targetQty: 10 });
    expect(parsed?.issues).toEqual([{ row: 3, key: 'NOPE', fileQty: 1, reason: 'not_found' }]);
    expect(parseStockReconcileDocument({ ...document, issues: [{ row: 3, key: 'X', reason: 'mystery' }] })).toBeNull();
    expect(parseStockReconcileDocument({ ...document, items: [{ ...document.items[0], matchKind: 'name' }] })).toBeNull();
    expect(parseStockReconcileDocument({ ...document, id: 'not-a-uuid' })).toBeNull();
    // 회수·조정 항이 빠졌거나 음수 회수면 읽지 않는다(조정 합계는 음수일 수 있다).
    const withoutReturned: Record<string, unknown> = { ...document.items[0] };
    delete withoutReturned.returnedSinceQty;
    expect(parseStockReconcileDocument({ ...document, items: [withoutReturned] })).toBeNull();
    expect(parseStockReconcileDocument({ ...document, items: [{ ...document.items[0], awaitingReturnQty: -1 }] })).toBeNull();
    expect(parseStockReconcileDocument({ ...document, items: [{ ...document.items[0], adjustedSinceCount: -1 }] })).toBeNull();
  });

  it('행 상태: 부족은 지금 창고 실물보다 출고 대기가 많은 것이다', () => {
    expect(stockReconcileRowState({ stockQty: 10, difference: 1, targetQty: 11 })).toBe('increase');
    expect(stockReconcileRowState({ stockQty: 10, difference: -2, targetQty: 8 })).toBe('decrease');
    expect(stockReconcileRowState({ stockQty: 10, difference: 0, targetQty: 10 })).toBe('same');
    expect(stockReconcileRowState({ stockQty: 10, difference: -14, targetQty: 0 })).toBe('shortage');
    expect(stockReconcileShortage({ stockQty: 10, difference: -14 })).toBe(4);
  });

  it('반영 결과: 적용·충돌(미리보기 값·지금 값·이유)', () => {
    expect(parseStockReconcileApplyOutcome({ status: 'applied', replayed: false, snapshot: document })?.status).toBe('applied');
    const conflict = { variantId: 'v', goodsName: '키링', optionName: '핑크', optionCode: 'G1-01', previewStockQty: 10, currentStockQty: 9,
      previewPendingQty: 0, currentPendingQty: 1, previewTargetQty: 7, currentTargetQty: 6, previewDifference: -3, currentDifference: -3, reason: 'pending_changed' };
    expect(parseStockReconcileApplyOutcome({ status: 'conflict', conflicts: [conflict] })).toEqual({ status: 'conflict', conflicts: [conflict] });
    for (const reason of ['stock_changed', 'pending_and_stock_changed', 'goods_archived', 'option_stopped']) {
      expect(parseStockReconcileApplyOutcome({ status: 'conflict', conflicts: [{ ...conflict, reason }] })?.status).toBe('conflict');
    }
    // 옛 이유(changed)·지금 값이 빠진 모양·음수 재고는 읽지 않는다.
    expect(parseStockReconcileApplyOutcome({ status: 'conflict', conflicts: [{ ...conflict, reason: 'changed' }] })).toBeNull();
    const withoutCurrent: Record<string, unknown> = { ...conflict };
    delete withoutCurrent.currentTargetQty;
    expect(parseStockReconcileApplyOutcome({ status: 'conflict', conflicts: [withoutCurrent] })).toBeNull();
    expect(parseStockReconcileApplyOutcome({ status: 'conflict', conflicts: [{ ...conflict, currentStockQty: -1 }] })).toBeNull();
    expect(parseStockReconcileApplyOutcome({ status: 'applied', snapshot: document })).toBeNull();
  });

  it('반영한 기록은 반영 시점 값으로 결과 표를 그린다', () => {
    const applied = { ...document.items[0], fileQty: 9, stockQty: 10, pendingQty: 2, shippedSinceQty: 0, targetQty: 7, difference: -3, appliedDelta: -3, stockAfter: 7,
      stockBefore: 10, appliedPendingQty: 0, appliedShippedSinceQty: 2, appliedReturnedSinceQty: 0, appliedAwaitingReturnQty: 0 };
    const parsed = parseStockReconcileDocument({ ...document, appliedAt: '2031-05-01T00:10:00+00:00', items: [applied] });
    expect(parsed?.items[0]).toMatchObject({ stockBefore: 10, appliedPendingQty: 0, appliedShippedSinceQty: 2 });
    expect(stockReconcileDisplayItem(parsed!.items[0], true)).toMatchObject({ stockQty: 10, pendingQty: 0, shippedSinceQty: 2, targetQty: 7 });
    // 반영 전 미리보기·옛 기록(반영 시점 값 없음)은 그대로다.
    expect(stockReconcileDisplayItem(parsed!.items[0], false)).toMatchObject({ pendingQty: 2, shippedSinceQty: 0 });
    const preview = parseStockReconcileDocument(document)!.items[0];
    expect(preview).toMatchObject({ stockBefore: null, appliedPendingQty: null });
    expect(stockReconcileDisplayItem(preview, true)).toBe(preview);
    // 반영할 것이 없던 옵션은 반영 뒤에도 반영 전 재고수량 그대로다(주문으로 함께 움직인 값).
    const same = { ...document.items[0], stockQty: 4, targetQty: 4, difference: 0, stockBefore: 3, appliedPendingQty: 1, appliedShippedSinceQty: 0,
      appliedReturnedSinceQty: 0, appliedAwaitingReturnQty: 0 };
    expect(stockReconcileDisplayItem(parseStockReconcileDocument({ ...document, items: [same] })!.items[0], true)).toMatchObject({ stockQty: 3, targetQty: 3, pendingQty: 1 });
    // 반영 시점 값은 다섯 칸이 함께 있어야 한다.
    expect(parseStockReconcileDocument({ ...document, items: [{ ...applied, appliedPendingQty: null }] })).toBeNull();
    expect(parseStockReconcileDocument({ ...document, items: [{ ...applied, stockBefore: -1 }] })).toBeNull();
  });

  it('출고 전 경고 문서', () => {
    const warnings = parseStockDispatchWarnings({ originId: null, minDifference: 1, checkedAt: '2031-05-01T00:00:00Z', batchVariantCount: 2,
      latestAsOf: '2031-05-01T00:00:00Z', unreconciledCount: 1,
      warnings: [{ variantId: 'v1', goodId: 'g', goodsCode: 'G1', goodsName: '키링', optionName: '핑크', optionCode: 'G1-01', kind: 'shortage',
        snapshotId: 's', asOf: '2031-05-01T00:00:00Z', fileQty: 5, stockQty: 10, pendingQty: 9, shippedSinceQty: 0, returnedSinceQty: 1,
        awaitingReturnQty: 1, expectedQty: 5, difference: -14, shortageQty: 4 }],
      unreconciled: [{ variantId: 'v4', goodsName: '배지', optionName: '기본 옵션', optionCode: 'G4-01', pendingQty: 1 }] });
    expect(warnings?.warnings[0]).toMatchObject({ kind: 'shortage', shortageQty: 4, returnedSinceQty: 1, awaitingReturnQty: 1 });
    expect(warnings?.unreconciled).toHaveLength(1);
    expect(parseStockDispatchWarnings({ checkedAt: 'x', warnings: [], unreconciled: [] })).toBeNull();
  });

  it('DB 오류 코드를 운영 문구로 바꾼다', () => {
    expect(stockReconcileErrorMessage({ code: '42501', message: 'operator_capability_required' })).toBe('재고를 대조할 권한이 없습니다.');
    expect(stockReconcileErrorMessage({ code: 'PT409', message: 'stock_reconcile_already_applied' })).toContain('이미 반영한');
    expect(stockReconcileErrorMessage({ code: '23514', message: 'stock_reconcile_expired' })).toContain('24시간');
    expect(stockReconcileErrorMessage({ code: 'XX000', message: 'boom' })).toContain('잠시 후');
  });
});
