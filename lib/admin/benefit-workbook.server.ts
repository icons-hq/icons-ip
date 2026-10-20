import 'server-only';
import ExcelJS from 'exceljs';
import { BenefitIssuanceError, benefitTrend, type BenefitIssuances, type BenefitMetrics, type BenefitReport, type BenefitReportFilters } from './benefit-report';
import { adminStatsDateInputs, adminStatsPreviousFilters } from './stats';

const headers = ['발급수', '결제 사용수', '쿠폰 할인금액(원)', '사용 주문금액(원)', '복구수', '기간 발급분 현재 사용률'];
const metrics = (row: BenefitMetrics) => [row.issued, row.paidUses, row.discountAmount, row.orderAmount, row.released, row.issued ? row.cohortPaidUses / row.issued : null];
export async function buildBenefitWorkbook(data: BenefitReport, comparison: BenefitReport | null, filters: BenefitReportFilters, now = new Date(), issuances: BenefitIssuances | null = null) {
  const includeIssuances = filters.detail === 'issuances' && Boolean(filters.code);
  if (includeIssuances && !issuances) throw new BenefitIssuanceError('benefit_issuance_read_failed');
  if (includeIssuances && issuances && (issuances.totalCount > 10000 || issuances.rows.length > 10000)) throw new BenefitIssuanceError('benefit_issuance_export_limit');
  if (includeIssuances && issuances && issuances.rows.length !== issuances.totalCount) throw new BenefitIssuanceError('benefit_issuance_read_failed');
  const book = new ExcelJS.Workbook();
  book.creator = 'ICONS'; book.created = now;
  const table = (name: string, columns: string[], rows: (string | number | Date | null)[][]) => {
    const sheet = book.addWorksheet(name);
    sheet.columns = columns.map(header => ({ header, width: /주문번호|ID|이름|내용/.test(header) ? 42 : 26 }));
    sheet.views = [{ state: 'frozen', ySplit: 1, showGridLines: false }];
    for (const values of rows) {
      const row = sheet.addRow(values); row.height = 23;
      row.eachCell(cell => {
        cell.font = { name: '맑은 고딕', size: 11 };
        cell.numFmt = cell.value instanceof Date ? 'yyyy-mm-dd hh:mm:ss' : typeof cell.value === 'number' ? '#,##0' : '@';
        cell.alignment = { horizontal: typeof cell.value === 'number' ? 'right' : 'left', vertical: 'middle' };
        if (columns[Number(cell.col) - 1]?.includes('사용률')) cell.numFmt = '0.0%';
      });
    }
    sheet.getRow(1).font = { bold: true, name: '맑은 고딕', size: 11 };
    sheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEDF0F5' } };
    sheet.getRow(1).height = 28;
    sheet.getRow(1).alignment = { horizontal: 'center', vertical: 'middle' };
    sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: Math.max(1, sheet.rowCount), column: columns.length } };
    return sheet;
  };
  table('요약', ['기간', ...headers], [['조회기간', ...metrics(data.summary)], ...(comparison ? [['직전 동일 기간', ...metrics(comparison.summary)]] : [])]);
  table('혜택별 지급현황', ['혜택 ID', '혜택이름', ...headers], data.coupons.map(row => [row.code, row.name, ...metrics(row)]));
  table('기간별 추이', ['기준일(KST)', ...headers], benefitTrend(data.daily, filters, now).map(row => [row.date, ...metrics(row)]));
  if (comparison) table('비교기간 추이', ['기준일(KST)', ...headers], benefitTrend(comparison.daily, { ...filters, ...adminStatsPreviousFilters(filters, now) }, now).map(row => [row.date, ...metrics(row)]));
  if (filters.code) {
    const date = (value: string) => new Date(value).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' });
    const labels = { paid: '결제 완료', pending: '결제 대기', released: '복구', other: '기타' };
    table('사용 상세', ['사용 ID', '주문번호', '적용일시(KST)', '현재 상태', '할인금액(원)', '주문금액(원)', '복구일시(KST)'], data.uses.map(row => [row.id, row.orderId, date(row.appliedAt), labels[row.status], row.discountAmount, row.orderAmount, row.releasedAt ? date(row.releasedAt) : null]));
  }
  if (includeIssuances && issuances) {
    table('발급 상세', ['발급 ID', '쿠폰 ID', '발급일시(KST)', '현재 결제 사용 집계 여부'], issuances.rows.map(row => [row.id, row.couponCode, new Date(Date.parse(row.issuedAt) + 9 * 3600000), row.isPaidUse ? '예' : '아니오']));
  }
  const dates = adminStatsDateInputs(filters, now);
  const info = table('조회 기준', ['항목', '내용'], [
    ['조회기간(KST)', `${dates.from} ~ ${dates.to}`], ['집계 단위', filters.bucket === 'week' ? '주간(월요일 시작)' : filters.bucket === 'month' ? '월간' : '일간'],
    ['검색어', filters.query], ['할인종류', { all: '전체', fixed: '정액 할인', percent: '정률 할인' }[filters.discount]], ['타겟팅 대상', { all: '전체', first_purchase: '첫 구매 고객', repeat_purchase: '재구매 고객', targeted: '지정 고객' }[filters.segment]], ['혜택 ID', filters.code || '전체'], ['생성시각', now.toISOString()],
    ['발급수', '기간 내 발급일 기준'], ['결제 사용수', '기간 내 쿠폰 적용일 기준. 현재 결제완료·발주확인·배송중·배송완료·거래확정 상태인 주문만 포함. 결제 대기·복구 제외.'],
    ['복구수', '기간 내 복구일 기준. 결제 대기 만료와 취소·반품으로 복구한 이력을 포함.'],
    ['기간 발급분 현재 사용률', '기간 내 발급된 쿠폰 중 조회 시점 결제가 유지되는 사용 수 ÷ 같은 기간 발급수. 기간 사용수/발급수와 다름.'],
    ['사용 주문금액', '할인·적립금 적용 후 주문 총액'], ['필터 기준', '혜택이름·할인종류·타겟팅 대상은 현재 쿠폰 설정 기준'],
    ['내보내기 범위', '현재 조건 전체, 혜택 및 사용 상세 각각 최대 10,000행. 한도 초과는 파일 생성 거부.'],
    ...(includeIssuances && issuances ? [
      ['상세 종류', '발급 상세'], ['발급 상세 전체 건수', issuances.totalCount], ['발급 상세 현재 결제 사용수', issuances.paidUseCount],
      ['발급 상세 조회시각(KST)', new Date(Date.parse(issuances.asOf) + 9 * 3600000)],
      ['발급 상세 기준', '현재 쿠폰 조건과 기간 내 발급일 기준, 발급일시 내림차순·발급 ID 오름차순, 전체 최대 10,000건.'],
      ['현재 결제 사용 집계 여부', '예: 기간 발급분 중 현재 적용 원장과 결제가 유지되는 주문이 있는 건. 아니오는 사용 가능·미사용·환불 완료를 뜻하지 않음.'],
      ['조회 시점', '발급 상세의 행·전체 건수·현재 결제 사용수는 같은 조회 시점 기준. 별도 조회인 요약과는 발급·취소 진행에 따라 차이가 날 수 있음.'],
    ] : []),
  ]);
  info.getColumn(2).width = 95;
  info.getColumn(2).alignment = { wrapText: true, vertical: 'top' };
  info.eachRow((row, index) => { if (index > 1) row.height = String(row.getCell(2).value).length > 70 ? 42 : 28; });
  return Buffer.from(await book.xlsx.writeBuffer());
}
