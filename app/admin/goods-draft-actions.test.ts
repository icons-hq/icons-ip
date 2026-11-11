import { beforeEach,describe,expect,it,vi } from 'vitest';
import { findGoodsDraftsAction,getGoodsDraftAction,saveGoodsDraftAction,setGoodsDraftArchivedAction } from './goods-draft-actions';
const mocks=vi.hoisted(()=>({access:vi.fn(),rpc:vi.fn()}));
vi.mock('@/lib/admin/action-access.server',()=>({requireAdminActionAccess:mocks.access}));
vi.mock('@/lib/supabase/server',()=>({createClient:async()=>({rpc:mocks.rpc})}));
vi.mock('next/navigation',()=>({unstable_rethrow:vi.fn()}));
const id='76000000-0000-4000-8000-000000000001';
const summary={id,name:'미완성 상품',imagePath:null,revision:2,updatedAt:'2026-10-13T01:00:00Z',archived:false,completedGoodId:null};
beforeEach(()=>{vi.clearAllMocks();mocks.access.mockResolvedValue({user:{id:'staff'}});mocks.rpc.mockResolvedValue({data:summary,error:null});});
describe('personal draft actions',()=>{
 it('requires active staff before reading or mutating',async()=>{
  mocks.access.mockResolvedValue(null);
  for(const result of await Promise.all([findGoodsDraftsAction('',false,1),getGoodsDraftAction(id),saveGoodsDraftAction({id,revision:1},{name:'미완성 상품'}),setGoodsDraftArchivedAction({id,revision:1},true)]))expect(result).toHaveProperty('error');
  expect(mocks.rpc).not.toHaveBeenCalled();
 });
 it('rejects malformed payloads before RPC and sends only an exact expected revision',async()=>{
  expect(await saveGoodsDraftAction({id,revision:1},{name:''})).toHaveProperty('error');expect(mocks.rpc).not.toHaveBeenCalled();
  expect(await saveGoodsDraftAction({id,revision:1},{name:'미완성 상품'})).toEqual({data:summary});
  expect(mocks.rpc).toHaveBeenCalledWith('admin_save_goods_draft',{p_id:id,p_values:{name:'미완성 상품'},p_expected_revision:1});
 });
 /* 리뷰 재현(T3B-RV-3): 상한을 2MB로 올린 뒤에도 거절 문구가 '입력 크기(512KB)'였다. */
 it('입력이 상한을 넘으면 실제 상한(2MB)을 안내하고 RPC를 부르지 않는다',async()=>{
  const result=await saveGoodsDraftAction({id,revision:1},{name:'미완성 상품',description:'한'.repeat(800000)});
  expect(result).toEqual({error:'상품명을 1~100자로 입력하고 등록 중인 상품의 입력 크기(2MB)와 이미지 업로드 상태를 확인해주세요.'});
  expect(mocks.rpc).not.toHaveBeenCalled();
 });
 it('preserves error distinctions and rejects archived or malformed readbacks',async()=>{
  mocks.rpc.mockResolvedValueOnce({error:{message:'goods_draft_changed'}});
  expect(await saveGoodsDraftAction({id,revision:1},{name:'미완성 상품'})).toMatchObject({error:expect.stringContaining('현재 입력은 유지')});
  mocks.rpc.mockResolvedValueOnce({data:{...summary,archived:true,values:{name:'미완성 상품'}}});
  expect(await getGoodsDraftAction(id)).toMatchObject({error:expect.stringContaining('삭제했거나')});
  mocks.rpc.mockResolvedValueOnce({data:{rows:null,total:0,page:1,pageSize:20}});
  expect(await findGoodsDraftsAction('',false,1)).toHaveProperty('error');
 });
});
