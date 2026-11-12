import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { adminClaimBulkRefundTotals, type AdminClaimBulkRefundRow } from '@/lib/admin/claim-bulk';
import { CollectStep, RefundStep } from './ClaimBulkStepDialog';

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
    expect(html).toContain('제외 1건');
    expect(html).toContain('제외 · 무통장 입금 결제는 결제사 취소가 없습니다.');
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
    expect(html).toContain('<strong>2건</strong> · 출고지 3곳 · 입고일 <span class="tabular-nums">2026-11-11</span> · 제외 1건');
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
