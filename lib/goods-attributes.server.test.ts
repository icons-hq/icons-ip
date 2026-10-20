import { expect,it,vi } from 'vitest';
import { loadPublicGoodsAttributeRows, parsePublicGoodsAttributeRows } from './goods-attributes.server';
const mocks=vi.hoisted(()=>({rpc:vi.fn()}));vi.mock('@/lib/supabase/server',()=>({createClient:async()=>mocks}));
it('공개 최소표 응답만 읽고 조회실패가 상품 구매화면을 차단하지 않는다',async()=>{
  const rows=[{id:'71350000-0000-4000-8000-000000000001',name:'소재',value:'아크릴'}];
  mocks.rpc.mockResolvedValue({data:rows,error:null});expect(await loadPublicGoodsAttributeRows('good')).toEqual(rows);
  expect(mocks.rpc).toHaveBeenCalledWith('get_good_attribute_rows',{p_good_id:'good'});
  expect(parsePublicGoodsAttributeRows([...rows,...rows])).toBeNull();
  mocks.rpc.mockResolvedValue({error:{message:'offline'}});expect(await loadPublicGoodsAttributeRows('good')).toEqual([]);
});
