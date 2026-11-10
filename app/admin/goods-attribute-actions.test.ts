import { beforeEach, expect, it, vi } from 'vitest';
import { readGoodsAttributesAction, saveGoodsAttributeSchemaAction } from './goods-attribute-actions';
const mocks=vi.hoisted(()=>({access:vi.fn(),rpc:vi.fn(),read:vi.fn(),revalidate:vi.fn()}));
vi.mock('@/lib/admin/action-access.server',()=>({requireAdminActionAccess:mocks.access}));
vi.mock('@/lib/admin/goods-attributes.server',()=>({loadGoodsAttributeWorkspace:mocks.read}));
vi.mock('@/lib/supabase/server',()=>({createClient:async()=>({rpc:mocks.rpc})}));
vi.mock('next/cache',()=>({revalidatePath:mocks.revalidate}));
const id='71350000-0000-4000-8000-000000000001';
beforeEach(()=>{vi.clearAllMocks();mocks.access.mockResolvedValue({role:'admin'});});
it('정의 쓰기는admin만 요구하고 거절시RPC를 부르지 않는다',async()=>{
  mocks.access.mockResolvedValue(null);expect(await saveGoodsAttributeSchemaAction(id,[],0,id)).toHaveProperty('error');expect(mocks.rpc).not.toHaveBeenCalled();
  expect(mocks.access).toHaveBeenCalledWith('/admin/catalog/attributes',{adminOnly:true,capability:'platform.manage'});
});
it('상품 편집용 읽기는staff도 요청할 수 있으며 오류를 입력유지로 보고한다',async()=>{
  mocks.read.mockRejectedValue(new Error());expect(await readGoodsAttributesAction(id,'good')).toHaveProperty('error');expect(mocks.access).toHaveBeenCalledWith('/admin/catalog/goods', { capability: 'catalog.read' });
});
it('기준revision·operation ID를 전달하고 서버 확정본을 반환한다',async()=>{
  const data={categoryId:id,revision:2,fields:[]};mocks.rpc.mockResolvedValue({data,error:null});
  expect(await saveGoodsAttributeSchemaAction(id,[],1,id)).toEqual({data});
  expect(mocks.rpc).toHaveBeenCalledWith('admin_save_goods_attribute_schema',{p_category_id:id,p_fields:[],p_expected_revision:1,p_operation_id:id});
  mocks.rpc.mockResolvedValue({error:{code:'PT409'}});expect(await saveGoodsAttributeSchemaAction(id,[],1,id)).toMatchObject({conflict:true});
});
