import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getPublicShoppingStories, getPublicShoppingStory, parsePublicShoppingStory, parsePublicShoppingStorySummary, parseShoppingStoryGood } from './shopping-stories.server';
const mocks=vi.hoisted(()=>({rpc:vi.fn(),configured:vi.fn(()=>true)}));
vi.mock('@/lib/supabase/server',()=>({createClient:()=>({rpc:mocks.rpc})}));
vi.mock('@/lib/supabase/config',()=>({getSupabaseConfig:()=>({isConfigured:mocks.configured()})}));
const at='2026-10-13T00:00:00Z', id='11111111-1111-4111-8111-111111111111';
const base={id,reference:1,title:'안전한 스토리',bodyHtml:'<p>본문 <strong>내용</strong></p>',imagePaths:[],startsAt:null,endsAt:null,createdAt:at,nextChangeAt:null};
const variant={price:1000,pricing:{regularPrice:1000,effectivePrice:700,pricePeriodId:'22222222-2222-4222-8222-222222222222',startsAt:'2026-10-12T00:00:00Z',endsAt:'2026-10-14T00:00:00Z',calculatedAt:at,nextChangeAt:'2026-10-14T00:00:00Z'},supply:{mode:'stock',state:'stock',availableQty:5,policyId:null,policyRevision:null,startsAt:null,endsAt:null,expectedShipDate:null,calculatedAt:at,nextChangeAt:null}};
const good={id:'good-1',name:'상품',price:1000,compareAtPrice:null,showDiscountRate:true,badge:null,imagePath:null,bg:null,stock:'ok',variants:[variant]};
describe('public shopping story projection',()=>{
 beforeEach(()=>{vi.clearAllMocks();mocks.configured.mockReturnValue(true);});
 it('reads all 300 goods from one aggregate and preserves section ordering without the catalog dependency',()=>{
  const goods=Array.from({length:300},(_,i)=>({...good,id:`good-${i}`}));
  const story=parsePublicShoppingStory({...base,goods,sections:[{id,title:'첫 섹션',imageShape:'square',goodIds:goods.slice(0,200).map(row=>row.id)},{id:'33333333-3333-4333-8333-333333333333',title:'두 번째',imageShape:'portrait',goodIds:goods.slice(200).map(row=>row.id)}]});
  expect(story?.nextChangeAt).toBe('2026-10-14T00:00:00.000Z');
  expect(story?.sections.map(section=>section.goods.length)).toEqual([200,100]);expect(story?.sections[1].goods[99].id).toBe('good-299');
 });
 it('uses active price/supply and fails closed on invalid partial goods projections',()=>{
  expect(parseShoppingStoryGood(good)).toMatchObject({price:700,priceMax:700,compareAtPrice:1000,soldOut:false});
  expect(parseShoppingStoryGood({...good,variants:[{...variant,supply:{...variant.supply,availableQty:0}}]})).toMatchObject({soldOut:true});
  expect(parseShoppingStoryGood({...good,stock:'soldout'})).toMatchObject({soldOut:false});
  expect(parseShoppingStoryGood({...good,variants:[]})).toMatchObject({soldOut:true});
  expect(parseShoppingStoryGood({...good,variants:[{...variant,supply:null}]})).toBeNull();
  expect(parsePublicShoppingStory({...base,goods:[good],sections:[{id,title:'잘못된 연결',imageShape:'square',goodIds:['missing']}]})).toBeNull();
 });
 it('re-sanitizes bypassed raw RPC HTML and does not project ownership/body fields onto cards',()=>{
  const result=parsePublicShoppingStorySummary({...base,bodyHtml:'<script>bad()</script><p>공개 설명</p><img src="public-media/catalog/curation/11111111-1111-4111-8111-111111111111.webp">',imagePaths:[],createdBy:'secret'});
  expect(result).toMatchObject({description:'공개 설명',imageUrl:null});expect(result).not.toHaveProperty('bodyHtml');expect(result).not.toHaveProperty('createdBy');
 });
 it('keeps loader failure distinct from a valid empty list and normalizes stale pages',async()=>{
  mocks.rpc.mockResolvedValueOnce({data:{rows:[],total:1,nextChangeAt:null},error:null}).mockResolvedValueOnce({data:{rows:[base],total:1,nextChangeAt:null},error:null});
  expect(await getPublicShoppingStories({page:99,limit:12})).toMatchObject({page:1,total:1,stories:[{id}]});
  mocks.rpc.mockResolvedValue({data:null,error:{message:'down'}});expect(await getPublicShoppingStories()).toMatchObject({unavailable:true});
 });
 it('rejects non-UUID and hidden details without widening to a direct table read',async()=>{
  expect(await getPublicShoppingStory('not-a-uuid')).toBeNull();expect(mocks.rpc).not.toHaveBeenCalled();
  mocks.rpc.mockResolvedValue({data:null,error:null});expect(await getPublicShoppingStory(id)).toBeNull();expect(mocks.rpc).toHaveBeenCalledWith('get_shopping_story',{p_id:id});
 });
 /* L4b · CL-02 — 공개 상세 로더가 카드 별점을 목록 표시 정보와 나란히 한 번의 묶음으로 읽어 굿즈에 싣는다. */
 it('loads card review summaries in one batch beside listing appearance and keeps the story when they fail',async()=>{
  const story={...base,goods:[good,{...good,id:'good-2'}],sections:[{id,title:'첫 섹션',imageShape:'square',goodIds:['good-1','good-2']}]};
  mocks.rpc.mockImplementation(async(name:string)=>name==='get_shopping_story'?{data:story,error:null}
   :name==='get_goods_review_summaries'?{data:[{goodId:'good-2',reviewCount:4,ratingAverage:4.75}],error:null}:{data:[],error:null});
  const loaded=await getPublicShoppingStory(id);
  expect(mocks.rpc).toHaveBeenCalledWith('get_goods_review_summaries',{p_good_ids:['good-1','good-2']});
  expect(mocks.rpc.mock.calls.filter(([name])=>name==='get_goods_review_summaries')).toHaveLength(1);
  expect(loaded?.sections[0].goods.map(item=>item.reviewSummary)).toEqual([undefined,{count:4,average:4.75}]);
  expect(loaded?.sections[0].goods[0]).not.toHaveProperty('reviewSummary');
  mocks.rpc.mockImplementation(async(name:string)=>name==='get_shopping_story'?{data:story,error:null}
   :name==='get_goods_review_summaries'?{data:null,error:{message:'down'}}:{data:[],error:null});
  const fallback=await getPublicShoppingStory(id);
  expect(fallback?.sections[0].goods.map(item=>item.id)).toEqual(['good-1','good-2']);
  expect(fallback?.sections[0].goods.every(item=>item.reviewSummary===undefined)).toBe(true);
 });
});
