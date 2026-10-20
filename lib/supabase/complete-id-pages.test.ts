import {describe,expect,it,vi} from 'vitest';
import {readCompleteIdPages} from './complete-id-pages';
const rows=Array.from({length:1001},(_,index)=>({id:String(index).padStart(12,'0')}));
describe('readCompleteIdPages',()=>{
 it('서버 상한이 요청한 페이지보다 작아도 1001행을 모두 읽는다',async()=>{
  const fetch=vi.fn(async(after:string|null)=>{const remaining=rows.filter(row=>after===null||row.id>after);return {data:remaining.slice(0,200),count:remaining.length,error:null};});
  expect(await readCompleteIdPages(fetch)).toEqual({data:rows,error:null});expect(fetch).toHaveBeenCalledTimes(6);
 });
 it('행이 추가되거나 총수를 확인하지 못하면 부분 결과를 반환하지 않는다',async()=>{
  const fetch=vi.fn().mockResolvedValueOnce({data:rows.slice(0,500),count:1001,error:null}).mockResolvedValueOnce({data:rows.slice(500,1000),count:502,error:null});
  expect(await readCompleteIdPages(fetch)).toMatchObject({data:null,error:{message:'row_snapshot_incomplete_or_changed'}});
  expect(await readCompleteIdPages(async()=>({data:rows.slice(0,1),count:null,error:null}))).toMatchObject({data:null});
 });
 it('비어 있는 절단 응답·중복 또는 역행 커서를 오류로 닫는다',async()=>{
  expect(await readCompleteIdPages(async()=>({data:[],count:1,error:null}))).toMatchObject({data:null});
  expect(await readCompleteIdPages(async()=>({data:[rows[1],rows[0]],count:2,error:null}))).toMatchObject({data:null});
 });
});
