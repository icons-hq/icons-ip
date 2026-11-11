import {afterEach,describe,expect,it,vi} from 'vitest';
import ExcelJS from 'exceljs';
import JSZip from 'jszip';
import officeCrypto from 'officecrypto-tool';
import {encryptAdminWorkbook} from './encrypted-workbook.server';
import {parseTrackingWorkbook} from './tracking-workbook.server';
import {GIMPO_EXPORT_HEADERS,SEOWON_EXPORT_HEADERS} from './warehouse-templates';
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

describe('남양주(서원) 송장양식 회신',()=>{
 const seowon=(phone:unknown,quantity:unknown,tracking:unknown,items='합성 키링_빨강',shipmentNumber:unknown='')=>[phone,'','04524','서울 중구 세종대로 110','',quantity,items,'합성 받는분','',shipmentNumber,'빨강','0880123456789','합성 키링 빨강','2026102710000001',tracking];
 async function workbook(rows:unknown[][],extraSheets:unknown[][][]=[]){
  const w=new ExcelJS.Workbook();w.addWorksheet('송장양식').addRows(rows);
  extraSheets.forEach((sheet,i)=>w.addWorksheet(`Sheet${i+1}`).addRows(sheet));return Buffer.from(await w.xlsx.writeBuffer());
 }
 it('7열 헤더 뒤의 송장번호(동의어 포함) 열을 찾고 숫자로 저장된 13자리 번호·0이 빠진 휴대전화를 복원한다',async()=>{
  const parsed=await parseTrackingWorkbook(await workbook([[...SEOWON_EXPORT_HEADERS,'등기 번호'],seowon(1012345678,2,6012345678901),seowon('010-1234-5678','1,000','6012-3456-78902')],[[],[]]),carriers);
  expect(parsed).toMatchObject({kind:'seowon',issues:[]});
  expect((parsed as {rows:unknown[]}).rows).toEqual([
   {line:2,phone:'01012345678',address:'서울 중구 세종대로 110',items:'합성 키링_빨강',quantity:2,trackingNumber:'6012345678901',recipient:'합성 받는분'},
   {line:3,phone:'010-1234-5678',address:'서울 중구 세종대로 110',items:'합성 키링_빨강',quantity:1000,trackingNumber:'6012345678902',recipient:'합성 받는분'},
  ]);
 });
 it('덧붙인 배송건번호는 텍스트 16자리일 때만 대조에 쓰고 숫자 칸·다른 값은 버린다',async()=>{
  const parsed=await parseTrackingWorkbook(await workbook([[...SEOWON_EXPORT_HEADERS,'송장번호'],seowon('010-1','1','6012345678901','합성 키링_빨강','2026102730000001'),
   seowon('010-2','1','6012345678902','합성 키링_빨강',2026102730000002),seowon('010-3','1','6012345678903','합성 키링_빨강','2026102710000003')]),carriers);
  expect((parsed as {rows:{line:number;shipmentNumber?:string;error?:string}[]}).rows.map(row=>[row.line,row.shipmentNumber,row.error])).toEqual([
   [2,'2026102730000001',undefined],[3,undefined,undefined],[4,undefined,undefined],
  ]);
 });
 it('빈 송장·자릿수가 유실될 수 있는 숫자 송장·잘못된 수량은 줄 오류로 남긴다',async()=>{
  const parsed=await parseTrackingWorkbook(await workbook([[...SEOWON_EXPORT_HEADERS,'송장번호'],seowon('010-1','1',''),seowon('010-2','1',12345678),seowon('010-3','0','6012345678903'),seowon('010-4','1',{formula:'1+1'})]),carriers);
  expect((parsed as {rows:{line:number;error?:string}[]}).rows.map(row=>[row.line,row.error])).toEqual([
   [2,'송장번호가 비어 있습니다. 출고하지 않은 줄이면 해당 배송 건의 줄을 모두 빼고 올려주세요.'],
   [3,'송장번호는 텍스트 형식으로 입력해주세요.'],[4,'수량은 1 이상의 숫자여야 합니다.'],[5,'수식은 사용할 수 없습니다.'],
  ]);
 });
 it('송장번호 열이 없거나 내용이 있는 시트가 둘이면 파일 단계에서 거절한다',async()=>{
  await expect(parseTrackingWorkbook(await workbook([[...SEOWON_EXPORT_HEADERS],seowon('010','1','6012345678901').slice(0,13)]),carriers)).rejects.toThrow('송장번호 열');
  await expect(parseTrackingWorkbook(await workbook([[...SEOWON_EXPORT_HEADERS,'송장번호']],[[['다른 내용']]]),carriers)).rejects.toThrow('시트 하나');
 });
});

// 실제 Agile 암호화·복호화는 키마다 SHA-512를 100,000번 돌려 CI 러너에서 테스트 하나가 2~5초 걸린다.
describe('비밀번호를 건 회신 파일',{timeout:20_000},()=>{
 const password='Sample-1234';
 const sealed=(plain:Buffer)=>encryptAdminWorkbook(plain,password).bytes;
 const threeColumns=()=>bytes([['배송건번호','택배사','운송장번호'],['00000001','hanjin','00123456']]);
 const gimpo=()=>bytes([[...GIMPO_EXPORT_HEADERS],warehouseRow()]);
 const seowon=()=>bytes([[...SEOWON_EXPORT_HEADERS,'송장번호'],['010-1234-5678','','04524','서울 중구 세종대로 110','','1','합성 키링_빨강','합성 받는분','','','빨강','0880123456789','합성 키링 빨강','6012345678901']]);
 const smartStore=async()=>{const w=new ExcelJS.Workbook();w.addWorksheet('발송처리').addRows([['상품주문번호','배송방법','택배사','송장번호'],['60000000-0000-4000-8000-000000000001','택배,등기,소포','한진택배','001234567890']]);return Buffer.from(await w.xlsx.writeBuffer());};
 afterEach(()=>{vi.restoreAllMocks();});
 it.each([['세 칸',threeColumns],['김포 21열',gimpo],['남양주(서원) 송장양식',seowon],['상품주문번호',smartStore]])('%s 회신을 평문과 똑같이 읽는다',async(_label,make)=>{
  const plain=await make();
  const expected=await parseTrackingWorkbook(plain,carriers);
  expect(expected.issues).toEqual([]);
  expect(await parseTrackingWorkbook(sealed(plain),carriers,password)).toEqual(expected);
 });
 it('암호 없는 파일은 비밀번호를 함께 보내도 평문 경로로 읽는다',async()=>{
  const decrypt=vi.spyOn(officeCrypto,'decrypt');const plain=await threeColumns();
  expect(await parseTrackingWorkbook(plain,carriers,'아무값')).toEqual(await parseTrackingWorkbook(plain,carriers));
  expect(decrypt).not.toHaveBeenCalled();
 });
 it('수식·숫자 번호는 복호화한 내용에서도 같은 줄 오류가 된다',async()=>{
  const plain=await bytes([['배송건번호','택배사','운송장번호'],['00000001','hanjin',{formula:'1+1'}],['00000002','hanjin',12345678],['00000003','hanjin','00123456']]);
  const parsed=await parseTrackingWorkbook(sealed(plain),carriers,password);
  expect(parsed).toEqual(await parseTrackingWorkbook(plain,carriers));
  expect(parsed.issues.map(row=>row.line)).toEqual([2,3]);
 });
 it('비활성 택배사는 복호화한 내용에서도 거절한다',async()=>{
  const inactive=carriers.map(carrier=>({...carrier,active:false}));
  const plain=await threeColumns();
  const parsed=await parseTrackingWorkbook(sealed(plain),inactive,password);
  expect(parsed).toEqual(await parseTrackingWorkbook(plain,inactive));
  expect(parsed.rows).toEqual([]);expect(parsed.issues[0].reason).toContain('사용하지 않는 택배사');
 });
 it('1,001줄과 추가 컬럼은 복호화한 내용에서도 거절한다',async()=>{
  await expect(parseTrackingWorkbook(sealed(await bytes(Array.from({length:1002},()=>['00000001','hanjin','12345678']))),carriers,password)).rejects.toThrow('1,000줄');
  await expect(parseTrackingWorkbook(sealed(await bytes([['00000001','hanjin','12345678','extra']])),carriers,password)).rejects.toThrow('세 컬럼');
 });
 it('압축 폭탄은 복호화한 뒤 압축 해제 한도에서 막는다',async()=>{
  const bomb=new JSZip();bomb.file('xl/worksheets/sheet1.xml',Buffer.alloc(5*1024*1024,0x20));
  const zipped=await bomb.generateAsync({type:'nodebuffer',compression:'DEFLATE'});
  expect(zipped.length).toBeLessThan(64*1024);
  await expect(parseTrackingWorkbook(sealed(zipped),carriers,password)).rejects.toThrow('압축을 푼 파일 용량이 상한을 초과');
 });
 it('복호화 결과가 파일 크기 한도를 넘으면 파서로 넘기지 않는다',async()=>{
  const plain=await threeColumns();
  vi.spyOn(officeCrypto,'decrypt').mockResolvedValueOnce(Buffer.concat([plain,Buffer.alloc(1024*1024)]));
  await expect(parseTrackingWorkbook(sealed(plain),carriers,password)).rejects.toThrow('XLSX 파일 용량이 상한을 초과');
 });
 it('한도를 넘는 암호 파일은 복호화하지 않는다',async()=>{
  const decrypt=vi.spyOn(officeCrypto,'decrypt');
  const oversized=Buffer.concat([Buffer.from('d0cf11e0a1b11ae1','hex'),Buffer.alloc(1024*1024)]);
  await expect(parseTrackingWorkbook(oversized,carriers,password)).rejects.toThrow('XLSX 파일 용량이 상한을 초과');
  expect(decrypt).not.toHaveBeenCalled();
 });
});
