import 'server-only';
import ExcelJS from 'exceljs';
import { DEMOGRAPHIC_GENDER_LABELS } from '@/lib/customer-demographics';
import { DEMOGRAPHIC_AGE_LABELS, DEMOGRAPHIC_REPORT_NOTICE, parseDemographicReport, type DemographicReport } from './customer-demographics';
import { kstDateTimeText } from './list-export';
import { addSafeWorkbookInfoSheet, addWorkbookTable, tableColumn as column } from './workbook-table';

export async function buildCustomerDemographicWorkbook(input: DemographicReport, generatedAt = new Date()) {
  const data = parseDemographicReport(input);
  if (!data) throw new Error('Invalid protected demographic report');
  const book = new ExcelJS.Workbook(); book.creator = 'ICONS'; book.created = generatedAt;
  addWorkbookTable(book, '성별·연령별 고객수', [column('연령대', 'text', 22), column('성별', 'text', 18), column('고객수', 'number', 18)],
    data.cells.map(cell => [DEMOGRAPHIC_AGE_LABELS[cell.ageBand], DEMOGRAPHIC_GENDER_LABELS[cell.gender], cell.count === null ? '비공개' : cell.count]));
  addSafeWorkbookInfoSheet(book, [
    ['화면', '성별·연령 통계'],
    ['대상', data.scope === 'members' ? '현재 가입 회원' : '기간 내 결제 고객'],
    ['기간', data.from ? `${data.from} ~ ${data.to}` : '조회 시점 현재'], ['연령 기준일 (KST)', data.ageAsOf],
    ['집계 시각 (KST)', kstDateTimeText(data.asOf)], ['내려받은 시각 (KST)', kstDateTimeText(generatedAt.toISOString())], ['최소 공개 인원', '10'], ['보호 기준', DEMOGRAPHIC_REPORT_NOTICE],
    ['성별', '현재 별도 선택 동의를 유지한 자가 입력값. 결제는 동의 이후 이력에만 사용. 미선택·철회·동의 전 결제는 미제공.'],
    ['대상 제외', '정지·탈퇴 신청 계정. 생년월일 기준 14세 미만 또는 확인 불가.'],
    ['결제 기준', '실제 승인·입금 이력이 있는 상품 주문. 이후 취소·환불 포함, 고객별 중복 제거.'],
  ]);
  return Buffer.from(await book.xlsx.writeBuffer());
}
