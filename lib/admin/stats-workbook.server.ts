import 'server-only';
import ExcelJS from 'exceljs';
import { kstDateTimeText } from './list-export';
import { ADMIN_SALES_GOODS_EXPORT_LIMIT, assertCompleteSalesGoodsExport, type AdminSalesGoodsPage } from './stats-sales-goods';
import { ADMIN_STATS_YEAR_COMPARISON_NOTE, adminClaimReasonLabel, adminClaimTypeLabel, adminPaymentMethodLabel, adminSalesTrend, adminStatsComparisonFilters, adminStatsComparisonLabel, adminStatsComparisonMode, adminStatsDateInputs, type AdminClaimsReport, type AdminCustomerReport, type AdminSalesReport, type AdminStatsFilters } from './stats';
import { addSafeWorkbookInfoSheet, addWorkbookTable, tableColumn as column } from './workbook-table';

type Source = { kind: 'sales'; data: AdminSalesReport; goods: AdminSalesGoodsPage; comparison?: AdminSalesReport | null; comparisonGoods?: AdminSalesGoodsPage | null } | { kind: 'claims'; data: AdminClaimsReport; comparison?: AdminClaimsReport | null } | { kind: 'customers'; data: AdminCustomerReport; comparison?: AdminCustomerReport | null };

const REPORT_SCREEN_LABELS = { sales: '판매분석', claims: '취소/반품/교환 분석', customers: '고객분석' } as const;
const SUMMARY_COLUMNS = [column('지표', 'text', 32), column('값', 'number')];

export async function buildStatsWorkbook(source: Source, filters: AdminStatsFilters, generatedAt = new Date()) {
  const book = new ExcelJS.Workbook();
  book.creator = 'ICONS'; book.created = generatedAt;
  function sales(data: AdminSalesReport, goods: AdminSalesGoodsPage, active: AdminStatsFilters, prefix = '') {
    assertCompleteSalesGoodsExport(goods);
    addWorkbookTable(book, `${prefix}매출 추이`, [column('기간 시작일', 'date', 14), column('주문수', 'count'), column('매출', 'amount'), column('객단가', 'amount')], adminSalesTrend(data.daily, active, generatedAt).map(row => [row.date, row.orderCount, row.revenue, row.averageOrderValue]));
    addWorkbookTable(book, `${prefix}결제수단`, [column('결제수단', 'text', 16), column('주문수', 'count'), column('매출', 'amount')], data.paymentMethods.map(row => [adminPaymentMethodLabel(row.method), row.orderCount, row.revenue]));
    addWorkbookTable(book, `${prefix}상품 전체`, [column('순위', 'count'), column('상품번호', 'code', 28), column('상품명', 'text', 36), column('IP', 'text', 20), column('수량', 'count'), column('금액', 'amount')], goods.rows.map(row => [row.rank, row.goodId, row.name, row.ipId, row.qty, row.revenue]));
    addWorkbookTable(book, `${prefix}이벤트 TOP20`, [column('이벤트번호', 'code', 16), column('이벤트', 'text', 36), column('예매수', 'count'), column('티켓수', 'count'), column('매출', 'amount')], data.tickets.map(row => [row.eventId, row.eventTitle, row.orderCount, row.ticketCount, row.revenue]));
    addWorkbookTable(book, `${prefix}회차 TOP20`, [column('회차번호', 'code', 16), column('회차', 'text', 28), column('이벤트', 'text', 36), column('티켓수', 'count'), column('매출', 'amount')], (data.ticketOccurrences ?? []).map(row => [row.ticketTypeId, row.occurrenceName, row.eventTitle, row.ticketCount, row.revenue]));
  }
  function claims(data: AdminClaimsReport, prefix = '') {
    addWorkbookTable(book, `${prefix}클레임 요약`, SUMMARY_COLUMNS, [['확정 주문', data.orderCount], ['클레임 접수', data.claimCount], ['환불 완료', data.refunds.completedCount], ['접수부터 환불까지 평균시간', data.refunds.averageHours], ['72시간 내 환불', data.refunds.within72h]]);
    addWorkbookTable(book, `${prefix}유형별 클레임`, [column('유형', 'text', 12), column('접수', 'count'), column('완료', 'count'), column('거절', 'count'), column('요청 철회', 'count'), column('진행', 'count'), column('주문 천건당 접수', 'number')], data.byType.map(row => [adminClaimTypeLabel(row.claimType), row.total, row.completed, row.rejected, row.withdrawn, row.open, row.ratePerMille]));
    addWorkbookTable(book, `${prefix}사유별 클레임`, [column('유형', 'text', 12), column('사유', 'text', 28), column('접수', 'count')], data.byReason.map(row => [adminClaimTypeLabel(row.claimType), adminClaimReasonLabel(row.reasonType), row.total]));
  }
  function customers(data: AdminCustomerReport, active: AdminStatsFilters, prefix = '') {
    addWorkbookTable(book, `${prefix}고객 요약`, SUMMARY_COLUMNS, [['신규 가입', data.signupTotal], ['구매 고객', data.buyerCount], ['기간 내 재구매 고객', data.repeatBuyerCount], ['문의 접수', data.inquiries.total], ['미답변 문의', data.inquiries.unanswered], ['평균 첫 응답시간', data.inquiries.averageFirstResponseHours], ['리뷰', data.reviews.total], ['미답글 리뷰', data.reviews.unanswered], ['평균 평점', data.reviews.averageRating]]);
    addWorkbookTable(book, `${prefix}가입 추이`, [column('기간 시작일', 'date', 14), column('신규 가입', 'count')], adminSalesTrend(data.signups.map(row => ({ date: row.date, orderCount: row.total, revenue: 0, averageOrderValue: 0 })), active, generatedAt).map(row => [row.date, row.orderCount]));
    addWorkbookTable(book, `${prefix}평점 분포`, [column('평점', 'count'), column('리뷰수', 'count')], data.reviews.distribution.map((count, index) => [index + 1, count]));
  }
  const comparisonFilters = source.comparison ? adminStatsComparisonFilters(filters, generatedAt) : null;
  if (source.kind === 'sales') {
    sales(source.data, source.goods, filters);
    if (source.comparison && comparisonFilters) {
      if (!source.comparisonGoods) throw new Error('Missing comparison goods export');
      sales(source.comparison, source.comparisonGoods, comparisonFilters, '비교 ');
    }
  }
  if (source.kind === 'claims') { claims(source.data); if (source.comparison && comparisonFilters) claims(source.comparison, '비교 '); }
  if (source.kind === 'customers') { customers(source.data, filters); if (source.comparison && comparisonFilters) customers(source.comparison, comparisonFilters, '비교 '); }
  const dates = adminStatsDateInputs(filters, generatedAt);
  const comparisonDates = comparisonFilters ? adminStatsDateInputs(comparisonFilters, generatedAt) : null;
  /* 그 보고서에 해당하는 안내만 적는다. 집계 단위는 추이가 있는 판매·고객분석, IP 필터·순위·매출 기준은 판매분석에만 쓰인다. */
  addSafeWorkbookInfoSheet(book, [
    ['화면', REPORT_SCREEN_LABELS[source.kind]],
    ['조회 시작일 (KST)', dates.from], ['조회 종료일 (KST)', dates.to],
    ...(source.kind === 'claims' ? [] : [['집계 단위', filters.bucket === 'week' ? '주별(월요일 시작)' : filters.bucket === 'month' ? '월별' : '일별']] as const),
    ...(source.kind === 'sales' ? [['IP 필터(상품 순위만)', filters.ipId || '전체']] as const : []),
    ['내려받은 시각 (KST)', kstDateTimeText(generatedAt.toISOString())],
    ...(source.kind === 'sales' ? [
      ['매출 기준', '조회시점 결제완료·발주확인·배송중·배송완료·거래확정 주문. 주문 생성일(KST) 기준. 환불 완료 주문 제외.'],
      ['순위 범위', '상품은 조회조건에 맞는 전체 순위(기간별 최대 10,000개), 이벤트·회차는 상위 20개. 상품 금액은 주문 당시 단가 × 수량에서 복수구매 할인을 뺀 금액이며 쿠폰·적립금·배송비 제외.'],
      ['상품 전체 건수', source.goods.totalCount.toLocaleString('ko-KR')],
      ['상품 집계 시각 (KST)', kstDateTimeText(source.goods.asOf)],
      ['상품 엑셀 상한', ADMIN_SALES_GOODS_EXPORT_LIMIT.toLocaleString('ko-KR')],
      ...(source.comparisonGoods ? [['비교 상품 전체 건수', source.comparisonGoods.totalCount.toLocaleString('ko-KR')], ['비교 상품 집계 시각 (KST)', kstDateTimeText(source.comparisonGoods.asOf)]] as const : []),
    ] as const : []),
    ...(source.kind === 'claims' ? [['클레임 기준', '각 클레임의 생성일 기준.']] as const : []),
    ...(source.kind === 'customers' ? [['가입·재구매 기준', '각 사건의 생성일 기준. 고객 재구매는 조회기간 내 구매 기준.']] as const : []),
    ['비교 방식', comparisonDates ? adminStatsComparisonLabel(filters) : '비교 없음'],
    ...(comparisonDates ? [['비교기간 (KST)', `${comparisonDates.from} ~ ${comparisonDates.to}`]] as const : []),
    ...(comparisonDates && adminStatsComparisonMode(filters) === 'year' ? [['전년 비교 기준', ADMIN_STATS_YEAR_COMPARISON_NOTE]] as const : []),
  ]);
  return Buffer.from(await book.xlsx.writeBuffer());
}
