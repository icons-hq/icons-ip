import 'server-only';
import ExcelJS from 'exceljs';
import type { StoreCreditConsoleData } from './store-credit-console';
import { storeCreditEntryLabel } from '@/lib/store-credits';
import { formatOrderDateTime } from '@/lib/orders';
export async function buildStoreCreditWorkbook(data: StoreCreditConsoleData, capturedAt: string): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook(); workbook.creator = 'ICONS'; workbook.created = new Date(capturedAt);
  const ledger = data.filters.mode === 'ledger'; const sheet = workbook.addWorksheet(ledger ? '적립금 원장' : '지급관리');
  const headers = ledger ? ['원장번호','발생일시(KST)','내역 구분','고객 ID','고객명','이메일(마스킹)','금액','사용 가능 변동','사용 대기 변동','회수 대기 변동','사유','주문번호','지급 작업 ID','처리자 ID','만료일시(KST)']
    : ['작업 ID','등록일시(KST)','처리상태','지급 방식','지급 목적','사유','대상 수','성공 수','실패 수','1인 지급액','총 발급 예정액','처리자 ID','만료일시(KST)'];
  sheet.columns = headers.map(header => ({ header,width: /사유/.test(header) ? 40 : /ID|번호/.test(header) ? 38 : 22 }));
  const statuses: Record<string,string> = {prepared:'확인 대기',completed:'지급 완료',failed:'전체 실패'};
  for (const row of data.rows) {
    const values = ledger ? [row.id,formatOrderDateTime(row.createdAt),storeCreditEntryLabel(row.kind),row.userId,row.nickname,row.maskedEmail,row.amount,row.availableDelta,row.reservedDelta,row.debtDelta,row.reason,row.orderId,row.batchId,row.actorId,row.expiresAt ? formatOrderDateTime(row.expiresAt) : '']
      : [row.id,formatOrderDateTime(row.createdAt),statuses[row.kind] ?? row.kind,row.source === 'individual' ? '기존 고객별 지급' : '일괄 지급',row.purpose === 'promotion' ? '구매 프로모션' : '일반 운영 지급',row.reason,row.recipients,row.completed,row.kind === 'failed' ? row.recipients : 0,row.amount,row.gross,row.actorId,row.expiresAt ? formatOrderDateTime(row.expiresAt) : ''];
    const added = sheet.addRow(values); added.eachCell(cell => { cell.numFmt = typeof cell.value === 'number' ? '#,##0' : '@'; });
  }
  sheet.views = [{state:'frozen',ySplit:1}]; sheet.getRow(1).font = {bold:true}; sheet.autoFilter = {from:{row:1,column:1},to:{row:Math.max(1,sheet.rowCount),column:headers.length}};
  const info = workbook.addWorksheet('조회 조건');
  info.columns = [{header:'항목',width:24},{header:'내용',width:90}];
  info.addRows([['캡처시각',capturedAt],['조회 시작일(KST)',data.filters.from],['조회 종료일(KST)',data.filters.to],['종류',data.filters.kind || '전체'],['검색어',data.filters.query],['전체 행 수',data.total],['범위','화면과 같은 조건의 전체 검색 결과. 최대 10,000행.'],['금액 해석','지급관리의 예정액은 실패·미실행 건에도 남습니다. 실제 지급은 지급 완료 상태와 원장의 운영 지급·상계 변동을 함께 확인합니다.'],['개인정보','업무 목적만 사용하고 보관 기간이 지나면 삭제하세요. 이 파일은 암호화되지 않았습니다.']]);
  return Buffer.from(await workbook.xlsx.writeBuffer());
}
