import { beforeEach, describe, expect, it, vi } from 'vitest';
import { loadGoodsPhotos } from './goods-photo-library.server';
const mocks=vi.hoisted(()=>({rpc:vi.fn()}));
vi.mock('@/lib/supabase/server',()=>({createClient:async()=>({rpc:mocks.rpc})}));
beforeEach(()=>vi.clearAllMocks());
describe('공용 사진 목록 읽기',()=>{
  it('마지막 사진을 보관하면 줄어든 마지막 페이지를 다시 읽는다',async()=>{
    mocks.rpc.mockResolvedValueOnce({data:{rows:[],total:20,page:2,pageSize:20},error:null}).mockResolvedValueOnce({data:{rows:[],total:20,page:1,pageSize:20},error:null});
    expect((await loadGoodsPhotos('사진',false,2)).page).toBe(1);
    expect(mocks.rpc).toHaveBeenLastCalledWith('admin_list_goods_photos',{p_query:'사진',p_archived:false,p_page:1});
  });
  it('불완전한 RPC 응답을 빈 결과로 반환하지 않는다',async()=>{
    mocks.rpc.mockResolvedValue({data:{rows:[],total:'0',page:1,pageSize:20},error:null});
    await expect(loadGoodsPhotos()).rejects.toThrow('불러오지 못했습니다');
  });
});
