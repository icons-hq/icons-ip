import 'server-only';
import ExcelJS from 'exceljs';
import { settlementAccountLabel } from './accounts';
import { kstDateTimeText } from '@/lib/admin/list-export';
import { addSafeWorkbookInfoSheet, addWorkbookTable, tableColumn as column } from '@/lib/admin/workbook-table';
import type { PgSettlementFilters } from './console';
import { PG_SETTLEMENT_FEE_LABELS, PG_SETTLEMENT_KIND_LABELS, PG_SETTLEMENT_MATCH_LABELS, type PgSettlementReport } from './report';

/** Amount cells are text: Excel's 15-digit limit must not alter PG decimals. */
export async function buildPgSettlementWorkbook(report: PgSettlementReport, filters: PgSettlementFilters, generatedAt: Date): Promise<Buffer> {
  if (!report.snapshot || report.coverage === 'uncollected' || !report.fingerprint
    || report.transactions.length !== report.pagination.total || report.transactions.length > 20_000) throw new Error('settlement_export_incomplete');
  const book = new ExcelJS.Workbook(); book.creator = 'ICONS'; book.created = generatedAt; book.modified = generatedAt;
  addWorkbookTable(book, '건별 정산내역', [
    column('주문번호', 'code', 18), column('거래 구분', 'text', 12), column('통화', 'text', 8), column('결제수단', 'text', 16),
    column('거래금액 원문', 'text', 26), column('지급액 원문', 'text', 26), column('취소금액 원문', 'text', 26),
    column('할부 수수료 원문', 'text', 24), column('수수료 공급가', 'text', 24), column('수수료 부가세', 'text', 24),
    column('정산 매출일', 'date', 15), column('정산 지급일', 'date', 15), column('승인 시각', 'date', 18), column('취소 시각', 'date', 18),
    column('수집 시점 대조', 'text', 18), column('대조 코드', 'code', 34), column('수수료 항목별 원문', 'text', 65),
  ], report.transactions.map(row => [row.orderNumber, PG_SETTLEMENT_KIND_LABELS[row.kind], row.currency, row.method,
    row.amount, row.payOutAmount, row.cancelAmount, row.interestFee, row.supplyAmount, row.vat,
    row.soldDate, row.paidOutDate, kstDateTimeText(row.approvedAt), kstDateTimeText(row.canceledAt), PG_SETTLEMENT_MATCH_LABELS[row.matchState], row.matchReason,
    row.fees.map(fee => `${PG_SETTLEMENT_FEE_LABELS[fee.type] ?? fee.type}: ${fee.fee}`).join(' / ')]));
  addWorkbookTable(book, '일별 정산내역', [
    column('기준일', 'date', 15), column('거래 구분', 'text', 12), column('통화', 'text', 8), column('거래수', 'count', 12),
    column('거래금액 원문 합계', 'text', 28), column('수수료 원문 합계', 'text', 26), column('할부 수수료 원문 합계', 'text', 28),
    column('수수료 공급가 합계', 'text', 26), column('수수료 부가세 합계', 'text', 26), column('지급액 원문 합계', 'text', 28), column('취소금액 원문 합계', 'text', 28),
  ], report.daily.map(row => [row.date, PG_SETTLEMENT_KIND_LABELS[row.kind], row.currency, row.count, row.amount, row.feeAmount, row.interestFee, row.supplyAmount, row.vat, row.payOutAmount, row.cancelAmount]));
  addWorkbookTable(book, '수수료 내역', [column('통화', 'text', 8), column('거래 구분', 'text', 12), column('수수료 항목', 'text', 32), column('거래수', 'count', 12), column('수수료 원문 합계', 'text', 28)],
    report.fees.map(row => [row.currency, PG_SETTLEMENT_KIND_LABELS[row.kind], PG_SETTLEMENT_FEE_LABELS[row.type] ?? row.type, row.count, row.fee]));
  addSafeWorkbookInfoSheet(book, [
    ['화면', '정산 내역 (일별/건별)'],
    ['공급자', '토스페이먼츠'], ['정산 계정', settlementAccountLabel(report.snapshot)], ['결제 연동', report.snapshot.integration], ['조회 환경', filters.mode === 'live' ? '실거래' : '테스트'], ['조회 기준', filters.dateType === 'paidOutDate' ? '정산 지급일' : '정산 매출일'],
    ['기간', `${filters.startDate} ~ ${filters.endDate}`], ['거래 구분', filters.kind === 'all' ? '전체' : PG_SETTLEMENT_KIND_LABELS[filters.kind]],
    ['대조', filters.match === 'all' ? '전체' : PG_SETTLEMENT_MATCH_LABELS[filters.match]], ['통화', filters.currency || '전체'], ['주문번호 검색', filters.query || '전체'],
    ['자료 ID', report.snapshot.id], ['수집 완료 시각 (KST)', kstDateTimeText(report.snapshot.completedAt)], ['전체 수집 거래수', String(report.snapshot.recordCount)],
    ['검색 결과 거래수', String(report.pagination.total)], ['자료 지문', report.fingerprint], ['내려받은 시각 (KST)', kstDateTimeText(generatedAt.toISOString())],
    ['금액 읽기', '큰 금액과 소수 수수료를 보존하기 위해 금액 셀은 텍스트 형식입니다. 승인·취소와 통화별 원문을 각각 집계했습니다.'],
    ['대조 기준', 'ICONS 결제·환불 원장의 대조 결과는 자료 수집 완료 시점에 고정되어 있습니다. 이후 변화는 다시 수집해 확인합니다.'],
    ['자료 범위', 'PG 조회 자료이며 은행 실입금 확인서, 세금계산서 또는 법정 세무 신고자료가 아닙니다. 취소 부호를 임의 변환한 순입금액은 제공하지 않습니다.'],
  ]);
  return Buffer.from(await book.xlsx.writeBuffer());
}
