import { beforeEach, describe, expect, it, vi } from 'vitest';
import { chargeAdminFixtures, chargeId, chargeIds, chargeIdentity, chargeLater } from '@/test/fixtures/shipping-charge-groups';
import { shippingChargeGroupOperationContext, type ShippingChargeGroupOperationReceipt } from '@/lib/admin/shipping-charge-groups';
const mocks = vi.hoisted(()=>({allowed:true,actor:'',claims:vi.fn(),rpc:vi.fn(),refresh:vi.fn(),goods:vi.fn(),access:vi.fn()}));
vi.mock('@/lib/admin/action-access.server',()=>({requireAdminActionAccess:vi.fn(async(...args:unknown[])=>{mocks.access(...args);return mocks.allowed?{user:{id:mocks.actor}}:null;})}));
vi.mock('@/lib/supabase/server',()=>({createClient:vi.fn(async()=>({rpc:mocks.rpc,auth:{getClaims:mocks.claims}}))}));
vi.mock('next/cache',()=>({revalidatePath:mocks.refresh}));
vi.mock('next/navigation',()=>({unstable_rethrow:vi.fn()}));
vi.mock('@/lib/admin/revalidate-goods.server',()=>({revalidateGoodsSurfaces:mocks.goods}));
import { assignShippingChargeGroupAction, findShippingChargeGroupGoodsAction, getGoodShippingChargeGroupAction, getShippingChargeGroupAction,
  listShippingChargeGroupsAction, previewShippingChargeGroupAssignmentAction, readShippingChargeGroupOperationAction,
  saveShippingChargeGroupAction, sealShippingChargeGroupOperationAction } from './shipping-charge-group-actions';
const ok=(data:unknown)=>({data,error:null});
beforeEach(()=>{
 mocks.allowed=true;mocks.actor=chargeIds.actor;
 for(const key of ['claims','rpc','refresh','goods','access'] as const)mocks[key].mockReset();
 mocks.claims.mockResolvedValue({data:{claims:{sub:chargeIds.actor,session_id:chargeIds.session}},error:null});
});

describe('현재 계정/세션의 상품관리 권한',()=>{
 it.each(['capability','actor','subject','session','claims-error'])('%s가 바뀌면 어떤 RPC도 호출하지 않는다',async kind=>{
  if(kind==='capability')mocks.allowed=false;
  if(kind==='actor')mocks.actor=chargeIds.other;
  if(kind==='subject')mocks.claims.mockResolvedValue({data:{claims:{sub:chargeIds.other,session_id:chargeIds.session}},error:null});
  if(kind==='session')mocks.claims.mockResolvedValue({data:{claims:{sub:chargeIds.actor,session_id:chargeIds.other}},error:null});
  if(kind==='claims-error')mocks.claims.mockResolvedValue({data:null,error:{message:'PRIVATE'}});
  expect(await saveShippingChargeGroupAction(chargeAdminFixtures().save)).toMatchObject({authChanged:true});expect(mocks.rpc).not.toHaveBeenCalled();
 });
 it('기본 그룹 편집을 platform 전체 제한으로 확대하지 않고 SQL의 지역 diff 권한 검사를 사용한다',async()=>{
  const f=chargeAdminFixtures();mocks.rpc.mockResolvedValue(ok(f.saved));
  expect(await saveShippingChargeGroupAction(f.save)).toEqual({data:f.saved});
  expect(mocks.access).toHaveBeenCalledExactlyOnceWith('/admin/settings/origins',{capability:'catalog.manage'});
 });
 it('알 수 없는 필드·잘못된 clear·중복 대상은 인증 전에 거절한다',async()=>{
  const f=chargeAdminFixtures();
  expect(await saveShippingChargeGroupAction({...f.save,canManageRegional:true} as typeof f.save)).toHaveProperty('error');
  expect(await assignShippingChargeGroupAction({...f.assign,groupId:null})).toHaveProperty('error');
  expect(await previewShippingChargeGroupAssignmentAction(chargeIds.group,['good-a','good-a'],chargeIdentity)).toHaveProperty('error');
  expect(await listShippingChargeGroupsAction({originId:null,query:'',status:'all',page:0},chargeIdentity)).toHaveProperty('error');
  expect(mocks.access).not.toHaveBeenCalled();expect(mocks.rpc).not.toHaveBeenCalled();
 });
});
describe('확정 저장과 원 요청에 결속된 영수증',()=>{
 it('요청을 그대로 한 번 전달하고 확정된 저장 결과만 반영한다',async()=>{
  const f=chargeAdminFixtures();mocks.rpc.mockResolvedValue(ok(f.saved));
  expect(await saveShippingChargeGroupAction(f.save)).toEqual({data:f.saved});
  expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith('admin_save_shipping_charge_group',{p_request:f.save});
  expect(mocks.goods).toHaveBeenCalledOnce();
 });
 it('저장 no-op은 기존 revision을 유지한 정상 영수증으로 처리한다',async()=>{
  const f=chargeAdminFixtures(),input={...f.save,expectedRevision:1},receipt={...f.saved,expectedRevision:1};
  mocks.rpc.mockResolvedValue(ok(receipt));expect(await saveShippingChargeGroupAction(input)).toEqual({data:receipt});
 });
 it.each(['name','origin','actor','session','operation','revision'])('반환 %s가 요청과 다르면 성공으로 표시하지 않는다',async kind=>{
  const f=chargeAdminFixtures(),receipt=structuredClone(f.saved);
  if(kind==='name')receipt.group!.name='다른 값';
  if(kind==='origin')receipt.group!.originId=chargeIds.other;
  if(kind==='actor')receipt.actorId=chargeIds.other;
  if(kind==='session')receipt.sessionId=chargeIds.other;
  if(kind==='operation')receipt.operationId=chargeIds.other;
  if(kind==='revision')receipt.group!.revision=3;
  mocks.rpc.mockResolvedValue(ok(receipt));expect(await saveShippingChargeGroupAction(f.save)).toMatchObject({uncertain:true});expect(mocks.goods).not.toHaveBeenCalled();
 });
 it('기본 그룹 교체의 이전 그룹 revision도 원 요청에 결속한다',async()=>{
  const f=chargeAdminFixtures(),input={...f.save,expectedDefaultGroupId:chargeIds.other,expectedDefaultGroupRevision:7,values:{...f.save.values,isDefault:true}};
  const receipt={...f.saved,group:{...f.group,isDefault:true},changedDefaultGroup:{...f.group,id:chargeIds.other,revision:8,isDefault:false}};
  mocks.rpc.mockResolvedValueOnce(ok(receipt));expect(await saveShippingChargeGroupAction(input)).toEqual({data:receipt});
  mocks.rpc.mockResolvedValueOnce(ok({...receipt,changedDefaultGroup:{...receipt.changedDefaultGroup,revision:9}}));
  expect(await saveShippingChargeGroupAction(input)).toMatchObject({uncertain:true});
 });
 it('규칙 UUID와 시각 정규화 외의 지역 계약 변경을 숨기지 않는다',async()=>{
  const f=chargeAdminFixtures(),policy={...f.region,noRulesConfirmed:false,rules:[{id:null,postalFrom:'12345',postalTo:'12345',addressPrefix:'',regionLabel:'TEST',disposition:'surcharge' as const,amount:1000}]};
  const input={...f.save,attestRegional:true,values:{...f.save.values,regional:{mode:'override' as const,policy}}};
  const receipt={...f.saved,group:{...f.group,regional:{mode:'override' as const,policy:{...policy,startsAt:'2026-10-14T09:00:00.123456+09:00',rules:[{...policy.rules[0],id:chargeId(70)}]}}}};
  mocks.rpc.mockResolvedValueOnce(ok(receipt));expect(await saveShippingChargeGroupAction(input)).toEqual({data:receipt});
  receipt.group.regional.policy.rules[0].amount=1001;mocks.rpc.mockResolvedValueOnce(ok(receipt));
  expect(await saveShippingChargeGroupAction(input)).toMatchObject({uncertain:true});
 });
 it.each(['save','assign'] as const)('다른 요청의 봉인이 먼저 완료된 %s의 late 결과를 수용한다',async command=>{
  const f=chargeAdminFixtures(),input=f[command],receipt={...f.sealed,command,expectedRevision:input.expectedRevision};
  mocks.rpc.mockResolvedValue(ok(receipt));
  expect(await (command==='save'?saveShippingChargeGroupAction(f.save):assignShippingChargeGroupAction(f.assign))).toEqual({data:receipt});
  expect(mocks.goods).not.toHaveBeenCalled();
 });
 it('응답 소실은 재전송하지 않고 확정 영수증 후 cache 실패도 성공을 취소하지 않는다',async()=>{
  const f=chargeAdminFixtures();mocks.rpc.mockRejectedValueOnce(new Error('PRIVATE transport'));
  const error=await saveShippingChargeGroupAction(f.save);expect(error).toMatchObject({uncertain:true});expect(JSON.stringify(error)).not.toContain('PRIVATE');expect(mocks.rpc).toHaveBeenCalledOnce();
  mocks.rpc.mockResolvedValueOnce(ok(f.saved));mocks.goods.mockImplementationOnce(()=>{throw new Error('cache');});
  expect(await saveShippingChargeGroupAction(f.save)).toEqual({data:f.saved});
 });
});
describe('원상품 배정/해제의 실제 결과',()=>{
 it('배정 변경과 원상품 guard를 정확히 반환한다',async()=>{
  const f=chargeAdminFixtures();mocks.rpc.mockResolvedValue(ok(f.assigned));
  expect(await assignShippingChargeGroupAction(f.assign)).toEqual({data:f.assigned});
  expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith('admin_assign_shipping_charge_group',{p_request:f.assign});
 });
 it('같은 그룹 no-op과 이미 해제된 head 없는 no-op을 구분한다',async()=>{
  const f=chargeAdminFixtures(),input={...f.assign,goods:f.assigned.goods};mocks.rpc.mockResolvedValueOnce(ok(f.assigned));
  expect(await assignShippingChargeGroupAction(input)).toEqual({data:f.assigned});
  const clear={...f.assign,groupId:null,expectedRevision:0},receipt={...f.assigned,groupId:null,expectedRevision:0,group:null,goods:[f.guard]};
  mocks.rpc.mockResolvedValueOnce(ok(receipt));expect(await assignShippingChargeGroupAction(clear)).toEqual({data:receipt});
  const missing={...clear,origins:[],goods:[{...f.guard,originId:null}]},missingReceipt={...receipt,goods:missing.goods};
  mocks.rpc.mockResolvedValueOnce(ok(missingReceipt));expect(await assignShippingChargeGroupAction(missing)).toEqual({data:missingReceipt});
 });
 it.each(['revision','delivery','family','origin','new-version'])('배정 후 %s의 예상치 못한 변경은 성공으로 인정하지 않는다',async kind=>{
  const f=chargeAdminFixtures(),receipt=structuredClone(f.assigned),good=receipt.goods[0];
  if(kind==='revision')good.assignmentRevision=2;
  if(kind==='delivery'){good.transactionRevision=1;good.deliveryVersionId=chargeId(90);}
  if(kind==='family')good.familyGoodIds.push('unselected-child');
  if(kind==='origin')good.originId=chargeIds.other;
  if(kind==='new-version')good.assignmentVersionId=null;
  mocks.rpc.mockResolvedValue(ok(receipt));expect(await assignShippingChargeGroupAction(f.assign)).toMatchObject({uncertain:true});
 });
});
describe('읽기/봉인과 명시 오류',()=>{
 it('null 조회는 미확정으로 남기고 봉인의 null은 성공으로 처리하지 않는다',async()=>{
  const {save}=chargeAdminFixtures(),context=shippingChargeGroupOperationContext(save);mocks.rpc.mockResolvedValue(ok(null));
  expect(await readShippingChargeGroupOperationAction(context)).toEqual({data:null});
  expect(await sealShippingChargeGroupOperationAction(context)).toMatchObject({uncertain:true});expect(mocks.goods).not.toHaveBeenCalled();
 });
 it('봉인과 이미 완료된 영수증은 같은 context로만 회수한다',async()=>{
  const f=chargeAdminFixtures(),context=shippingChargeGroupOperationContext(f.save);
  mocks.rpc.mockResolvedValueOnce(ok(f.sealed));expect(await sealShippingChargeGroupOperationAction(context)).toEqual({data:f.sealed});
  mocks.rpc.mockResolvedValueOnce(ok(f.saved));expect(await readShippingChargeGroupOperationAction(context)).toEqual({data:f.saved});
  mocks.rpc.mockResolvedValueOnce(ok({...f.saved,sessionId:chargeIds.other}));expect(await readShippingChargeGroupOperationAction(context)).toMatchObject({uncertain:true});
 });
 it('DB 상세 메시지·근거 원문을 노출하지 않는 고정 오류를 반환한다',async()=>{
  const f=chargeAdminFixtures();mocks.rpc.mockResolvedValue({data:null,error:{code:'23514',message:'shipping_charge_group_has_assignments PRIVATE'}});
  const result=await saveShippingChargeGroupAction(f.save);expect(result).toMatchObject({uncertain:false});expect(JSON.stringify(result)).not.toContain('PRIVATE');
 });
 it('list/get/getgood/search/preview의 read 응답과 identity를 검증한다',async()=>{
  const f=chargeAdminFixtures(),common={actorId:chargeIds.actor,sessionId:chargeIds.session,runtimeEnabled:true,canManageRegional:false};
  const list={...common,page:1,pageSize:20,total:1,groups:[f.group],origins:[f.origin]};
  mocks.rpc.mockResolvedValueOnce(ok(list));expect(await listShippingChargeGroupsAction({originId:null,query:'',status:'all',page:1},chargeIdentity)).toEqual({data:list});
  const get={...common,group:f.group,origin:f.origin};mocks.rpc.mockResolvedValueOnce(ok(get));expect(await getShippingChargeGroupAction(f.group.id,chargeIdentity)).toEqual({data:get});
  const good={...common,good:f.good,group:null,origin:f.origin};mocks.rpc.mockResolvedValueOnce(ok(good));expect(await getGoodShippingChargeGroupAction(f.good.id,chargeIdentity)).toEqual({data:good});
  const goods={actorId:chargeIds.actor,sessionId:chargeIds.session,page:1,pageSize:20,total:1,goods:[f.good]};mocks.rpc.mockResolvedValueOnce(ok(goods));
  expect(await findShippingChargeGroupGoodsAction({originId:null,groupId:null,query:'',page:1},chargeIdentity)).toEqual({data:goods});
  mocks.rpc.mockResolvedValueOnce(ok(f.preview));expect(await previewShippingChargeGroupAssignmentAction(f.group.id,['good-a'],chargeIdentity)).toEqual({data:f.preview});
  mocks.rpc.mockResolvedValueOnce(ok({...list,actorId:chargeIds.other}));expect(await listShippingChargeGroupsAction({originId:null,query:'',status:'all',page:1},chargeIdentity)).toHaveProperty('error');
 });
 it('읽기 권한 오류는 비공개 진단을 반환하지 않는다',async()=>{
  mocks.rpc.mockResolvedValue({data:null,error:{code:'42501',message:'PRIVATE'}});
  const result=await getShippingChargeGroupAction(chargeIds.group,chargeIdentity);expect(result).toMatchObject({authChanged:true});expect(JSON.stringify(result)).not.toContain('PRIVATE');
 });
 it('recordedAt은 DB 영수증 원문을 보존한다',async()=>{
  const f=chargeAdminFixtures(),receipt:ShippingChargeGroupOperationReceipt={...f.saved,recordedAt:chargeLater};mocks.rpc.mockResolvedValue(ok(receipt));
  expect(await readShippingChargeGroupOperationAction(shippingChargeGroupOperationContext(f.save))).toEqual({data:receipt});
 });
});
