import 'server-only';
import ExcelJS from 'exceljs';
import { settlementAccountLabel } from './accounts';
import { kstDateTimeText } from '@/lib/admin/list-export';
import type { PgSettlementFilters } from './console';
import { PG_SETTLEMENT_FEE_LABELS, PG_SETTLEMENT_KIND_LABELS, PG_SETTLEMENT_MATCH_LABELS, type PgSettlementReport } from './report';

/** Amount cells are text: Excel's 15-digit limit must not alter PG decimals. */
export async function buildPgSettlementWorkbook(report: PgSettlementReport, filters: PgSettlementFilters, generatedAt: Date): Promise<Buffer> {
  if (!report.snapshot || report.coverage === 'uncollected' || !report.fingerprint
    || report.transactions.length !== report.pagination.total || report.transactions.length > 20_000) throw new Error('settlement_export_incomplete');
  const book = new ExcelJS.Workbook(); book.creator = 'ICONS'; book.created = generatedAt; book.modified = generatedAt;
  const addSheet = (name: string, columns: { title: string; width: number; count?: boolean }[], rows: (string | number | null)[][]) => {
    const sheet = book.addWorksheet(name);
    sheet.columns = columns.map(column => ({ width: column.width, style: { font: { name: '맑은 고딕', size: 10 }, numFmt: column.count ? '#,##0' : '@' } }));
    const header = sheet.addRow(columns.map(column => column.title)); header.height = 25;
    header.eachCell(cell => { cell.font = { name: '맑은 고딕', size: 10, bold: true }; cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEFF2F0' } }; cell.numFmt = '@'; });
    for (const row of rows) sheet.addRow(row);
    sheet.views = [{ state: 'frozen', ySplit: 1 }];
    sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: Math.max(sheet.rowCount, 1), column: columns.length } };
  };
  addSheet('건별 정산내역', [
    { title: 'ICONS 주문번호', width: 18 }, { title: '거래 구분', width: 12 }, { title: '통화', width: 8 }, { title: '결제수단', width: 16 },
    { title: '거래금액 원문', width: 26 }, { title: '지급액 원문', width: 26 }, { title: '취소금액 원문', width: 26 },
    { title: '할부 수수료 원문', width: 24 }, { title: '수수료 공급가', width: 24 }, { title: '수수료 부가세', width: 24 },
    { title: '정산 매출일', width: 15 }, { title: '정산 지급일', width: 15 }, { title: '승인 시각 KST', width: 23 }, { title: '취소 시각 KST', width: 23 },
    { title: '수집 시점 대조', width: 18 }, { title: '대조 코드', width: 34 }, { title: '수수료 항목별 원문', width: 65 },
  ], report.transactions.map(row => [row.orderNumber, PG_SETTLEMENT_KIND_LABELS[row.kind], row.currency, row.method,
    row.amount, row.payOutAmount, row.cancelAmount, row.interestFee, row.supplyAmount, row.vat,
    row.soldDate, row.paidOutDate, kstDateTimeText(row.approvedAt), kstDateTimeText(row.canceledAt), PG_SETTLEMENT_MATCH_LABELS[row.matchState], row.matchReason,
    row.fees.map(fee => `${PG_SETTLEMENT_FEE_LABELS[fee.type] ?? fee.type}: ${fee.fee}`).join(' / ')]));
  addSheet('일별 정산내역', [
    { title: '기준일', width: 15 }, { title: '거래 구분', width: 12 }, { title: '통화', width: 8 }, { title: '거래수', width: 12, count: true },
    { title: '거래금액 원문 합계', width: 28 }, { title: '수수료 원문 합계', width: 26 }, { title: '할부 수수료 원문 합계', width: 28 },
    { title: '수수료 공급가 합계', width: 26 }, { title: '수수료 부가세 합계', width: 26 }, { title: '지급액 원문 합계', width: 28 }, { title: '취소금액 원문 합계', width: 28 },
  ], report.daily.map(row => [row.date, PG_SETTLEMENT_KIND_LABELS[row.kind], row.currency, row.count, row.amount, row.feeAmount, row.interestFee, row.supplyAmount, row.vat, row.payOutAmount, row.cancelAmount]));
  addSheet('수수료 내역', [{ title: '통화', width: 8 }, { title: '거래 구분', width: 12 }, { title: '수수료 항목', width: 32 }, { title: '거래수', width: 12, count: true }, { title: '수수료 원문 합계', width: 28 }],
    report.fees.map(row => [row.currency, PG_SETTLEMENT_KIND_LABELS[row.kind], PG_SETTLEMENT_FEE_LABELS[row.type] ?? row.type, row.count, row.fee]));
  const info = book.addWorksheet('조회 정보'); info.columns = [{ width: 24 }, { width: 100 }];
  const information: [string, string][] = [
    ['공급자', '토스페이먼츠'], ['정산 계정', settlementAccountLabel(report.snapshot)], ['결제 연동', report.snapshot.integration], ['조회 환경', filters.mode === 'live' ? '실거래' : '테스트'], ['조회 기준', filters.dateType === 'paidOutDate' ? '정산 지급일' : '정산 매출일'],
    ['기간', `${filters.startDate} ~ ${filters.endDate}`], ['거래 구분', filters.kind === 'all' ? '전체' : PG_SETTLEMENT_KIND_LABELS[filters.kind]],
    ['대조', filters.match === 'all' ? '전체' : PG_SETTLEMENT_MATCH_LABELS[filters.match]], ['통화', filters.currency || '전체'], ['ICONS 주문번호 검색', filters.query],
    ['자료 ID', report.snapshot.id], ['수집 완료 시각 KST', kstDateTimeText(report.snapshot.completedAt)], ['전체 수집 거래수', String(report.snapshot.recordCount)],
    ['검색 결과 거래수', String(report.pagination.total)], ['자료 지문', report.fingerprint], ['파일 생성 시각 KST', kstDateTimeText(generatedAt.toISOString())],
    ['금액 읽기', '큰 금액과 소수 수수료를 보존하기 위해 금액 셀은 텍스트 형식입니다. 승인·취소와 통화별 원문을 각각 집계했습니다.'],
    ['대조 기준', 'ICONS 결제·환불 원장의 대조 결과는 자료 수집 완료 시점에 고정되어 있습니다. 이후 변화는 다시 수집해 확인합니다.'],
    ['자료 범위', 'PG 조회 자료이며 은행 실입금 확인서, 세금계산서 또는 법정 세무 신고자료가 아닙니다. 취소 부호를 임의 변환한 순입금액은 제공하지 않습니다.'],
  ];
  for (const values of information) {
    const row = info.addRow(values); row.getCell(1).font = { name: '맑은 고딕', size: 10, bold: true }; row.getCell(2).font = { name: '맑은 고딕', size: 10 };
    row.eachCell(cell => { cell.numFmt = '@'; cell.alignment = { wrapText: true, vertical: 'top' }; });
  }
  return Buffer.from(await book.xlsx.writeBuffer());
}
