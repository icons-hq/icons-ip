import { beforeEach, describe, expect, it, vi } from 'vitest';
import { chargeAdminFixtures, chargeIds, chargeIdentity } from '@/test/fixtures/shipping-charge-groups';
import { loadGoodShippingChargeGroup, loadShippingChargeGroup, loadShippingChargeGroups, parseShippingChargeGroupAssignmentPreview,
  parseShippingChargeGroupData, parseShippingChargeGroupGoodData, parseShippingChargeGroupGoodsData, parseShippingChargeGroupListData,
  previewShippingChargeGroupAssignment, searchShippingChargeGroupGoods } from './shipping-charge-groups.server';
import type { ShippingChargeGroupFilters, ShippingChargeGroupGoodsFilters } from './shipping-charge-groups';
const mocks = vi.hoisted(()=>({rpc:vi.fn()}));
vi.mock('@/lib/supabase/server',()=>({createClient:vi.fn(async()=>({rpc:mocks.rpc}))}));
const filters: ShippingChargeGroupFilters = {originId:null,query:'',status:'all',page:1};
const goodsFilters: ShippingChargeGroupGoodsFilters = {originId:null,groupId:null,query:'',page:1};
function responses(){
 const f=chargeAdminFixtures(), common={actorId:chargeIds.actor,sessionId:chargeIds.session,runtimeEnabled:true,canManageRegional:false};
 return {...f,list:{...common,page:1,pageSize:20,total:1,groups:[f.group],origins:[f.origin]},get:{...common,group:f.group,origin:f.origin},
  getGood:{...common,good:f.good,group:null,origin:f.origin},goods:{actorId:chargeIds.actor,sessionId:chargeIds.session,page:1,pageSize:20,total:1,goods:[f.good]}};
}
beforeEach(()=>mocks.rpc.mockReset());
describe('배송비 묶음그룹 readback',()=>{
 it('각 RPC에 현재 identity와 검색 범위를 전하고 응답을 검증한다',async()=>{
  const f=responses();
  mocks.rpc.mockResolvedValueOnce({data:f.list,error:null});expect(await loadShippingChargeGroups(filters,chargeIdentity)).toEqual(f.list);
  expect(mocks.rpc).toHaveBeenLastCalledWith('admin_list_shipping_charge_groups',{p_origin_id:null,p_query:'',p_status:'all',p_page:1,p_expected_actor_id:chargeIds.actor,p_expected_session_id:chargeIds.session});
  mocks.rpc.mockResolvedValueOnce({data:f.get,error:null});expect(await loadShippingChargeGroup(chargeIds.group,chargeIdentity)).toEqual(f.get);
  mocks.rpc.mockResolvedValueOnce({data:f.getGood,error:null});expect(await loadGoodShippingChargeGroup('good-a',chargeIdentity)).toEqual(f.getGood);
  mocks.rpc.mockResolvedValueOnce({data:f.goods,error:null});expect(await searchShippingChargeGroupGoods(goodsFilters,chargeIdentity)).toEqual(f.goods);
  mocks.rpc.mockResolvedValueOnce({data:f.preview,error:null});expect(await previewShippingChargeGroupAssignment(chargeIds.group,['good-a'],chargeIdentity)).toEqual(f.preview);
  expect(mocks.rpc).toHaveBeenCalledTimes(5);
 });
 it('그룹이 없는 출고지도 신규 저장용 default CAS를 반환한다',()=>{
  const f=responses(), value={...f.list,total:0,groups:[]};
  expect(parseShippingChargeGroupListData(value,{...filters,originId:chargeIds.origin},chargeIdentity)).toEqual(value);
  expect(parseShippingChargeGroupListData({...value,origins:[{...f.origin,defaultGroupRevision:1}]},filters,chargeIdentity)).toBeNull();
 });
 it.each(['actorId','sessionId'])('다른 %s 응답과 중복/다른 페이지를 거절한다',key=>{
  const f=responses();expect(parseShippingChargeGroupListData({...f.list,[key]:chargeIds.other},filters,chargeIdentity)).toBeNull();
  expect(parseShippingChargeGroupListData({...f.list,groups:[f.group,f.group],total:2},filters,chargeIdentity)).toBeNull();
  expect(parseShippingChargeGroupListData({...f.list,page:2},filters,chargeIdentity)).toBeNull();
 });
 it('그룹·기본그룹·상품 현재 배정의 identity를 교차 검증한다',()=>{
  const f=responses();
  expect(parseShippingChargeGroupData({...f.get,group:{...f.group,isDefault:true}},chargeIds.group,chargeIdentity)).toBeNull();
  expect(parseShippingChargeGroupData(f.get,chargeIds.other,chargeIdentity)).toBeNull();
  expect(parseShippingChargeGroupGoodData({...f.getGood,group:f.group},'good-a',chargeIdentity)).toBeNull();
  expect(parseShippingChargeGroupGoodsData(f.goods,{...goodsFilters,groupId:chargeIds.group},chargeIdentity)).toBeNull();
  expect(parseShippingChargeGroupListData({...f.list,origins:[]},filters,chargeIdentity)).toBeNull();
 });
 it('출고지 미설정 상품과 runtime off를 숨기지 않고 차단 사유와 함께 읽는다',()=>{
  const f=responses(), good={...f.good,originId:null,blocker:'shipping_charge_group_origin_unavailable'};
  const data={...f.getGood,runtimeEnabled:false,good,origin:null};
  expect(parseShippingChargeGroupGoodData(data,'good-a',chargeIdentity)).toEqual(data);
  const preview={...f.preview,canAssign:false,runtimeEnabled:false,origins:[],goods:[{...good,beforeGroup:null,afterGroup:f.summary}]};
  expect(parseShippingChargeGroupAssignmentPreview(preview,chargeIds.group,['good-a'],chargeIdentity)).toEqual(preview);
  expect(parseShippingChargeGroupAssignmentPreview({...preview,canAssign:true},chargeIds.group,['good-a'],chargeIdentity)).toBeNull();
 });
 it('미리보기의 숨은 추가 상품/누락 상품·before/after·원상품 차단을 검증한다',()=>{
  const f=responses();expect(parseShippingChargeGroupAssignmentPreview(f.preview,chargeIds.group,['good-a'],chargeIdentity)).toEqual(f.preview);
  for(const value of [{...f.preview,goods:[]},{...f.preview,goods:[...f.preview.goods,f.preview.goods[0]]},
   {...f.preview,goods:[{...f.preview.goods[0],afterGroup:null}]},
   {...f.preview,goods:[{...f.preview.goods[0],beforeGroup:f.summary}]},
   {...f.preview,goods:[{...f.preview.goods[0],blocker:'collect_contract_not_ready'}]},
   {...f.preview,runtimeEnabled:false}])expect(parseShippingChargeGroupAssignmentPreview(value,chargeIds.group,['good-a'],chargeIdentity)).toBeNull();
 });
 it('clear는 비활성 출고지와 출고지 없는 unassigned noop을 정리할 수 있다',()=>{
  const f=responses(),clear={...f.preview,group:null,origins:[{...f.origin,isActive:false}],goods:[{...f.good,beforeGroup:null,afterGroup:null}]};
  expect(parseShippingChargeGroupAssignmentPreview(clear,null,['good-a'],chargeIdentity)).toEqual(clear);
  const missing={...clear,origins:[],goods:[{...clear.goods[0],originId:null}]};
  expect(parseShippingChargeGroupAssignmentPreview(missing,null,['good-a'],chargeIdentity)).toEqual(missing);
  expect(parseShippingChargeGroupAssignmentPreview({...missing,runtimeEnabled:false},null,['good-a'],chargeIdentity)).toBeNull();
 });
 it('잘못된 읽기 결과를 재시도하거나 성공으로 바꾸지 않는다',async()=>{
  mocks.rpc.mockResolvedValue({data:{private:'secret'},error:null});
  await expect(loadShippingChargeGroups(filters,chargeIdentity)).rejects.toThrow('shipping_charge_group_read_invalid');expect(mocks.rpc).toHaveBeenCalledOnce();
 });
});
