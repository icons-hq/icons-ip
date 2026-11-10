import 'server-only';
import ExcelJS from 'exceljs';
import { ADMIN_SALES_GOODS_EXPORT_LIMIT, assertCompleteSalesGoodsExport, type AdminSalesGoodsPage } from './stats-sales-goods';
import { ADMIN_STATS_YEAR_COMPARISON_NOTE, adminClaimReasonLabel, adminClaimTypeLabel, adminPaymentMethodLabel, adminSalesTrend, adminStatsComparisonFilters, adminStatsComparisonLabel, adminStatsComparisonMode, adminStatsDateInputs, type AdminClaimsReport, type AdminCustomerReport, type AdminSalesReport, type AdminStatsFilters } from './stats';

type Source = { kind: 'sales'; data: AdminSalesReport; goods: AdminSalesGoodsPage; comparison?: AdminSalesReport | null; comparisonGoods?: AdminSalesGoodsPage | null } | { kind: 'claims'; data: AdminClaimsReport; comparison?: AdminClaimsReport | null } | { kind: 'customers'; data: AdminCustomerReport; comparison?: AdminCustomerReport | null };
type Cell = string | number | null;

export async function buildStatsWorkbook(source: Source, filters: AdminStatsFilters, generatedAt = new Date()) {
  const book = new ExcelJS.Workbook();
  book.creator = 'ICONS'; book.created = generatedAt;
  function table(name: string, headers: string[], rows: Cell[][]) {
    const sheet = book.addWorksheet(name);
    sheet.columns = headers.map(header => ({ header, width: /상품|이벤트|회차|IP|지표/.test(header) ? 32 : 20 }));
    sheet.views = [{ state: 'frozen', ySplit: 1 }];
    for (const values of rows) {
      const row = sheet.addRow(values);
      row.eachCell(cell => { cell.numFmt = typeof cell.value === 'number' ? '#,##0.##' : '@'; });
    }
    sheet.getRow(1).font = { bold: true, name: '맑은 고딕', size: 11 };
    sheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEDF0F5' } };
    sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: Math.max(1, sheet.rowCount), column: headers.length } };
    return sheet;
  }
  function sales(data: AdminSalesReport, goods: AdminSalesGoodsPage, active: AdminStatsFilters, prefix = '') {
    assertCompleteSalesGoodsExport(goods);
    table(`${prefix}매출 추이`, ['기간 시작일(KST)', '주문수', '매출(원)', '객단가(원)'], adminSalesTrend(data.daily, active, generatedAt).map(row => [row.date, row.orderCount, row.revenue, row.averageOrderValue]));
    table(`${prefix}결제수단`, ['결제수단', '주문수', '매출(원)'], data.paymentMethods.map(row => [adminPaymentMethodLabel(row.method), row.orderCount, row.revenue]));
    table(`${prefix}상품 전체`, ['순위', '상품번호', '상품명', 'IP', '수량', '금액(원)'], goods.rows.map(row => [row.rank, row.goodId, row.name, row.ipId, row.qty, row.revenue]));
    table(`${prefix}이벤트 TOP20`, ['이벤트번호', '이벤트', '예매수', '티켓수', '매출(원)'], data.tickets.map(row => [row.eventId, row.eventTitle, row.orderCount, row.ticketCount, row.revenue]));
    table(`${prefix}회차 TOP20`, ['회차번호', '회차', '이벤트', '티켓수', '매출(원)'], (data.ticketOccurrences ?? []).map(row => [row.ticketTypeId, row.occurrenceName, row.eventTitle, row.ticketCount, row.revenue]));
  }
  function claims(data: AdminClaimsReport, prefix = '') {
    table(`${prefix}클레임 요약`, ['지표', '값'], [['확정 주문', data.orderCount], ['클레임 접수', data.claimCount], ['환불 완료', data.refunds.completedCount], ['접수부터 환불까지 평균시간', data.refunds.averageHours], ['72시간 내 환불', data.refunds.within72h]]);
    table(`${prefix}유형별 클레임`, ['유형', '접수', '완료', '거절', '요청 철회', '진행', '주문 천건당 접수'], data.byType.map(row => [adminClaimTypeLabel(row.claimType), row.total, row.completed, row.rejected, row.withdrawn, row.open, row.ratePerMille]));
    table(`${prefix}사유별 클레임`, ['유형', '사유', '접수'], data.byReason.map(row => [adminClaimTypeLabel(row.claimType), adminClaimReasonLabel(row.reasonType), row.total]));
  }
  function customers(data: AdminCustomerReport, active: AdminStatsFilters, prefix = '') {
    table(`${prefix}고객 요약`, ['지표', '값'], [['신규 가입', data.signupTotal], ['구매 고객', data.buyerCount], ['기간 내 재구매 고객', data.repeatBuyerCount], ['문의 접수', data.inquiries.total], ['미답변 문의', data.inquiries.unanswered], ['평균 첫 응답시간', data.inquiries.averageFirstResponseHours], ['리뷰', data.reviews.total], ['미답글 리뷰', data.reviews.unanswered], ['평균 평점', data.reviews.averageRating]]);
    table(`${prefix}가입 추이`, ['기간 시작일(KST)', '신규 가입'], adminSalesTrend(data.signups.map(row => ({ date: row.date, orderCount: row.total, revenue: 0, averageOrderValue: 0 })), active, generatedAt).map(row => [row.date, row.orderCount]));
    table(`${prefix}평점 분포`, ['평점', '리뷰수'], data.reviews.distribution.map((count, index) => [index + 1, count]));
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
  const info = table('조회 정보', ['항목', '내용'], [
    ['조회 시작일(KST)', dates.from], ['조회 종료일(KST)', dates.to], ['집계 단위', filters.bucket === 'week' ? '주별(월요일 시작)' : filters.bucket === 'month' ? '월별' : '일별'],
    ['IP 필터(상품 순위만)', filters.ipId || '전체'], ['생성시각', generatedAt.toISOString()],
    ['매출 기준', '조회시점 결제완료·발주확인·배송중·배송완료·거래확정 주문. 주문 생성일(KST) 기준. 환불 완료 주문 제외.'],
    ['순위 범위', '상품은 조회조건에 맞는 전체 순위(기간별 최대 10,000개), 이벤트·회차는 상위 20개. 상품 금액은 주문 당시 단가 × 수량에서 복수구매 할인을 뺀 금액이며 쿠폰·적립금·배송비 제외.'],
    ...(source.kind === 'sales' ? [
      ['상품 전체 건수', source.goods.totalCount] as Cell[],
      ['상품 집계시각', source.goods.asOf] as Cell[],
      ['상품 엑셀 상한', ADMIN_SALES_GOODS_EXPORT_LIMIT] as Cell[],
      ...(source.comparisonGoods ? [['비교 상품 전체 건수', source.comparisonGoods.totalCount] as Cell[], ['비교 상품 집계시각', source.comparisonGoods.asOf] as Cell[]] : []),
    ] : []),
    ['가입·클레임', '각 사건의 생성일 기준. 고객 재구매는 조회기간 내 구매 기준.'],
    ['비교 방식', comparisonDates ? adminStatsComparisonLabel(filters) : '비교 없음'],
    ...(comparisonDates ? [['비교기간(KST)', `${comparisonDates.from} ~ ${comparisonDates.to}`] as Cell[]] : []),
    ...(comparisonDates && adminStatsComparisonMode(filters) === 'year' ? [['전년 비교 기준', ADMIN_STATS_YEAR_COMPARISON_NOTE] as Cell[]] : []),
  ]);
  info.getColumn(1).alignment = { vertical: 'top' };
  info.getColumn(2).width = 90;
  info.getColumn(2).alignment = { wrapText: true, vertical: 'top' };
  info.eachRow((row, index) => {
    if (index > 1) row.height = String(row.getCell(2).value).length > 60 ? 48 : 28;
  });
  return Buffer.from(await book.xlsx.writeBuffer());
}
