import { beforeEach,describe,expect,it,vi } from 'vitest';
import { loadMyMarketingMessage } from './marketing-messages.server';
const mocks=vi.hoisted(()=>({rpc:vi.fn(),catalog:vi.fn()}));
vi.mock('server-only',()=>({}));vi.mock('@/lib/supabase/server',()=>({createClient:()=>({rpc:mocks.rpc})}));vi.mock('@/lib/catalog',()=>({getCatalogSnapshot:mocks.catalog}));
const id='11111111-1111-4111-8111-111111111111',content={template:'product_list',title:'새 굿즈',body:'현재 상품 정보',imagePath:null,goodIds:['a','b'],buttons:[]};
describe('recipient marketing projection',()=>{
 beforeEach(()=>vi.clearAllMocks());
 it('reuses actual catalog price projections and drops goods hidden after RPC',async()=>{mocks.rpc.mockResolvedValue({data:{id,registeredAt:'2026-10-13T01:00:00Z',content,goodIds:['a','b']}});mocks.catalog.mockResolvedValue({source:'supabase',goods:[{id:'a',name:'최저 옵션 할인 상품',price:900,priceMax:1200,compareAtPrice:1500,img:'url("https://assets.example.test/a.png")',saleRestriction:'none'},{id:'c',name:'선택하지 않은 상품',price:1,img:''}]});expect(await loadMyMarketingMessage(id)).toMatchObject({goods:[{id:'a',price:900,priceMax:1200,compareAtPrice:1500,imageUrl:'https://assets.example.test/a.png'}]});expect(mocks.catalog).toHaveBeenCalledOnce();});
 it('never substitutes mock merchandise for a persisted real marketing message',async()=>{mocks.rpc.mockResolvedValue({data:{id,registeredAt:'2026-10-13T01:00:00Z',content,goodIds:['a']}});mocks.catalog.mockResolvedValue({source:'mock',goods:[]});await expect(loadMyMarketingMessage(id)).rejects.toThrow('상품 정보');});
 it('does not load catalog data for an unowned or deleted recipient',async()=>{mocks.rpc.mockResolvedValue({data:null});expect(await loadMyMarketingMessage(id)).toBeNull();expect(mocks.catalog).not.toHaveBeenCalled();});
});
