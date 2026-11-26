import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { adminClaimBulkApproveTotals, adminClaimBulkRefundTotals, type AdminClaimBulkApproveRow, type AdminClaimBulkRefundRow } from '@/lib/admin/claim-bulk';
import { ApproveStep, CollectStep, RefundStep } from './ClaimBulkStepDialog';

/*
 * 단계 일괄 처리 확인창의 본문(1027T-033·SHEET-049·SHEET-052). 결정 원문: "확인창에 건수·환불 합계, 무통장·가상계좌는
 * 제외 사유 표시." — 합계와 제외 사유는 서버 값 그대로 보이고, 확정 버튼에 건수와 합계가 함께 적힌다.
 */

const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const C = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const S1 = '5a1e0000-0000-4000-8000-000000000001';
const S2 = '5a1e0000-0000-4000-8000-000000000002';
const noop = () => undefined;

describe('환불 완료 확정 확인창', () => {
  const rows: AdminClaimBulkRefundRow[] = [
    { claimId: A, reference: 'C00001', providerLabel: '토스페이먼츠', amount: 12000, blocker: null },
    { claimId: B, reference: 'C00002', providerLabel: '토스페이먼츠', amount: 8000, blocker: null },
    { claimId: C, reference: 'C00003', providerLabel: '무통장 입금', amount: 5000, blocker: '무통장 입금 결제는 결제사 취소가 없습니다.' },
  ];

  it('처리 건수·환불 합계(결제사별)와 제외 사유를 보이고, 확정 버튼에 같은 건수·합계를 적는다', () => {
    const html = renderToStaticMarkup(<RefundStep onRun={noop} preview={{ step: 'refund', rows, totals: adminClaimBulkRefundTotals(rows) }} progress={0} running={false} />);
    expect(html).toContain('확정하면 되돌릴 수 없습니다');
    expect(html).toMatch(/처리 <strong[^>]*>2건<\/strong> · 환불 합계 <strong[^>]*>₩20,000<\/strong>/);
    expect(html).toContain('토스페이먼츠 2건 · ');
    expect(html).toContain('건너뜀 1건');
    expect(html).toContain('건너뜀 · 무통장 입금 결제는 결제사 취소가 없습니다.');
    expect(html).not.toContain('제외');
    expect(html).toMatch(/<button[^>]*>2건 환불 완료 확정 \(합계 ₩20,000\)<\/button>/);
  });

  it('처리할 건이 없거나 처리 중이면 확정 버튼을 잠근다', () => {
    const excluded = rows.filter((row) => row.blocker);
    const none = renderToStaticMarkup(<RefundStep onRun={noop} preview={{ step: 'refund', rows: excluded, totals: adminClaimBulkRefundTotals(excluded) }} progress={0} running={false} />);
    expect(none).toMatch(/<button[^>]*disabled=""[^>]*>0건 환불 완료 확정/);
    const busy = renderToStaticMarkup(<RefundStep onRun={noop} preview={{ step: 'refund', rows, totals: adminClaimBulkRefundTotals(rows) }} progress={1} running />);
    expect(busy).toContain('처리 중… 결제사 취소를 한 건씩 순서대로 확인합니다(1건 끝).');
    expect(busy).toMatch(/<button[^>]*disabled=""[^>]*>2건 환불 완료 확정/);
  });
});

/* A-1(일괄): 단순 변심 반품의 환불 금액은 반품배송비를 뺀 값이라, 결제사가 부분 취소를 받지 않으면 합계가 그보다 커진다 — 확인창이 미리 말한다. */
describe('반품배송비를 뺀 환불 행', () => {
  const rows: AdminClaimBulkRefundRow[] = [
    { claimId: A, reference: 'C00001', providerLabel: '토스페이먼츠', amount: 27000, deductionAmount: 3000, blocker: null },
    { claimId: B, reference: 'C00002', providerLabel: '토스페이먼츠', amount: 12000, blocker: null },
    { claimId: C, reference: 'C00003', providerLabel: '토스페이먼츠', amount: 9000, deductionAmount: 3000, blocker: '보류 중인 요청입니다.' },
  ];
  it('부분 취소를 받지 않는 결제는 전액을 환불해 합계가 최대 얼마까지 느는지 말한다(건너뛰는 행은 세지 않는다)', () => {
    const html = renderToStaticMarkup(<RefundStep onRun={noop} preview={{ step: 'refund', rows, totals: adminClaimBulkRefundTotals(rows) }} progress={0} running={false} />);
    expect(html).toMatch(/환불 합계 <strong[^>]*>₩39,000<\/strong>/);
    expect(html).toContain('data-claim-bulk-refund-full=""');
    expect(html).toMatch(/합계가 최대 <span[^>]*>₩42,000<\/span>까지 늘 수 있습니다\. 못 뺀 반품배송비는 배송비 청구로 따로 받습니다\./);
    expect(html).toContain('단순 변심 반품은 반품배송비를 뺀 환불 금액만 부분 취소합니다.');
    /* 차감이 없는 목록에는 이 줄이 없다. */
    const plain = rows.slice(1, 2);
    expect(renderToStaticMarkup(<RefundStep onRun={noop} preview={{ step: 'refund', rows: plain, totals: adminClaimBulkRefundTotals(plain) }} progress={0} running={false} />)).not.toContain('data-claim-bulk-refund-full');
  });
});

describe('부분 반품 환불 행(CLM-136)', () => {
  it('부분 반품은 고른 상품 몫을 금액으로 보이고 전액 취소가 아님을 알린다', () => {
    const rows: AdminClaimBulkRefundRow[] = [
      { claimId: A, reference: 'C00001', providerLabel: '토스페이먼츠', amount: 6500, deductionAmount: 3000, partialReturn: true, blocker: null },
      { claimId: B, reference: 'C00002', providerLabel: '토스페이먼츠', amount: 12000, blocker: null },
    ];
    const html = renderToStaticMarkup(<RefundStep onRun={noop} preview={{ step: 'refund', rows, totals: adminClaimBulkRefundTotals(rows) }} progress={0} running={false} />);
    expect(html).toMatch(/환불 합계 <strong[^>]*>₩18,500<\/strong>/);
    expect(html).toContain('data-claim-bulk-partial-return=""');
    expect(html).toContain('부분 반품 · 고른 상품 몫');
    expect(html).toContain('부분 반품은 전액 취소가 아니라 고객이 고른 상품 몫');
    /* 부분 반품은 부분 취소를 받지 않아도 전액으로 돌리지 않는다 — 합계가 늘 수 있다는 줄을 달지 않는다. */
    expect(html).not.toContain('data-claim-bulk-refund-full');
    const whole = renderToStaticMarkup(<RefundStep onRun={noop} preview={{ step: 'refund', rows: rows.slice(1), totals: adminClaimBulkRefundTotals(rows.slice(1)) }} progress={0} running={false} />);
    expect(whole).not.toContain('부분 반품');
  });
});

describe('회수 확인 확인창', () => {
  const rows = [
    { claimId: A, reference: 'C00001', targets: [{ shipmentId: S1, originName: 'TEST 김포' }, { shipmentId: S2, originName: 'TEST 남양주' }], skipped: [], blocker: null },
    { claimId: B, reference: 'C00002', targets: [{ shipmentId: null, originName: null }], skipped: [], blocker: null },
    { claimId: C, reference: 'C00003', targets: [], skipped: [], blocker: '승인 전 요청입니다. 승인한 뒤 회수를 확인해주세요.' },
  ];
  function render(unchecked: Record<string, boolean> = {}) {
    return renderToStaticMarkup(<CollectStep evidence="" evidenceId="evidence" inputError="" onEvidence={noop} onReceivedOn={noop} onRun={noop} onToggle={noop}
      progress={0} receivedId="received" receivedOn="2026-11-11" rows={rows} running={false} today="2026-11-12" unchecked={unchecked} />);
  }

  it('건수·출고지 수·입고일을 확인 줄과 실행 버튼에 함께 적고, 뺀 요청은 사유를 보인다', () => {
    const html = render();
    expect(html).toContain('<strong>2건</strong> · 출고지 3곳 · 입고일 <span class="tabular-nums">2026-11-11</span> · 건너뜀 1건');
    expect(html).toContain('건너뜀 · 남는 출고지');
    expect(html).toMatch(/<button[^>]*>2건 회수 확인 \(입고일 2026-11-11\)<\/button>/);
    expect(html).toContain('주문 전체');
    expect(html).toContain('승인 전 요청입니다. 승인한 뒤 회수를 확인해주세요.');
    /* 입고일은 오늘(KST)까지만 고를 수 있다. */
    expect(html).toMatch(/<input[^>]*type="date"[^>]*max="2026-11-12"|<input[^>]*max="2026-11-12"[^>]*type="date"/);
  });

  it('출고지를 빼면 건수와 출고지 수가 줄고, 모두 빼면 실행할 수 없다', () => {
    expect(render({ [`${A}:${S2}`]: true })).toContain('<strong>2건</strong> · 출고지 2곳');
    const none = render({ [`${A}:${S1}`]: true, [`${A}:${S2}`]: true, [`${B}:order`]: true });
    expect(none).toContain('<strong>0건</strong> · 출고지 0곳');
    expect(none).toMatch(/<button[^>]*disabled=""[^>]*>0건 회수 확인/);
  });
});

/*
 * 취소 일괄 승인 확인창(L-08). 승인하는 즉시 결제사에 전액 취소가 나가므로 환불 확정 확인창과 같은 모양으로 건수·취소 금액 합계·
 * 건너뛰는 건과 이유를 서버 값 그대로 보이고, 버튼에 같은 건수·합계를 적는다.
 */
describe('취소 승인 확인창', () => {
  const rows: AdminClaimBulkApproveRow[] = [
    { claimId: A, reference: 'C00001', providerLabel: '토스페이먼츠', amount: 30000, providerCancel: true, effect: '승인하고 토스 전액 취소를 요청합니다', blocker: null },
    { claimId: B, reference: 'C00002', providerLabel: '나이스페이', amount: 12000, providerCancel: true, effect: '승인하고 나이스페이 전액 취소를 요청합니다', blocker: null },
    { claimId: C, reference: 'C00003', providerLabel: '토스페이먼츠', amount: 8000, providerCancel: true, effect: '승인하고 토스 전액 취소를 요청합니다', blocker: '이미 승인한 요청입니다.' },
  ];
  const render = (list = rows, running = false) => renderToStaticMarkup(<ApproveStep onRun={noop} preview={{ step: 'approve', rows: list, totals: adminClaimBulkApproveTotals(list) }} progress={1} running={running} />);

  it('승인 건수·취소 금액 합계(결제 방식별)와 건너뛰는 건·이유를 보이고, 버튼에 같은 건수·합계를 적는다', () => {
    const html = render();
    expect(html).toContain('승인하면 되돌릴 수 없습니다');
    expect(html).toMatch(/승인 <strong[^>]*>2건<\/strong> · 취소 금액 합계 <strong[^>]*>₩42,000<\/strong>/);
    expect(html).toContain('토스페이먼츠 1건');
    expect(html).toContain('결제사에 취소 요청');
    expect(html).toContain('건너뜀 1건');
    expect(html).toContain('건너뜀 · 이미 승인한 요청입니다.');
    expect(html).toContain('승인하고 나이스페이 전액 취소를 요청합니다');
    expect(html).toMatch(/<button[^>]*>2건 취소 승인 \(합계 ₩42,000\)<\/button>/);
    /* 결제사 이름은 이름표에서 읽는다 — 나이스페이 결제에 토스라고만 말하지 않는다. */
    expect(html).toContain('토스·나이스페이 결제는 승인하는 즉시');
    expect(html).not.toContain('제외');
  });

  it('무통장·결제 없음은 승인만 하고, 결제가 없는 주문만 고르면 합계 없이 건수만 적는다', () => {
    const only: AdminClaimBulkApproveRow[] = [
      { claimId: A, reference: 'C00001', providerLabel: '무통장 입금', amount: 7000, providerCancel: false, effect: '승인만 합니다(환불은 계좌 송금으로 따로 진행합니다)', blocker: null },
      { claimId: B, reference: 'C00002', providerLabel: '결제 없음', amount: null, providerCancel: false, effect: '승인만 합니다(결제 전 주문이라 결제사 취소가 없습니다)', blocker: null },
    ];
    const html = render(only);
    expect(html).toContain('무통장 입금 1건');
    expect(html).toContain('— 승인만');
    expect(html).toMatch(/<button[^>]*>2건 취소 승인 \(합계 ₩7,000\)<\/button>/);
    const free = render(only.slice(1));
    expect(free).toMatch(/<button[^>]*>1건 취소 승인<\/button>/);
    expect(free).not.toContain('합계 ₩');
  });

  it('승인할 건이 없거나 처리 중이면 버튼을 잠그고, 처리 중에는 한 건씩 확인한다고 알린다', () => {
    expect(render(rows.slice(2))).toMatch(/<button[^>]*disabled=""[^>]*>0건 취소 승인/);
    const busy = render(rows, true);
    expect(busy).toContain('처리 중… 결제사 취소를 한 건씩 순서대로 확인합니다(1건 끝).');
    expect(busy).toMatch(/<button[^>]*disabled=""[^>]*>2건 취소 승인/);
  });
});
