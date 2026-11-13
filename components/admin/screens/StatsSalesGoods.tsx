import Link from 'next/link';
import { Download } from 'lucide-react';
import { ConsoleGrid, ConsolePagination, type ConsoleGridColumn } from '@/components/admin/console';
import { buttonVariants } from '@/components/admin/kit/ui/button';
import { STATS_NOTE, STATS_SEGMENTED, STATS_SEGMENT_LINK, StatsSection } from '@/components/admin/StatsSummary';
import { ADMIN_SALES_GOODS_EXPORT_LIMIT, ADMIN_SALES_GOODS_PAGE_SIZES, adminSalesGoodsExportDisabledReason, adminSalesGoodsHref, type AdminSalesGoodsPage } from '@/lib/admin/stats-sales-goods';
import { adminStatsComparisonMode, adminStatsDateInputs, adminStatsHref, type AdminStatsFilters } from '@/lib/admin/stats';
import { krw } from '@/lib/format';

const COLUMNS: ConsoleGridColumn[] = [
  { key: 'rank', label: '순위', width: '70px' },
  { key: 'name', label: '상품', minWidth: '200px' },
  { key: 'ip', label: 'IP', width: '140px' },
  { key: 'qty', label: '수량', align: 'end', width: '90px' },
  { key: 'revenue', label: '금액', align: 'end', width: '130px' },
];
const EXPORT_LINK = buttonVariants({ variant: 'outline', size: 'sm' });

export function StatsSalesGoods({ report, filters, now, comparisonTotalCount }: { report: AdminSalesGoodsPage; filters: AdminStatsFilters; now: Date; comparisonTotalCount?: number }) {
  const { page, pageSize, totalCount } = report;
  const disabledReason = adminSalesGoodsExportDisabledReason(totalCount, comparisonTotalCount);
  const dates = adminStatsDateInputs(filters, now);
  const exportHref = `${adminStatsHref('/api/admin/stats-workbook', { ...filters, from: dates.from, to: dates.to })}&report=sales`;
  /* 다른 데이터분석 목록과 같은 카드(StatsSection)와 콘솔 페이지 이동(범위 요약 + 이전·다음)을 쓴다. */
  return <StatsSection id="goods-ranking" title={`상품별 판매 순위${filters.ipId ? ` · ${filters.ipId}` : ''}`} titleId="goods-ranking-title"
    actions={disabledReason ? <p className={STATS_NOTE} role="status">{disabledReason}</p> : <a className={EXPORT_LINK} data-slot="button" href={exportHref}><Download aria-hidden="true" />상품 전체 포함 엑셀</a>}>
    <p className={STATS_NOTE}>전체 {totalCount.toLocaleString('ko-KR')}개 상품 · 금액 높은 순, 같은 금액은 수량 높은 순. 주문 당시 단가 × 수량에서 복수구매 할인을 뺀 금액이며 쿠폰·적립금·배송비는 포함하지 않습니다.</p>
    <div className="flex flex-wrap items-center justify-between gap-2">
      <nav aria-label="상품 순위 페이지당 개수" className="flex items-center gap-2">
        <span className="text-sm text-muted-foreground">페이지당</span>
        <span className={STATS_SEGMENTED}>{ADMIN_SALES_GOODS_PAGE_SIZES.map(size => <Link key={size} className={STATS_SEGMENT_LINK}
          aria-current={pageSize === size ? 'true' : undefined} href={adminSalesGoodsHref(filters, 1, size)}>{size}개</Link>)}</span>
      </nav>
      <span className="text-xs text-muted-foreground">엑셀: {adminStatsComparisonMode(filters) === 'none' ? '현재기간' : '현재·비교기간 각각'} 최대 {ADMIN_SALES_GOODS_EXPORT_LIMIT.toLocaleString('ko-KR')}개 상품</span>
    </div>
    <ConsoleGrid caption="상품별 판매 순위" columns={COLUMNS} emptyLabel="이 기간에 판매된 상품이 없습니다."
      rows={report.rows.map(row => ({ id: row.goodId, cells: [
        row.rank.toLocaleString('ko-KR'), row.name, row.ipId, row.qty.toLocaleString('ko-KR'), krw(row.revenue),
      ] }))} />
    <ConsolePagination label="상품 순위 페이지" page={page} pageSize={pageSize} total={totalCount} unit="개" hrefForPage={number => adminSalesGoodsHref(filters, number, pageSize)} />
  </StatsSection>;
}
