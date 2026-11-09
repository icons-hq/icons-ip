'use client';

import { useState } from 'react';
import { ConsoleGrid, ConsolePagination } from '@/components/admin/console';
import { CUSTOMER_PURCHASE_GROUP_LABEL, customerPurchaseShare, customerPurchaseValue as value, type CustomerPurchaseGrain, type CustomerPurchasePeriod } from '@/lib/admin/customer-purchase-report';

export function CustomerPurchaseDataTable({ periods, grain }: { periods: CustomerPurchasePeriod[]; grain: CustomerPurchaseGrain }) {
  const [page, setPage] = useState(1);
  const flat = [...periods].reverse().flatMap(period => period.rows.map(row => ({ period, row })));
  const pages = Math.max(1, Math.ceil(flat.length / 20));
  const current = Math.min(page, pages);
  return <section aria-label="고객 구매 분석 데이터 표" className="flex min-w-0 flex-col gap-3"><div className="flex flex-col gap-1"><h3 className="text-base font-medium text-foreground">데이터 표</h3>
    <p className="text-xs text-muted-foreground">최근 {grain === 'week' ? '13주의 마감 주별' : '13개월의 마감 월별'} 상세 데이터 · {flat.length}행</p></div>
    <ConsoleGrid caption={`고객 구매 분석 ${grain === 'week' ? '주별' : '월별'} 상세`} columns={[
      { key: 'period', label: '기간(KST)', width: '205px' }, { key: 'group', label: '고객분류', width: '90px' },
      { key: 'customers', label: '결제고객수', align: 'end', width: '110px' }, { key: 'customerShare', label: '고객 비중', align: 'end', width: '100px' },
      { key: 'orders', label: '결제 주문수', align: 'end', width: '105px' }, { key: 'sales', label: '상품 판매금액', align: 'end', width: '140px' },
      { key: 'salesShare', label: '판매금액 비중', align: 'end', width: '110px' }, { key: 'average', label: '객단가', align: 'end', width: '110px' },
      { key: 'credit', label: '사용 적립금', align: 'end', width: '115px' }, { key: 'cash', label: '상품 실결제액', align: 'end', width: '140px' },
      { key: 'issues', label: '금액 확인 필요', align: 'end', width: '115px' },
    ]} rows={flat.slice((current - 1) * 20, current * 20).map(({ period, row }) => {
      const all = period.rows.find(r => r.group === 'all')!;
      const share = row.group === 'all' ? null : customerPurchaseShare(row.customerCount, all.customerCount);
      const salesShare = row.group === 'all' || row.productSalesAmount === null || all.productSalesAmount === null ? null : customerPurchaseShare(row.productSalesAmount, all.productSalesAmount);
      return { id: `${period.from}-${row.group}`, cells: [<span className="whitespace-nowrap tabular-nums" key="period">{period.from} ~ {period.to}</span>, CUSTOMER_PURCHASE_GROUP_LABEL[row.group], value(row.customerCount), share === null ? '—' : `${value(share, 1)}%`, value(row.orderCount), value(row.productSalesAmount), salesShare === null ? '—' : `${value(salesShare, 1)}%`, value(row.averagePerCustomer, 2), value(row.storeCreditAmount), value(row.cashProductAmount), row.monetaryIssueOrderCount ? `${value(row.monetaryIssueOrderCount)}건` : '—'] };
    })} />
    <ConsolePagination label="고객 분석 데이터 페이지" page={current} pageSize={20} total={flat.length} unit="행" onPageChange={setPage} />
  </section>;
}
