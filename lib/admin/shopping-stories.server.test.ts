import { beforeEach, describe, expect, it, vi } from 'vitest';
import { loadAdminShoppingStories, parseAdminShoppingStory, parseShoppingStoryGoods, searchShoppingStoryGoods } from './shopping-stories.server';
import { normalizeShoppingStoryFilters } from './shopping-stories';
import { DEFAULT_STORY_GOOD_FILTERS } from './shopping-story-picker';
const mocks=vi.hoisted(()=>({rpc:vi.fn()}));
vi.mock('@/lib/supabase/server',()=>({createClient:()=>({rpc:mocks.rpc})}));
const at='2026-10-13T00:00:00Z',id='11111111-1111-4111-8111-111111111111';
const good={id:'private-good',name:'비공개 상품',code:'PRIVATE-1',price:1000,compareAtPrice:null,showDiscountRate:true,badge:null,imagePath:null,bg:'url("/generated/goods/g2.png") center / cover no-repeat',stock:'ok',published:false,archived:false,
 variants:[{price:1000,pricing:{regularPrice:1000,effectivePrice:1000,pricePeriodId:null,startsAt:null,endsAt:null,calculatedAt:at,nextChangeAt:null},supply:{mode:'stock',state:'stock',availableQty:5,policyId:null,policyRevision:null,startsAt:null,endsAt:null,expectedShipDate:null,calculatedAt:at,nextChangeAt:null}}]};
const row={id,reference:1,title:'스토리',startsAt:null,endsAt:null,state:'active',revision:1,createdAt:at,updatedAt:at,sectionCount:1,goodCount:1};
describe('admin shopping story readback',()=>{
 beforeEach(()=>vi.clearAllMocks());
 it('retains private candidates and seed imagery while applying the common option parser',()=>{
  expect(parseShoppingStoryGoods([good])).toMatchObject([{published:false,imageUrl:'/generated/goods/g2.png',price:1000,soldOut:false}]);
  expect(parseShoppingStoryGoods([{...good,variants:[{...good.variants[0],supply:null}]}])).toBeNull();
 });
 it('rejects orphaned or duplicate links instead of silently rendering partial saved state',()=>{
  const source={...row,bodyHtml:'<p>본문</p>',imagePaths:[],goods:[good],sections:[{id,title:'관련상품',imageShape:'square',goodIds:[good.id]}]};
  expect(parseAdminShoppingStory(source)?.goods).toHaveLength(1);
  expect(parseAdminShoppingStory({...source,sections:[{...source.sections[0],goodIds:['missing']}]})).toBeNull();
  expect(parseAdminShoppingStory({...source,goods:[good,good]})).toBeNull();
 });
 it('normalizes deleted last pages and validates the checked-at response',async()=>{
  mocks.rpc.mockResolvedValueOnce({data:{rows:[],total:1,checkedAt:at},error:null}).mockResolvedValueOnce({data:{rows:[row],total:1,checkedAt:at},error:null});
  expect(await loadAdminShoppingStories(normalizeShoppingStoryFilters({page:'99'}))).toMatchObject({total:1,filters:{page:1}});
  mocks.rpc.mockResolvedValue({data:{rows:[],total:0,checkedAt:'invalid'},error:null});await expect(loadAdminShoppingStories(normalizeShoppingStoryFilters({}))).rejects.toThrow('불러오지');
 });
 it('does not report a broken goods projection as an empty successful search',async()=>{
  mocks.rpc.mockResolvedValue({data:{rows:[{...good,variants:null}],total:1,page:1,pageSize:20},error:null});
  await expect(searchShoppingStoryGoods('',1)).rejects.toThrow('불러오지');
 });
 it('keeps filtered aggregate metadata and refuses malformed metrics',async()=>{
  const candidate={...good,reviewCount:2,ratingAverage:4.5,wishCount:3,salesQuantity:5,freeShipping:true,discounted:false,saleType:'stock'};
  const result={rows:[candidate],total:1,page:1,pageSize:20,checkedAt:at,categories:[{id,path:'선물 > 문구'}]};
  mocks.rpc.mockResolvedValue({data:result,error:null});
  expect(await searchShoppingStoryGoods('상품',1,DEFAULT_STORY_GOOD_FILTERS)).toMatchObject({rows:[{reviewCount:2,ratingAverage:4.5,salesQuantity:5}],categories:[{id,path:'선물 > 문구'}]});
  expect(mocks.rpc).toHaveBeenCalledWith('admin_search_shopping_story_goods_filtered',{p_query:'상품',p_page:1,p_filters:DEFAULT_STORY_GOOD_FILTERS});
  mocks.rpc.mockResolvedValue({data:{...result,rows:[{...candidate,reviewCount:0}]},error:null});await expect(searchShoppingStoryGoods('',1)).rejects.toThrow('불러오지');
 });
});
