import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import { RefundTransfersScreen } from './RefundTransfersScreen';
it('separates gift payer from requester and links to existing claim detail', () => {
  const html = renderToStaticMarkup(<RefundTransfersScreen data={{ page: 1, pageSize: 50, total: 51, rows: [{
    claimId: 'a1010000-0000-4000-8000-000000000001', orderId: 'a1010000-0000-4000-8000-000000000002', reference: 45, claimType: 'return', amount: 12000,
    confirmedAt: '2026-10-14T06:00:00Z', filedAt: null, updatedAt: '2026-10-14T06:00:00Z', revision: 1, gift: true, payerName: '결제자별명', requesterName: '수령자별명',
  }] }} />);
  for (const label of ['결제자별명', '수령자별명', '선물 · 반품', '송금할 금액', '12,000', '접수 전', '요청 C00045']) expect(html).toContain(label);
  expect(html).toContain('/admin/sales/claims/returns/a1010000-0000-4000-8000-000000000001');
  expect(html).toContain('/admin/sales/claims/refund-transfers?page=2');
  expect(html).not.toContain('계좌번호');
  /* 송금 완료를 적는 칸은 이 목록에 없다 — 버튼은 어느 화면에서 기록하는지만 말한다. */
  expect(html).toContain('>요청 상세에서 기록<');
  for (const old of ['송금 대기 금액', '미접수', '이름 미등록', '송금 처리', '송금 완료 확정']) expect(html, old).not.toContain(old);
});
it('목록 엑셀은 다른 목록과 같은 비밀번호 내려받기 버튼으로 전체 송금 대기 요청을 받는다(1007-047·048)', () => {
  const html = renderToStaticMarkup(<RefundTransfersScreen data={{ page: 2, pageSize: 50, total: 51, rows: [] }} />);
  // 페이지와 무관하게 전체 목록을 받는다. 화면에는 계좌 원문을 그리지 않는다.
  expect(html).toContain('data-export-href="/api/admin/list-export?screen=refund-transfers"');
  expect(html).toContain('목록 엑셀 다운로드');
  expect(html).toContain('전체 51건');
  expect(html).toContain('받거나 볼 때마다 누가 언제 봤는지 요청별로 기록이 남습니다.');
  expect(html).not.toContain('계좌번호');
  /* 메뉴설명은 화면에 보이지 않는 것만 말한다: 계좌를 받는 곳·열람 기록, 목록에서 빠지는 조건, 선물 주문의 받는 사람. */
  expect(html).toContain('취소는 확정됐고 은행 송금만 남은 무통장 환불입니다.');
  expect(html).toContain('[송금 완료 기록]을 남겨야 이 목록에서 빠집니다. 선물 주문도 결제자에게 보냅니다.');
  expect((html.match(/<p>/g) ?? []).length).toBe(2);
});
it('대기 일수는 24시간이 아니라 한국 달력으로 센다', () => {
  const row = { claimId: 'a1010000-0000-4000-8000-000000000001', orderId: 'a1010000-0000-4000-8000-000000000002', reference: 45, claimType: 'cancel' as const, amount: 12000,
    confirmedAt: '2026-10-13T14:30:00Z', filedAt: '2026-10-13T14:30:00Z', updatedAt: '2026-10-13T14:30:00Z', revision: 1, gift: false, payerName: '결제자', requesterName: '요청자' };
  /* 전날 23시 30분(KST) 확정 건은 2시간 뒤 자정을 넘기면 오늘이 아니다. */
  const next = renderToStaticMarkup(<RefundTransfersScreen now={new Date('2026-10-13T16:30:00Z')} data={{ page: 1, pageSize: 50, total: 1, rows: [row] }} />);
  expect(next).toContain('1일째'); expect(next).not.toContain('>오늘<');
  expect(renderToStaticMarkup(<RefundTransfersScreen now={new Date('2026-10-13T14:40:00Z')} data={{ page: 1, pageSize: 50, total: 1, rows: [row] }} />)).toContain('>오늘<');
});
it('보낼 돈 합계와 오래 기다린 요청·이름 없는 결제자를 주의로 보이고 송금 처리는 요청 상세로 잇는다', () => {
  const row = { claimId: 'a1010000-0000-4000-8000-000000000001', orderId: 'a1010000-0000-4000-8000-000000000002', reference: 45, claimType: 'cancel' as const, amount: 12000,
    confirmedAt: '2026-10-10T06:00:00Z', filedAt: '2026-10-10T06:00:00Z', updatedAt: '2026-10-10T06:00:00Z', revision: 1, gift: false, payerName: null, requesterName: '요청자' };
  const html = renderToStaticMarkup(<RefundTransfersScreen now={new Date('2026-10-14T06:00:00Z')} data={{ page: 1, pageSize: 50, total: 2, rows: [row, { ...row, claimId: 'a1010000-0000-4000-8000-000000000003', orderId: 'a1010000-0000-4000-8000-000000000004', amount: 3000, confirmedAt: '2026-10-14T01:00:00Z', payerName: '결제자' }] }} />);
  expect(html).toContain('보낼 돈 합계');
  expect(html).toContain('₩15,000');
  expect(html).toContain('3일 이상 기다린 요청 1건');
  expect(html).toMatch(/data-tone="warning"[^>]*>4일째</);
  expect(html).toMatch(/data-tone="warning"[^>]*>이름 없음</);
  expect(html).toContain('결제자 이름이 없는 1건은 송금 전에 상세에서 확인해주세요.');
  expect(html).toContain('href="/admin/sales/claims/cancels/a1010000-0000-4000-8000-000000000001#claim-process"');
  expect(html).toContain('>요청 상세에서 기록<');
  expect(html).toContain('aria-label="요청 C00045 상세에서 계좌를 보고 송금을 기록"');
  /* 다른 페이지가 남아 있으면 전체 합계로 부르지 않는다. */
  const partial = renderToStaticMarkup(<RefundTransfersScreen now={new Date('2026-10-14T06:00:00Z')} data={{ page: 1, pageSize: 50, total: 51, rows: [row] }} />);
  expect(partial).toContain('이 페이지 보낼 돈 합계');
  expect(partial).toContain('전체 51건 중 이 페이지 1건');
});
it('부분 환불 줄은 유형이 차수를 말하고, 번호 칸에는 주문번호만 두며 주문 상세에서 기록하게 잇는다(R-03)', () => {
  const partial = { kind: 'partial_cancellation' as const, partialCancellationId: 'a1010000-0000-4000-8000-000000000009', orderId: 'a1010000-0000-4000-8000-000000000002',
    sequence: 2, reasonCode: 'return' as const, amount: 9500, confirmedAt: '2026-10-14T06:00:00Z', filedAt: null, updatedAt: '2026-10-14T06:00:00Z', gift: false, payerName: '결제자' };
  const html = renderToStaticMarkup(<RefundTransfersScreen now={new Date('2026-10-14T06:00:00Z')} data={{ page: 1, pageSize: 50, total: 1, rows: [partial] }} />);
  expect(html).toContain('부분 반품 2차');
  expect(html).not.toContain('요청 C');
  expect(html).toContain('href="/admin/sales/orders/a1010000-0000-4000-8000-000000000002#partial-cancellation"');
  expect(html).toContain('>주문 상세에서 기록<');
  /* 부분 환불에는 접수 단계가 따로 없어 '접수 전' 주의를 달지 않는다. */
  expect(html).not.toContain('접수 전');
  expect(html).toContain('운영자 처리');
});

/* F-09: 표가 1366px 화면의 틀(약 1016px)보다 넓어 '환불 접수일' 시각이 잘리고 '요청자'가 가로로 밀렸다. 열 폭 합계를 틀 안으로 줄이고, 날짜와 시각은 두 줄로 나눈다. */
it('열 폭 합계가 1366px 화면의 틀(약 1016px) 안에 들고, 취소 확정일·환불 접수일은 날짜와 시각을 두 줄로 보인다', () => {
  const row = { claimId: 'a1010000-0000-4000-8000-000000000001', orderId: 'a1010000-0000-4000-8000-000000000002', reference: 45, claimType: 'cancel' as const, amount: 12000,
    confirmedAt: '2026-10-14T06:00:00Z', filedAt: '2026-10-14T07:30:00Z', updatedAt: '2026-10-14T07:30:00Z', revision: 1, gift: false, payerName: '결제자', requesterName: '요청자' };
  const html = renderToStaticMarkup(<RefundTransfersScreen now={new Date('2026-10-14T08:00:00Z')} data={{ page: 1, pageSize: 50, total: 1, rows: [row] }} />);
  const widths = [...html.matchAll(/<col style="width:(\d+)px"\/>/g)].map(match => Number(match[1]));
  expect(widths).toHaveLength(9);
  /* 틀(1016px)보다 20px 넘게 작게 둔다 — 열이 안의 글 때문에 정한 폭보다 넓어지는 만큼의 여유다(R-8: 합 1004에서도 1366px에서 '요청자'가 잘렸다). */
  expect(widths.reduce((sum, width) => sum + width, 0)).toBeLessThanOrEqual(990);
  /* 영문 아이디처럼 줄이 안 바뀌는 이름이 열을 넓히지 않게 결제자·요청자는 어디서든 줄을 바꾼다. */
  expect(html).toContain('<span class="wrap-anywhere">결제자</span>'); expect(html).toContain('<span class="wrap-anywhere">요청자</span>');
  expect([...html.matchAll(/data-date-time=""><span>([^<]*)<\/span><span[^>]*>(\d{2}:\d{2})<\/span>/g)].map(match => [match[1], match[2]]))
    .toEqual([['2026. 10. 14.', '15:00'], ['2026. 10. 14.', '16:30']]);
});
