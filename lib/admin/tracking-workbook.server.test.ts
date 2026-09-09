import {describe,expect,it,vi} from 'vitest';
import ExcelJS from 'exceljs';
import {parseTrackingWorkbook} from './tracking-workbook.server';
import {GIMPO_EXPORT_HEADERS} from './warehouse-templates';
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

const order='00000000-0000-4000-8000-000000000042';
function warehouseRow(reference=order,tracking:unknown='001234567890') {const row:unknown[]=Array(21).fill('');row[8]=reference;row[20]=tracking;return row;}
describe('김포 원본 운송장 회신',()=>{
 it('21열 원본을 감지하고 동일 주문 다행을 DB 그룹 검증에 전달한다',async()=>{
  const parsed=await parseTrackingWorkbook(await bytes([[...GIMPO_EXPORT_HEADERS],warehouseRow(),warehouseRow()]),carriers);
  expect(parsed).toEqual({kind:'gimpo',rows:[{line:2,reference:order,trackingNumber:'001234567890'},{line:3,reference:order,trackingNumber:'001234567890'}],issues:[]});
 });
 it('숫자·수식 운송장 행이 있으면 같은 주문의 정상 행도 등록하지 않는다',async()=>{
  const parsed=await parseTrackingWorkbook(await bytes([[...GIMPO_EXPORT_HEADERS],warehouseRow(),warehouseRow(order,1234567890),warehouseRow('00000000-0000-4000-8000-000000000043')]),carriers);
  expect(parsed.rows).toHaveLength(1);expect(parsed.rows[0].line).toBe(4);expect(parsed.issues.map(issue=>issue.line)).toEqual([2,3]);
 });
 it('회신에 없는 주문ID를 추정하지 않고 짧은번호·누락·잘못된 운송장을 거절한다',async()=>{
  const parsed=await parseTrackingWorkbook(await bytes([[...GIMPO_EXPORT_HEADERS],warehouseRow('00000042'),warehouseRow(order,''),warehouseRow(order,'ABC')]),carriers);
  expect(parsed.rows).toEqual([]);expect(parsed.issues).toHaveLength(3);
 });
 it('일부 헤더가 바뀐 파일과 1,001행을 거절한다',async()=>{
  const headers:string[]=[...GIMPO_EXPORT_HEADERS];headers[8]='알 수 없는 주문번호';
  await expect(parseTrackingWorkbook(await bytes([headers,warehouseRow()]),carriers)).rejects.toThrow('세 컬럼');
  await expect(parseTrackingWorkbook(await bytes([[...GIMPO_EXPORT_HEADERS],...Array.from({length:1001},()=>warehouseRow())]),carriers)).rejects.toThrow('1,000줄');
 });
 it('수식 셀을 고객 정보로 출력하지 않고 안전하게 실패 처리한다',async()=>{
  const row=warehouseRow();row[2]={formula:'1+1'};
  const parsed=await parseTrackingWorkbook(await bytes([[...GIMPO_EXPORT_HEADERS],row]),carriers);
  expect(parsed.rows).toEqual([]);expect(parsed.issues[0]).toEqual({line:2,reference:order,reason:'수식은 사용할 수 없습니다.'});
 });
});
