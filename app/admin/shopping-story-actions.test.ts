import { beforeEach, describe, expect, it, vi } from 'vitest';
import { saveShoppingStoryAction, deleteShoppingStoriesAction, searchShoppingStoryGoodsAction } from './shopping-story-actions';
import { DEFAULT_STORY_GOOD_FILTERS } from '@/lib/admin/shopping-story-picker';
const mocks = vi.hoisted(() => ({access:vi.fn(),rpc:vi.fn(),read:vi.fn(),search:vi.fn(),revalidate:vi.fn()}));
vi.mock('@/lib/admin/action-access.server',()=>({requireAdminActionAccess:mocks.access}));
vi.mock('@/lib/supabase/server',()=>({createClient:()=>({rpc:mocks.rpc})}));
vi.mock('@/lib/admin/shopping-stories.server',()=>({loadAdminShoppingStory:mocks.read,searchShoppingStoryGoods:mocks.search}));
vi.mock('next/cache',()=>({revalidatePath:mocks.revalidate}));
const id='11111111-1111-4111-8111-111111111111', operationId='22222222-2222-4222-8222-222222222222';
const request={id,operationId,expectedRevision:0,values:{title:'스토리',bodyHtml:'<p onclick="bad()">본문</p>',startsAt:null,endsAt:null,sections:[]}};
describe('shopping story action persistence boundary',()=>{
 beforeEach(()=>{vi.clearAllMocks();mocks.access.mockResolvedValue({user:{id:'operator'}});mocks.rpc.mockResolvedValue({data:{id,revision:1},error:null});mocks.read.mockResolvedValue({id,revision:1,title:'스토리'});});
 it('sanitizes server input, retains operation UUID and returns verified readback',async()=>{
  expect(await saveShoppingStoryAction(request)).toMatchObject({ok:true,story:{id,revision:1}});
  expect(mocks.rpc).toHaveBeenCalledWith('admin_save_shopping_story',expect.objectContaining({p_id:id,p_operation_id:operationId,p_expected_revision:0,p_values:expect.objectContaining({bodyHtml:'<p>본문</p>',imagePaths:[]})}));
  expect(mocks.access).toHaveBeenCalledWith('/admin/display/stories',{capability:'store.manage'});expect(mocks.revalidate).toHaveBeenCalledWith('/');
 });
 it('rejects restricted roles across save/delete/search without a data RPC',async()=>{
  mocks.access.mockResolvedValue(null);expect((await saveShoppingStoryAction(request)).ok).toBe(false);expect((await deleteShoppingStoriesAction(operationId,[{id,revision:1}])).ok).toBe(false);expect((await searchShoppingStoryGoodsAction('',1)).ok).toBe(false);expect(mocks.rpc).not.toHaveBeenCalled();expect(mocks.search).not.toHaveBeenCalled();
 });
 it('keeps a conflict separate from an ambiguous outcome and does not invalidate stale writes',async()=>{
  mocks.rpc.mockResolvedValue({error:{code:'PT409',message:'shopping_story_conflict'}});
  expect(await saveShoppingStoryAction(request)).toMatchObject({ok:false,conflict:true,latestStory:{revision:1}});expect(mocks.revalidate).not.toHaveBeenCalled();
  mocks.rpc.mockRejectedValue(new Error('network'));
  expect(await saveShoppingStoryAction(request)).toMatchObject({ok:false,retrySameOperation:true});
 });
 it('reports committed write even when readback fails so the editor does not duplicate it',async()=>{
  mocks.read.mockRejectedValue(new Error('read failure'));expect(await saveShoppingStoryAction(request)).toMatchObject({ok:false,savedId:id});expect(mocks.revalidate).toHaveBeenCalledWith('/stories');
 });
 it('rejects malformed limits and duplicate deletes before mutation',async()=>{
  expect((await saveShoppingStoryAction({...request,values:{...request.values,title:'가'.repeat(51)}})).ok).toBe(false);
  expect((await deleteShoppingStoriesAction(operationId,[{id,revision:1},{id,revision:1}])).ok).toBe(false);expect(mocks.rpc).not.toHaveBeenCalled();
 });
 it('validates picker filters before search and passes the applied contract unchanged',async()=>{
  const filters={...DEFAULT_STORY_GOOD_FILTERS,freeShipping:true,minRating:4 as const,sort:'sales' as const};
  expect((await searchShoppingStoryGoodsAction('  상품  ',2,filters)).ok).toBe(true);
  expect(mocks.search).toHaveBeenCalledWith('상품',2,filters);
  mocks.search.mockClear();expect((await searchShoppingStoryGoodsAction('',1,{...filters,minPrice:4,maxPrice:3})).ok).toBe(false);expect(mocks.search).not.toHaveBeenCalled();
 });
});
