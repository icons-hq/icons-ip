import {describe,expect,it,vi} from 'vitest';
import ExcelJS from 'exceljs';
import {parseTrackingWorkbook} from './tracking-workbook.server';
vi.mock('server-only',()=>({}));
const carriers=[{code:'hanjin',label:'한진택배',active:true,trackingUrlTemplate:'https://example.test/{trackingNumber}'}];
async function bytes(rows:unknown[][]){const w=new ExcelJS.Workbook();w.addWorksheet('운송장').addRows(rows);return Buffer.from(await w.xlsx.writeBuffer());}
describe('운송장 xlsx',()=>{
 it('1,000줄을 텍스트 운송장과 배송건번호로 읽는다',async()=>{
  const rows=Array.from({length:1000},(_,i)=>[i.toString(16).padStart(8,'0'),'hanjin',String(10000000+i)]);
  const parsed=await parseTrackingWorkbook(await bytes([['배송건번호','택배사','운송장번호'],...rows]),carriers);
  expect(parsed.rows).toHaveLength(1000);expect(parsed.issues).toEqual([]);
 });
 it('수식·숫자 식별자·잘못된 줄은 실패하고 정상 행은 유지한다',async()=>{
  const result=await parseTrackingWorkbook(await bytes([['배송건번호','택배사','운송장번호'],['00000001','hanjin',{formula:'1+1'}],['00000002','hanjin',12345678],['00000003','hanjin','00123456']]),carriers);
  expect(result.issues.map(row=>row.line)).toEqual([2,3]);expect(result.rows[0]).toMatchObject({line:4,trackingNumber:'00123456'});
 });
 it('1,001줄·추가 컬럼을 거절한다',async()=>{
  await expect(parseTrackingWorkbook(await bytes(Array.from({length:1002},()=>['00000001','hanjin','12345678'])),carriers)).rejects.toThrow('1,000줄');
  await expect(parseTrackingWorkbook(await bytes([['00000001','hanjin','12345678','extra']]),carriers)).rejects.toThrow('세 컬럼');
 });
});
