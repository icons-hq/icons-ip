import { describe, expect, it } from 'vitest';
import ExcelJS from 'exceljs';
import { buildStoreCreditWorkbook } from './store-credit-workbook.server';
import { normalizeStoreCreditConsoleFilters } from './store-credit-console';
describe('credit workbook contents',()=>{
 it('preserves exact numeric deltas and spreadsheet text without executing customer content',async()=>{
  const bytes=await buildStoreCreditWorkbook({filters:normalizeStoreCreditConsoleFilters({mode:'ledger',query:'fan'}),total:1,rows:[{id:'123',createdAt:'2026-10-12T00:00:00Z',source:'ledger',kind:'debt_offset',reason:'=1+2',amount:-300,recipients:1,gross:-300,completed:1,purpose:'',userId:'11111111-1111-4111-8111-111111111111',orderId:null,actorId:null,batchId:null,availableDelta:-300,reservedDelta:0,debtDelta:-300,expiresAt:null,nickname:'합성 고객',maskedEmail:'f***@example.test'}]},'2026-10-12T01:00:00Z');
  const book=new ExcelJS.Workbook();await book.xlsx.load(bytes as never);const sheet=book.getWorksheet('적립금 원장')!;
  expect(sheet.getCell('G2').value).toBe(-300);expect(sheet.getCell('K2').value).toBe('=1+2');expect(sheet.getCell('K2').type).toBe(ExcelJS.ValueType.String);expect(book.getWorksheet('조회 조건')?.getCell('B6').value).toBe('fan');
 });
});
