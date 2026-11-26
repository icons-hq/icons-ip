import 'server-only';
import ExcelJS from 'exceljs';
import { settlementAccountLabel } from './accounts';
import { kstDateTimeText } from '@/lib/admin/list-export';
import { addSafeWorkbookInfoSheet, addWorkbookTable, tableColumn as column } from '@/lib/admin/workbook-table';
import type { PgSettlementFilters } from './console';
import { PG_SETTLEMENT_KIND_LABELS, PG_SETTLEMENT_MATCH_LABELS, pgSettlementFeeLabel, pgSettlementMatchReason, type PgSettlementReport } from './report';

/**
 * Amount cells are text: Excel's 15-digit limit must not alter PG decimals.
 * 시트·열·정보 이름은 정산 내역 화면과 같은 말을 쓴다(가져오기 · 비교 결과 · 맞음/연결 안 됨/다름). 금액은 결제사가 준 값 그대로다.
 */
export async function buildPgSettlementWorkbook(report: PgSettlementReport, filters: PgSettlementFilters, generatedAt: Date): Promise<Buffer> {
  if (!report.snapshot || report.coverage === 'uncollected' || !report.fingerprint
    || report.transactions.length !== report.pagination.total || report.transactions.length > 20_000) throw new Error('settlement_export_incomplete');
  const book = new ExcelJS.Workbook(); book.creator = '엑스스퀘어'; book.created = generatedAt; book.modified = generatedAt;
  addWorkbookTable(book, '건별 정산 내역', [
    column('주문번호', 'code', 18), column('거래 구분', 'text', 12), column('통화', 'text', 8), column('결제수단', 'text', 16),
    column('거래금액', 'text', 26), column('지급액', 'text', 26), column('취소금액', 'text', 26),
    column('할부 수수료', 'text', 24), column('수수료 공급가', 'text', 24), column('수수료 부가세', 'text', 24),
    column('정산 매출일', 'date', 15), column('정산 지급일', 'date', 15), column('승인 시각', 'date', 18), column('취소 시각', 'date', 18),
    column('비교 결과', 'text', 18), column('비교한 이유', 'text', 44), column('수수료 항목별 금액', 'text', 65),
  ], report.transactions.map(row => [row.orderNumber, PG_SETTLEMENT_KIND_LABELS[row.kind], row.currency, row.method,
    row.amount, row.payOutAmount, row.cancelAmount, row.interestFee, row.supplyAmount, row.vat,
    row.soldDate, row.paidOutDate, kstDateTimeText(row.approvedAt), kstDateTimeText(row.canceledAt), PG_SETTLEMENT_MATCH_LABELS[row.matchState], pgSettlementMatchReason(row.matchReason),
    row.fees.map(fee => `${pgSettlementFeeLabel(fee.type)}: ${fee.fee}`).join(' / ')]));
  addWorkbookTable(book, '일별 정산 내역', [
    column('기준일', 'date', 15), column('거래 구분', 'text', 12), column('통화', 'text', 8), column('거래수', 'count', 12),
    column('거래금액 합계', 'text', 28), column('수수료 합계', 'text', 26), column('할부 수수료 합계', 'text', 28),
    column('수수료 공급가 합계', 'text', 26), column('수수료 부가세 합계', 'text', 26), column('지급액 합계', 'text', 28), column('취소금액 합계', 'text', 28),
  ], report.daily.map(row => [row.date, PG_SETTLEMENT_KIND_LABELS[row.kind], row.currency, row.count, row.amount, row.feeAmount, row.interestFee, row.supplyAmount, row.vat, row.payOutAmount, row.cancelAmount]));
  addWorkbookTable(book, '수수료 내역', [column('통화', 'text', 8), column('거래 구분', 'text', 12), column('수수료 항목', 'text', 32), column('거래수', 'count', 12), column('수수료 합계', 'text', 28)],
    report.fees.map(row => [row.currency, PG_SETTLEMENT_KIND_LABELS[row.kind], pgSettlementFeeLabel(row.type), row.count, row.fee]));
  addSafeWorkbookInfoSheet(book, [
    ['화면', '정산 내역'],
    ['결제사', '토스페이먼츠'], ['정산 계정', settlementAccountLabel(report.snapshot)], ['자료 구분', filters.mode === 'live' ? '실거래 자료' : '테스트 자료'], ['조회 기준', filters.dateType === 'paidOutDate' ? '정산 지급일' : '정산 매출일'],
    ['기간', `${filters.startDate} ~ ${filters.endDate}`], ['거래 구분', filters.kind === 'all' ? '전체' : PG_SETTLEMENT_KIND_LABELS[filters.kind]],
    ['비교 결과', filters.match === 'all' ? '전체' : PG_SETTLEMENT_MATCH_LABELS[filters.match]], ['통화', filters.currency || '전체'], ['주문번호 검색', filters.query || '전체'],
    ['자료 번호', report.snapshot.id], ['자료를 가져온 시각 (KST)', kstDateTimeText(report.snapshot.completedAt)], ['가져온 전체 거래수', String(report.snapshot.recordCount)],
    ['검색 결과 거래수', String(report.pagination.total)], ['자료 지문', report.fingerprint], ['내려받은 시각 (KST)', kstDateTimeText(generatedAt.toISOString())],
    ['금액 읽기', '큰 금액과 소수점 수수료가 바뀌지 않게 금액 칸은 텍스트 형식입니다. 승인·취소와 통화별로 결제사가 준 값을 그대로 더했습니다.'],
    ['비교 기준', '엑스스퀘어 결제·환불 기록과 비교한 결과는 자료를 가져온 시점 그대로입니다. 그 뒤 바뀐 내용은 다시 가져와 확인합니다.'],
    ['자료 범위', '결제사에서 가져온 자료이며 은행 실입금 확인서, 세금계산서, 세무 신고자료가 아닙니다. 취소 금액의 부호를 바꿔 계산한 순입금액은 넣지 않았습니다.'],
  ]);
  return Buffer.from(await book.xlsx.writeBuffer());
}
