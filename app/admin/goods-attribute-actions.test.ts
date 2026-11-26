import { beforeEach, expect, it, vi } from 'vitest';
import { readGoodsAttributesAction, saveGoodsAttributeSchemaAction } from './goods-attribute-actions';
const mocks=vi.hoisted(()=>({access:vi.fn(),rpc:vi.fn(),read:vi.fn(),revalidate:vi.fn()}));
vi.mock('@/lib/admin/action-access.server',()=>({requireAdminActionAccess:mocks.access}));
vi.mock('@/lib/admin/goods-attributes.server',()=>({loadGoodsAttributeWorkspace:mocks.read}));
vi.mock('@/lib/supabase/server',()=>({createClient:async()=>({rpc:mocks.rpc})}));
vi.mock('next/cache',()=>({revalidatePath:mocks.revalidate}));
const id='71350000-0000-4000-8000-000000000001';
const fieldId='71350000-0000-4000-8000-0000000000a1', otherFieldId='71350000-0000-4000-8000-0000000000a2', optionId='71350000-0000-4000-8000-0000000000b1';
const text=(name:string,fieldIdentifier=fieldId)=>({id:fieldIdentifier,name,kind:'text',required:false,unit:'',options:[]});
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
it('다른 사람이 먼저 바꿨다고 말하고, 화면의 [최신 항목 보기]로 이어 준다',async()=>{
  mocks.rpc.mockResolvedValue({error:{code:'PT409'}});
  const result=await saveGoodsAttributeSchemaAction(id,[],1,id);
  expect(result).toMatchObject({conflict:true,error:expect.stringContaining('다른 사람이 먼저 바꿨습니다.')});
  expect(result.error).toContain('[최신 항목 보기]');expect(result.error).toContain('입력한 내용은 그대로 있습니다');
  expect(result.error).not.toMatch(/충돌|정의|버전|관리자가/);
});
it('저장 요청이 항목 검사를 못 넘으면 어느 항목의 무엇이 문제인지 말하고 RPC를 부르지 않는다',async()=>{
  const first=await saveGoodsAttributeSchemaAction(id,[text('색상'),text('',otherFieldId)],0,id);
  expect(first).toEqual({error:'항목 2의 이름을 입력해주세요.'});
  const dup=await saveGoodsAttributeSchemaAction(id,[text('색상'),text('색상',otherFieldId),{...text('재질','71350000-0000-4000-8000-0000000000a3'),kind:'single',options:[]}],0,id);
  expect(dup).toEqual({error:'항목 1·2의 이름이 같습니다. 서로 다르게 적어주세요. 이 밖에 1곳이 더 있습니다.'});
  const option=await saveGoodsAttributeSchemaAction(id,[{...text('색상'),kind:'multi',options:[{id:optionId,label:''}]}],0,id);
  expect(option).toEqual({error:'항목 1의 선택값 1 이름을 입력해주세요.'});
  expect(mocks.rpc).not.toHaveBeenCalled();
});
it('고칠 수 있는 문제를 못 찾는 잘못된 값은 한도와 함께 일반 안내를 한다',async()=>{
  const result=await saveGoodsAttributeSchemaAction(id,[{...text('색상'),id:'not-a-uuid'}],0,id);
  expect(result.error).toContain('이름·유형·단위·선택값을 확인해주세요');expect(result.error).toContain('항목은 30개, 선택값은 항목당 100개');
  expect(await saveGoodsAttributeSchemaAction(id,'not-an-array',0,id)).toHaveProperty('error');
  expect(mocks.rpc).not.toHaveBeenCalled();
});
it('카테고리·저장 번호·기준 번호가 잘못되면 카테고리를 다시 고르라고 안내하고 RPC를 부르지 않는다',async()=>{
  for(const call of [()=>saveGoodsAttributeSchemaAction('x',[],0,id),()=>saveGoodsAttributeSchemaAction(id,[],0,'x'),()=>saveGoodsAttributeSchemaAction(id,[],-1,id),()=>saveGoodsAttributeSchemaAction(id,[],1.5,id)])
    expect(await call()).toEqual({error:'저장할 카테고리를 확인하지 못했습니다. 화면을 새로고침한 뒤 카테고리를 다시 골라주세요.'});
  expect(mocks.rpc).not.toHaveBeenCalled();
});
it('저장에 실패한 것이 분명하면 결과를 모른다고 하지 않는다',async()=>{
  mocks.rpc.mockResolvedValue({error:{code:'23514',message:'category_not_leaf'}});
  const result=await saveGoodsAttributeSchemaAction(id,[],0,id);
  expect(result).toEqual({error:'상품속성 항목을 저장하지 못했습니다. 카테고리와 입력을 확인한 뒤 다시 저장해주세요.'});
  expect(mocks.revalidate).not.toHaveBeenCalled();
});
it('저장됐는지 모르는 때는 [저장됐는지 확인]으로 같은 요청을 다시 보내라고 안내한다',async()=>{
  mocks.rpc.mockRejectedValue(new Error('network'));
  const lost=await saveGoodsAttributeSchemaAction(id,[],0,id);
  expect(lost).toMatchObject({uncertain:true});
  expect(lost.error).toBe('저장됐는지 확인하지 못했습니다. [저장됐는지 확인]을 누르면 같은 내용이 두 번 저장되지 않습니다. 입력한 내용은 그대로 있습니다.');
  /* 서버가 저장했지만 돌려준 값을 읽지 못한 경우도 저장됐는지 모르는 상태다. */
  mocks.rpc.mockResolvedValue({data:{broken:true},error:null});
  expect(await saveGoodsAttributeSchemaAction(id,[],0,id)).toMatchObject({uncertain:true});
  expect(mocks.revalidate).not.toHaveBeenCalled();
});
