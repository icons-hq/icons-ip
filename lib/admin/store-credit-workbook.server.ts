import 'server-only';
import ExcelJS from 'exceljs';
import type { StoreCreditConsoleData } from './store-credit-console';
import { storeCreditEntryLabel } from '@/lib/store-credits';
import { kstDateTimeText, listExportPeriodLabel } from './list-export';
import { addSafeWorkbookInfoSheet, addWorkbookTable, tableColumn as column } from './workbook-table';

const BATCH_STATUS_LABELS: Record<string, string> = { prepared: '확인 대기', completed: '지급 완료', failed: '전체 실패' };
const BATCH_COLUMNS = [
  column('작업 ID', 'code', 38), column('등록일시', 'date'), column('처리상태', 'text', 12), column('지급 방식', 'text', 16), column('지급 목적', 'text', 16), column('사유', 'text', 40),
  column('대상 수', 'count'), column('성공 수', 'count'), column('실패 수', 'count'), column('1인 지급액', 'amount'), column('총 발급 예정액', 'amount'), column('처리자 ID', 'code', 38), column('만료일시', 'date'),
];
const LEDGER_COLUMNS = [
  column('원장번호', 'code', 38), column('발생일시', 'date'), column('내역 구분', 'text', 16), column('고객 ID', 'code', 38), column('고객명', 'text', 16), column('이메일(마스킹)', 'text', 26),
  column('금액', 'amount'), column('사용 가능 변동', 'amount'), column('사용 대기 변동', 'amount'), column('회수 대기 변동', 'amount'), column('사유', 'text', 40),
  column('주문번호', 'code', 38), column('지급 작업 ID', 'code', 38), column('처리자 ID', 'code', 38), column('만료일시', 'date'),
];

export async function buildStoreCreditWorkbook(data: StoreCreditConsoleData, capturedAt: string): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook(); workbook.creator = 'ICONS'; workbook.created = new Date(capturedAt);
  const { filters } = data, ledger = filters.mode === 'ledger';
  addWorkbookTable(workbook, ledger ? '적립금 원장' : '지급관리', ledger ? LEDGER_COLUMNS : BATCH_COLUMNS, data.rows.map(row => ledger
    ? [row.id, kstDateTimeText(row.createdAt), storeCreditEntryLabel(row.kind), row.userId, row.nickname, row.maskedEmail, row.amount, row.availableDelta, row.reservedDelta, row.debtDelta, row.reason, row.orderId, row.batchId, row.actorId, kstDateTimeText(row.expiresAt)]
    : [row.id, kstDateTimeText(row.createdAt), BATCH_STATUS_LABELS[row.kind] ?? row.kind, row.source === 'individual' ? '기존 고객별 지급' : '일괄 지급', row.purpose === 'promotion' ? '구매 프로모션' : '일반 운영 지급', row.reason, row.recipients, row.completed, row.kind === 'failed' ? row.recipients : 0, row.amount, row.gross, row.actorId, kstDateTimeText(row.expiresAt)]));
  addSafeWorkbookInfoSheet(workbook, [
    ['화면', ledger ? '적립금 지급관리 - 적립금 원장' : '적립금 지급관리 - 지급 작업'],
    ['기간', listExportPeriodLabel(filters.from || null, filters.to || null)],
    ['종류', !filters.kind ? '전체' : ledger ? storeCreditEntryLabel(filters.kind) : BATCH_STATUS_LABELS[filters.kind] ?? filters.kind],
    ['검색어', filters.query || '전체'],
    ['내려받은 시각 (KST)', kstDateTimeText(capturedAt)],
    ['건수', `${data.total.toLocaleString('ko-KR')}행`],
    ['범위', '화면과 같은 조건의 전체 검색 결과. 최대 10,000행.'],
    ['금액 해석', '지급관리의 예정액은 실패·미실행 건에도 남습니다. 실제 지급은 지급 완료 상태와 원장의 운영 지급·상계 변동을 함께 확인합니다.'],
    ['개인정보', '업무 목적만 사용하고 보관 기간이 지나면 삭제하세요. 이 파일은 암호화되지 않았습니다.'],
  ]);
  return Buffer.from(await workbook.xlsx.writeBuffer());
}
