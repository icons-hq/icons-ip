import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { CustomerPurchaseReportScreen } from './CustomerPurchaseReportScreen';
import { normalizeCustomerPurchaseFilters } from '@/lib/admin/customer-purchase-report';
import { customerPurchaseFixture } from '@/lib/admin/customer-purchase-report.fixture';

const now = new Date('2026-10-13T16:00:00Z'); const filters = normalizeCustomerPurchaseFilters({}, now);
describe('신규/재구매 분석 설명', () => {
  it('고객 중복·결제시점·적립금/배송비·기존 통계와의 차이를 보여준다', () => {
    const html = renderToStaticMarkup(<CustomerPurchaseReportScreen data={customerPurchaseFixture()} filters={filters} now={now} />);
    for (const text of ['180일', '100%를 넘을', '이후 취소·반품', '사용 적립금', '배송비', '34,000', '36,000', '13개월', '39행']) expect(html).toContain(text);
    expect(html).not.toContain('방문고객수');
  });
  it('실적없음과 근거 미확인을 혼동하지 않도록 진단과 금액 빈값을 보여준다', () => {
    const data = customerPurchaseFixture(); data.current.unknownPaidAtCount = 3;
    Object.assign(data.current.rows[0], { monetaryIssueOrderCount: 1, itemSubtotal: null, couponAmount: null, storeCreditAmount: null, productSalesAmount: null, cashProductAmount: null, averagePerCustomer: null });
    const html = renderToStaticMarkup(<CustomerPurchaseReportScreen data={data} filters={filters} now={now} />);
    expect(html).toContain('시각 미확인 3건'); expect(html).toContain('결제 1건'); expect(html).toContain('금액과 객단가를 표시하지');
  });
  it('잘못된 기간에는 이전 분석·엑셀 링크를 표시하지 않는다', () => {
    const html = renderToStaticMarkup(<CustomerPurchaseReportScreen data={null} filters={{ ...filters, error: '기간 오류' }} now={now} />);
    expect(html).toContain('기간 오류'); expect(html).not.toContain('엑셀 다운로드'); expect(html).not.toContain('39행');
  });
});
