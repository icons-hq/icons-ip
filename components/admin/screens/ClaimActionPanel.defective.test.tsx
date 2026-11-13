import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { adminClaimBulkDefectiveItemIds, adminClaimBulkRefundTotals, type AdminClaimBulkRefundRow } from '@/lib/admin/claim-bulk';
import type { ClaimDefectiveStock } from '@/lib/admin/defective-stock';
import { ClaimActionPanel, type ClaimActionPanelProps } from './ClaimActionPanel';
import { RefundStep } from './ClaimBulkStepDialog';

vi.mock('@/app/admin/claim-actions', () => ({
  decideOrderClaimAction: vi.fn(),
  recordOrderClaimCollectionAction: vi.fn(),
  recordOrderClaimOriginCollectionAction: vi.fn(),
  recordOrderClaimRefundAction: vi.fn(),
  recordOrderClaimReshipmentAction: vi.fn(),
  planClaimDefectiveStockAction: vi.fn(),
  retryClaimDefectiveStockAction: vi.fn(),
}));
vi.mock('@/app/admin/claim-bulk-step-actions', () => ({
  previewOrderClaimBulkStepAction: vi.fn(), runOrderClaimBulkCollectionsAction: vi.fn(), runOrderClaimBulkRefundsAction: vi.fn(),
}));

/*
 * 반품 불량 재고 분리(QNA-035)의 화면: 환불 확정 양식과 일괄 확인창의 품목별 '판매 재고 복원/불량' 선택(기본 복원).
 * 선택 데이터가 없으면(반품이 아니거나 읽지 못함) 패널은 지금과 한 글자도 같다.
 */

const CLAIM_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const ORDER_ID = '11111111-1111-4111-8111-111111111111';
const ITEM_A = 'aaaa0001-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const ITEM_B = 'bbbb0002-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

function props(overrides: Partial<ClaimActionPanelProps> = {}): ClaimActionPanelProps {
  return {
    cancellationForm: null, carriers: [], claimId: CLAIM_ID, claimType: 'return', collectionComplete: true, collectionPolicy: 'legacy',
    collectedAt: '2026-11-12T00:00:00.000Z', collections: [], heldFrom: null, orderId: ORDER_ID, paymentProvider: 'toss',
    recordedRefundMethod: null, refundCompleted: false, refundFiled: true, refundLedgerOpen: true, stage: 'processing', refundAmount: 30000,
    ...overrides,
  };
}
const render = (overrides: Partial<ClaimActionPanelProps> = {}) => renderToStaticMarkup(<ClaimActionPanel {...props(overrides)} />);

const stock = (overrides: Partial<ClaimDefectiveStock> = {}): ClaimDefectiveStock => ({
  claimId: CLAIM_ID, frozen: false, pending: 0, items: [
    { orderItemId: ITEM_A, name: '아크릴 키링', variantName: '파랑', qty: 2, defective: false, state: null },
    { orderItemId: ITEM_B, name: '엽서', variantName: null, qty: 1, defective: false, state: null },
  ], ...overrides,
});

describe('ClaimActionPanel — 품목별 재고 처리', () => {
  it('선택 데이터가 없으면 지금과 같은 패널이다', () => {
    const base = render();
    expect(render({ defectiveStock: null })).toBe(base);
    expect(base).not.toContain('품목별 재고 처리');
    expect(base).not.toContain('stockDisposition:');
  });

  it('환불 확정 양식에 품목마다 판매 재고 복원(기본)/불량 선택을 싣는다', () => {
    const html = render({ defectiveStock: stock() });
    expect(html).toContain('data-claim-defective-stock');
    expect(html).toContain(`name="stockDisposition:${ITEM_A}"`);
    expect(html).toContain(`name="stockDisposition:${ITEM_B}"`);
    expect(html).toContain('아크릴 키링 · 파랑 · 2개');
    expect(html).toContain('불량으로 고른 품목은 판매 재고에 넣지 않고 불량 재고 목록에 따로 기록합니다.');
    expect(html).toMatch(/<option value="restore"[^>]*selected|<option selected=""[^>]*value="restore"/);
    expect(html).toContain('판매 재고 복원');
  });

  it('저장된 불량 선택은 그대로 선택된 채로 보이고, 이미 기록된 품목은 선택 칸에서 뺀다', () => {
    const html = render({ defectiveStock: stock({ items: [
      { orderItemId: ITEM_A, name: '아크릴 키링', variantName: null, qty: 2, defective: true, state: 'planned' },
      { orderItemId: ITEM_B, name: '엽서', variantName: null, qty: 1, defective: true, state: 'recorded' },
    ] }) });
    expect(html).toContain(`name="stockDisposition:${ITEM_A}"`);
    expect(html).not.toContain(`name="stockDisposition:${ITEM_B}"`);
    expect(html).toMatch(/<option[^>]*value="defective"[^>]*selected|<option selected=""[^>]*value="defective"/);
  });

  it('반품이 아니면 선택 칸을 그리지 않는다', () => {
    expect(render({ claimType: 'cancel', defectiveStock: stock() })).not.toContain('품목별 재고 처리');
  });

  it('이미 종결된 클레임의 확정 양식에는 선택 칸이 없고, 기록이 남았으면 다시 시도 안내를 보인다', () => {
    const done = render({ stage: 'completed', defectiveStock: stock({ pending: 1, frozen: true }) });
    expect(done).not.toContain('data-claim-defective-stock');
    expect(done).toContain('data-claim-defective-pending');
    expect(done).toContain('불량 기록 필요');
    expect(done).toContain('불량 기록 다시 시도');
    expect(done).toContain('환불은 다시 하지 말고');
    expect(render({ stage: 'completed', defectiveStock: stock({ pending: 0, frozen: true }) })).not.toContain('data-claim-defective-pending');
  });

  it('종결된 반품의 불량 기록 필요는 접힌 환불 단계가 아니라 맨 위 상태 칸에 있다(QA2 M1)', () => {
    const done = render({ stage: 'completed', refundCompleted: true, defectiveStock: stock({ pending: 1, frozen: true }) });
    const attention = done.indexOf('data-claim-workspace-attention');
    const pending = done.indexOf('data-claim-defective-pending');
    expect(attention).toBeGreaterThan(-1);
    expect(pending).toBeGreaterThan(attention);
    /* 단계 칸(nav)·접힌 단계(details)보다 앞에 있다. */
    expect(pending).toBeLessThan(done.indexOf('aria-label="반품 처리 단계"'));
    expect(pending).toBeLessThan(done.indexOf('<details'));
    expect(done.match(/data-claim-defective-pending/g)).toHaveLength(1);
    expect(done).toContain('반품과 환불은 완료됐습니다. 아래 남은 일을 처리해주세요.');
    /* 기록이 끝났으면 상태 칸은 지금 문구 그대로다. */
    const clean = render({ stage: 'completed', refundCompleted: true, defectiveStock: stock({ pending: 0, frozen: true }) });
    expect(clean).not.toContain('data-claim-workspace-attention');
    expect(clean).toContain('반품과 환불 완료 기록을 확인했습니다.');
  });

  it('재고가 정해진 뒤(주문 canceled·무통장 취소 확정)에는 선택 칸·저장 양식을 그리지 않는다', () => {
    const frozen = stock({ frozen: true });
    expect(render({ defectiveStock: frozen })).not.toContain('data-claim-defective-stock');
    expect(render({ bankTransfer: true, actorId: 'staff-1', paymentProvider: 'bank_transfer', defectiveStock: frozen })).not.toContain('품목별 재고 처리 저장');
  });

  it('무통장 환불은 확정 양식이 따로라 선택만 저장하는 양식을 보인다', () => {
    const html = render({ bankTransfer: true, actorId: 'staff-1', paymentProvider: 'bank_transfer', defectiveStock: stock() });
    expect(html).toContain('품목별 재고 처리 저장');
    expect(html).toContain('[취소 확정]을 누를 때 재고가 복원되고 불량 재고도 함께 기록됩니다');
  });
});

describe('일괄 환불 확인창 — 품목별 재고 처리', () => {
  const rows: AdminClaimBulkRefundRow[] = [
    { claimId: CLAIM_ID, reference: 'C00001', providerLabel: '토스페이먼츠', amount: 12000, blocker: null, items: stock().items },
    { claimId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', reference: 'C00002', providerLabel: '토스페이먼츠', amount: 8000, blocker: null },
  ];
  const preview = { step: 'refund' as const, rows, totals: adminClaimBulkRefundTotals(rows) };

  it('품목이 있는 행 아래에 기본 복원 선택을 보이고, 품목이 없는 행과 기존 호출은 그대로다', () => {
    const html = renderToStaticMarkup(<RefundStep defective={{}} onDefective={() => undefined} onRun={() => undefined} preview={preview} progress={0} running={false} />);
    expect(html).toContain('data-claim-bulk-stock');
    expect(html).toContain('품목별 재고 처리 · C00001');
    expect(html).toContain('아크릴 키링 · 파랑 · 2개');
    expect(html.match(/data-claim-bulk-stock/g)).toHaveLength(1);
    const withoutHandler = renderToStaticMarkup(<RefundStep onRun={() => undefined} preview={preview} progress={0} running={false} />);
    expect(withoutHandler).not.toContain('data-claim-bulk-stock');
  });

  it('저장된 불량 선택은 화면에 보이는 값 그대로 실행 입력이 된다(표시값=전송값)', () => {
    const items = [
      { orderItemId: ITEM_A, name: 'a', variantName: null, qty: 1, defective: true, state: 'planned' as const },
      { orderItemId: ITEM_B, name: 'b', variantName: null, qty: 1, defective: false, state: null },
    ];
    const shown = (defective: Record<string, boolean>) => adminClaimBulkDefectiveItemIds(items, defective);
    expect(shown({})).toEqual([ITEM_A]);
    expect(shown({ [ITEM_A]: false, [ITEM_B]: true })).toEqual([ITEM_B]);
    const html = renderToStaticMarkup(<RefundStep defective={{}} onDefective={() => undefined} onRun={() => undefined}
      preview={{ step: 'refund', rows: [{ ...rows[0], items }], totals: adminClaimBulkRefundTotals([rows[0]]) }} progress={0} running={false} />);
    expect(html).toMatch(new RegExp(`id="bulk-stock-${ITEM_A}"[^>]*>(<option[^>]*>[^<]*</option>)*`));
    expect(html).toMatch(/<option[^>]*value="defective"[^>]*selected|<option selected=""[^>]*value="defective"/);
  });

  it('고른 불량 품목이 선택 상태로 보이고 처리 중에는 잠긴다', () => {
    const html = renderToStaticMarkup(<RefundStep defective={{ [ITEM_A]: true }} onDefective={() => undefined} onRun={() => undefined} preview={preview} progress={0} running />);
    const select = html.match(new RegExp(`<select[^>]*id="bulk-stock-${ITEM_A}"[^>]*>`));
    expect(select?.[0]).toContain('disabled');
    expect(html).toMatch(/<option[^>]*value="defective"[^>]*selected|<option selected=""[^>]*value="defective"/);
  });
});
