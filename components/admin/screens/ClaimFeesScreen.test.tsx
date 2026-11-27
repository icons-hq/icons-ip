import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import { ClaimFeesScreen } from './ClaimFeesScreen';
import { claimFeeQueueFilters, parseClaimFeeQueue } from '@/lib/admin/claim-fees';
const queue = { state: 'refund_due' as const, page: 1, pageSize: 50, total: 51, counts: { refund_due: 51 }, rows: [{ id: 'a1010000-0000-4000-8000-0000000000f1', claimId: 'a1010000-0000-4000-8000-000000000002', orderId: 'a1010000-0000-4000-8000-000000000003', orderNumber: '2026101610000001', claimType: 'exchange' as const, amount: 3000, state: 'refund_due' as const, payerRole: 'requester' as const, issuedAt: '2026-10-16T06:00:00Z', receivedAt: '2026-10-16T06:01:00Z', refundedAt: null }] };
it('shows fee refund duties, correct claim detail and filtered pagination without payment account data', () => {
 expect(parseClaimFeeQueue(queue)).toEqual(queue);
 const html = renderToStaticMarkup(<ClaimFeesScreen data={queue} />);
 for (const text of ['배송비 반환 대기', '반품·교환 요청자', '3,000', '/admin/sales/claims/exchanges/a1010000-0000-4000-8000-000000000002', 'state=refund_due&amp;page=2']) expect(html).toContain(text);
 expect(html).not.toContain('accountNumber'); expect(html).not.toContain('실제 반환 완료 저장');
 expect(parseClaimFeeQueue({ ...queue, rows: [{ ...queue.rows[0], bankAccount: {} }] })).toBeNull();
});
it('화면 이름은 배송비 청구 내역 하나이고, 설정·반품·교환 화면으로 가는 버튼이 머리에 있다', () => {
 const html = renderToStaticMarkup(<ClaimFeesScreen data={queue} />);
 expect(html).toMatch(/<h2[^>]*>배송비 청구 내역<\/h2>/);
 expect(html).toMatch(/<a[^>]*data-slot="button"[^>]*href="\/admin\/sales\/claims\/returns\/fee-policy"[^>]*>배송비 청구 설정<\/a>/);
 for (const old of ['배송비 청구 정책', '입금·반환 목록', '청구·입금·반환']) expect(html).not.toContain(old);
});
it('내부 번호를 보이지 않고, 줄의 첫 칸이 어느 요청으로 가는지 이름으로 말한다', () => {
 const html = renderToStaticMarkup(<ClaimFeesScreen data={queue} />);
 /* 청구 건의 내부 번호(끝 8자)와 '청구번호' 칸은 없다. 주문은 주문번호로 보인다. */
 expect(html).not.toContain('청구번호'); expect(html).not.toContain('000000F1'); expect(html).toContain('2026101610000001');
 expect(html).toMatch(/<a[^>]*href="\/admin\/sales\/claims\/exchanges\/a1010000-0000-4000-8000-000000000002"[^>]*>교환 요청<\/a>/);
 const headers = [...html.matchAll(/<th[^>]*>(.*?)<\/th>/g)].map(match => match[1].replace(/<[^>]+>/g, ''));
 expect(headers).toEqual(['요청', '주문번호', '처리 상태', '청구 금액', '입금할 사람', '청구한 날', '입금 확인한 날', '돌려준 날']);
 /* 아직 돌려주지 않은 건의 '돌려준 날'은 '-'다('미완료'·'미확인'이라 적지 않는다). */
 expect(html).not.toContain('미완료'); expect(html).not.toContain('미확인');
 expect(html).toMatch(/<td[^>]*>-<\/td>/);
});
it('normalizes unsupported filters and page numbers', () => {
 expect(claimFeeQueueFilters({ state: 'wire_sent', page: '0' })).toEqual({ state: 'open', page: 1 });
 expect(claimFeeQueueFilters({ state: 'paid', page: '2' })).toEqual({ state: 'paid', page: 2 });
});

/* F-18: 같은 주문의 여러 청구를 구분하도록 '요청' 칸에 요청번호를 함께 보이고, 표는 1366px 화면의 틀(약 1050px) 안에 든다. */
it('요청 칸에 요청번호를 함께 보이고, 읽지 못했으면 유형만 보인다', () => {
 const claimId = queue.rows[0].claimId;
 const shown = renderToStaticMarkup(<ClaimFeesScreen data={queue} references={{ [claimId]: 22 }} />);
 expect(shown).toMatch(/<a[^>]*href="\/admin\/sales\/claims\/exchanges\/a1010000-0000-4000-8000-000000000002"[^>]*><span class="flex flex-col"><span class="tabular-nums">C00022<\/span><span[^>]*>교환 요청<\/span><\/span><\/a>/);
 /* 다른 요청의 번호는 이 줄에 붙지 않는다. */
 expect(renderToStaticMarkup(<ClaimFeesScreen data={queue} references={{ 'a1010000-0000-4000-8000-0000000000aa': 9 }} />)).not.toContain('C00009');
 expect(renderToStaticMarkup(<ClaimFeesScreen data={queue} />)).not.toMatch(/C000\d\d/);
});
it('열 폭 합계가 1366px 화면의 틀(약 1050px) 안에 들고, 날짜와 시각은 두 줄로 나눠 칸을 넓히지 않는다', () => {
 const html = renderToStaticMarkup(<ClaimFeesScreen data={queue} />);
 const widths = [...html.matchAll(/<col style="width:(\d+)px"\/>/g)].map(match => Number(match[1]));
 expect(widths).toHaveLength(8);
 expect(widths.reduce((sum, width) => sum + width, 0)).toBeLessThanOrEqual(1050);
 expect(html).toMatch(/data-date-time=""><span>2026\. 10\. 16\.<\/span><span[^>]*>\d{2}:\d{2}<\/span>/);
});
