import type { CustomerPurchaseReport, CustomerPurchaseRow } from './customer-purchase-report';

/** Synthetic report shared only by colocated tests. */
export function customerPurchaseFixture(): CustomerPurchaseReport {
  const row = (group: CustomerPurchaseRow['group']): CustomerPurchaseRow => ({ group, customerCount: group === 'all' ? 2 : 2, orderCount: group === 'all' ? 4 : 2,
    itemSubtotal: group === 'all' ? 40000 : 20000, couponAmount: group === 'all' ? 4000 : 2000, storeCreditAmount: group === 'all' ? 2000 : 1000,
    productSalesAmount: group === 'all' ? 36000 : 18000, cashProductAmount: group === 'all' ? 34000 : 17000, averagePerCustomer: group === 'all' ? 18000 : 9000, monetaryIssueOrderCount: 0 });
  const period = (from: string, to: string) => ({ from, to, rows: (['all', 'new', 'repeat'] as const).map(row), unknownPaidAtCount: 0 });
  return { current: period('2026-09-01', '2026-09-30'), comparison: period('2026-08-01', '2026-08-31'), trend: Array.from({ length: 13 }, (_, i) => {
    const date = new Date(Date.UTC(2025, 8 + i, 1));
    return period(date.toISOString().slice(0, 10), new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).toISOString().slice(0, 10));
  }) };
}
