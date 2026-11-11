import 'server-only';
import ExcelJS from 'exceljs';
import { BenefitIssuanceError, benefitTrend, type BenefitIssuances, type BenefitMetrics, type BenefitReport, type BenefitReportFilters } from './benefit-report';
import { kstDateTimeText } from './list-export';
import { adminStatsDateInputs, adminStatsPreviousFilters } from './stats';
import { addSafeWorkbookInfoSheet, addWorkbookTable, tableColumn as column } from './workbook-table';

const METRIC_COLUMNS = [column('발급수', 'count'), column('결제 사용수', 'count'), column('쿠폰 할인금액', 'amount'), column('사용 주문금액', 'amount'), column('복구수', 'count'), column('기간 발급분 현재 사용률', 'number', 26, '0.0%')];
const metrics = (row: BenefitMetrics) => [row.issued, row.paidUses, row.discountAmount, row.orderAmount, row.released, row.issued ? row.cohortPaidUses / row.issued : null];
const USE_STATUS_LABELS = { paid: '결제 완료', pending: '결제 대기', released: '복구', other: '기타' } as const;

export async function buildBenefitWorkbook(data: BenefitReport, comparison: BenefitReport | null, filters: BenefitReportFilters, now = new Date(), issuances: BenefitIssuances | null = null) {
  const includeIssuances = filters.detail === 'issuances' && Boolean(filters.code);
  if (includeIssuances && !issuances) throw new BenefitIssuanceError('benefit_issuance_read_failed');
  if (includeIssuances && issuances && (issuances.totalCount > 10000 || issuances.rows.length > 10000)) throw new BenefitIssuanceError('benefit_issuance_export_limit');
  if (includeIssuances && issuances && issuances.rows.length !== issuances.totalCount) throw new BenefitIssuanceError('benefit_issuance_read_failed');
  const book = new ExcelJS.Workbook();
  book.creator = 'ICONS'; book.created = now;
  const dateColumn = column('기준일', 'date', 14);
  addWorkbookTable(book, '요약', [column('기간', 'text', 16), ...METRIC_COLUMNS], [['조회기간', ...metrics(data.summary)], ...(comparison ? [['직전 동일 기간', ...metrics(comparison.summary)]] : [])]);
  addWorkbookTable(book, '혜택별 지급현황', [column('혜택 ID', 'code', 24), column('혜택이름', 'text', 36), ...METRIC_COLUMNS], data.coupons.map(row => [row.code, row.name, ...metrics(row)]));
  addWorkbookTable(book, '기간별 추이', [dateColumn, ...METRIC_COLUMNS], benefitTrend(data.daily, filters, now).map(row => [row.date, ...metrics(row)]));
  if (comparison) addWorkbookTable(book, '비교기간 추이', [dateColumn, ...METRIC_COLUMNS], benefitTrend(comparison.daily, { ...filters, ...adminStatsPreviousFilters(filters, now) }, now).map(row => [row.date, ...metrics(row)]));
  if (filters.code) {
    addWorkbookTable(book, '사용 상세', [column('사용 ID', 'code', 38), column('주문번호', 'code', 38), column('적용일시', 'date'), column('현재 상태', 'text', 12), column('할인금액', 'amount'), column('주문금액', 'amount'), column('복구일시', 'date')],
      data.uses.map(row => [row.id, row.orderId, kstDateTimeText(row.appliedAt), USE_STATUS_LABELS[row.status], row.discountAmount, row.orderAmount, kstDateTimeText(row.releasedAt)]));
  }
  if (includeIssuances && issuances) {
    addWorkbookTable(book, '발급 상세', [column('발급 ID', 'code', 38), column('쿠폰 ID', 'code', 24), column('발급일시', 'date'), column('현재 결제 사용 집계 여부', 'text', 26)],
      issuances.rows.map(row => [row.id, row.couponCode, kstDateTimeText(row.issuedAt), row.isPaidUse ? '예' : '아니오']));
  }
  const dates = adminStatsDateInputs(filters, now);
  addSafeWorkbookInfoSheet(book, [
    ['화면', '혜택 리포트'],
    ['조회기간 (KST)', `${dates.from} ~ ${dates.to}`], ['집계 단위', filters.bucket === 'week' ? '주간(월요일 시작)' : filters.bucket === 'month' ? '월간' : '일간'],
    ['검색어', filters.query || '전체'], ['할인종류', { all: '전체', fixed: '정액 할인', percent: '정률 할인' }[filters.discount]], ['타겟팅 대상', { all: '전체', first_purchase: '첫 구매 고객', repeat_purchase: '재구매 고객', targeted: '지정 고객' }[filters.segment]], ['혜택 ID', filters.code || '전체'],
    ['내려받은 시각 (KST)', kstDateTimeText(now.toISOString())],
    ['발급수', '기간 내 발급일 기준'], ['결제 사용수', '기간 내 쿠폰 적용일 기준. 현재 결제완료·발주확인·배송중·배송완료·거래확정 상태인 주문만 포함. 결제 대기·복구 제외.'],
    ['복구수', '기간 내 복구일 기준. 결제 대기 만료와 취소·반품으로 복구한 이력을 포함.'],
    ['기간 발급분 현재 사용률', '기간 내 발급된 쿠폰 중 조회 시점 결제가 유지되는 사용 수 ÷ 같은 기간 발급수. 기간 사용수/발급수와 다름.'],
    ['사용 주문금액', '할인·적립금 적용 후 주문 총액'], ['필터 기준', '혜택이름·할인종류·타겟팅 대상은 현재 쿠폰 설정 기준'],
    ['내보내기 범위', '현재 조건 전체, 혜택 및 사용 상세 각각 최대 10,000행. 한도 초과는 파일 생성 거부.'],
    ...(includeIssuances && issuances ? [
      ['상세 종류', '발급 상세'], ['발급 상세 전체 건수', issuances.totalCount.toLocaleString('ko-KR')], ['발급 상세 현재 결제 사용수', issuances.paidUseCount.toLocaleString('ko-KR')],
      ['발급 상세 조회 시각 (KST)', kstDateTimeText(issuances.asOf)],
      ['발급 상세 기준', '현재 쿠폰 조건과 기간 내 발급일 기준, 발급일시 내림차순·발급 ID 오름차순, 전체 최대 10,000건.'],
      ['현재 결제 사용 집계 여부', '예: 기간 발급분 중 현재 적용 원장과 결제가 유지되는 주문이 있는 건. 아니오는 사용 가능·미사용·환불 완료를 뜻하지 않음.'],
      ['조회 시점', '발급 상세의 행·전체 건수·현재 결제 사용수는 같은 조회 시점 기준. 별도 조회인 요약과는 발급·취소 진행에 따라 차이가 날 수 있음.'],
    ] as const : []),
  ]);
  return Buffer.from(await book.xlsx.writeBuffer());
}
