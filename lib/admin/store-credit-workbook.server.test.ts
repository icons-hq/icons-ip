import { describe, expect, it } from 'vitest';
import ExcelJS from 'exceljs';
import { buildStoreCreditWorkbook } from './store-credit-workbook.server';
import { normalizeStoreCreditConsoleFilters } from './store-credit-console';
describe('credit workbook contents',()=>{
 it('preserves exact numeric deltas and spreadsheet text without executing customer content',async()=>{
  const bytes=await buildStoreCreditWorkbook({filters:normalizeStoreCreditConsoleFilters({mode:'ledger',query:'fan'}),total:1,rows:[{id:'123',createdAt:'2026-10-12T00:00:00Z',source:'ledger',kind:'debt_offset',reason:'=1+2',amount:-300,recipients:1,gross:-300,completed:1,purpose:'',userId:'11111111-1111-4111-8111-111111111111',orderId:null,actorId:null,batchId:null,availableDelta:-300,reservedDelta:0,debtDelta:-300,expiresAt:null,nickname:'합성 고객',maskedEmail:'f***@example.test'}]},'2026-10-12T01:00:00Z');
  const book=new ExcelJS.Workbook();await book.xlsx.load(bytes as never);const sheet=book.getWorksheet('적립금 원장')!;
  expect(sheet.getCell('G2').value).toBe(-300);expect(sheet.getCell('K2').value).toBe('=1+2');expect(sheet.getCell('K2').type).toBe(ExcelJS.ValueType.String);expect(sheet.getCell('A1').font).toMatchObject({name:'맑은 고딕',size:10,bold:true});expect(sheet.getCell('A1').fill).toMatchObject({fgColor:{argb:'FFEFF2F0'}});expect(sheet.getCell('G2').numFmt).toBe('#,##0');expect(sheet.getRow(1).values).toEqual([,'원장번호','발생일시','내역 구분','고객 ID','고객명','이메일(마스킹)','금액','사용 가능 변동','사용 대기 변동','회수 대기 변동','사유','주문번호','지급 작업 ID','처리자 ID','만료일시']);expect(sheet.getCell('B2').value).toBe('2026-10-12 09:00');
  const info=Object.fromEntries(book.worksheets.at(-1)!.getSheetValues().flatMap(row=>Array.isArray(row)?[[String(row[1]),String(row[2])]]:[]));expect(book.worksheets.at(-1)?.name).toBe('내려받기 정보');expect(info).toMatchObject({화면:'적립금 지급관리 - 적립금 원장',검색어:'fan','내려받은 시각 (KST)':'2026-10-12 10:00',건수:'1행'});
 });
});
