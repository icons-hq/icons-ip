import { describe, expect, it } from 'vitest';
import ExcelJS from 'exceljs';
import { readStoreCreditTargetsFile } from './store-credit-target-file.server';
describe('credit target import',()=>{
 it('reads a single-column UTF-8 CSV and removes duplicate targets',async()=>{
  expect(await readStoreCreditTargetsFile('대상.csv',Buffer.from('\uFEFF고객 ID 또는 이메일\r\nfan@example.test\r\nFAN@example.test'))).toEqual({targets:['fan@example.test'],duplicates:1});
 });
 it('rejects multi-column, malformed and oversized target imports',async()=>{
  await expect(readStoreCreditTargetsFile('a.csv',Buffer.from('고객ID,금액\nfan@example.test,1000'))).rejects.toThrow();
  await expect(readStoreCreditTargetsFile('a.csv',Buffer.from('"fan@example.test'))).rejects.toThrow('따옴표');
  await expect(readStoreCreditTargetsFile('a.csv',Buffer.alloc(500*1024+1))).rejects.toThrow('500KB');
 });
 it('reads XLSX identifiers as text and rejects cached formula values',async()=>{
  const workbook=new ExcelJS.Workbook();const sheet=workbook.addWorksheet('대상');sheet.addRows([['고객 ID 또는 이메일'],['fan@example.test']]);
  expect((await readStoreCreditTargetsFile('a.xlsx',Buffer.from(await workbook.xlsx.writeBuffer()))).targets).toEqual(['fan@example.test']);
  sheet.getCell('A2').value={formula:'"fan@example.test"',result:'fan@example.test'};
  await expect(readStoreCreditTargetsFile('a.xlsx',Buffer.from(await workbook.xlsx.writeBuffer()))).rejects.toThrow('수식');
 });
});
