import { beforeEach, describe, expect, it, vi } from 'vitest';
import { POST } from './route';
const orderId='b2f8a1c4-3d5e-4f6a-8b7c-9d0e1f2a3b4c';
const mocks=vi.hoisted(()=>({giftOrder:vi.fn(),rpc:vi.fn(),createClient:vi.fn(),eq:vi.fn()}));
vi.mock('@/lib/orders/cancellation-auto.server', () => ({ scheduleApprovedOrderCancellation: vi.fn() }));
vi.mock('@/lib/gifts-order.server',()=>({loadGiftCheckoutOrder:mocks.giftOrder}));
vi.mock('@/lib/supabase/config',()=>({getSupabaseConfig:()=>({isConfigured:true})}));
vi.mock('@/lib/supabase/service',()=>({getServiceRoleConfig:()=>({isConfigured:true}),createServiceClient:()=>({rpc:mocks.rpc})}));
vi.mock('@/lib/supabase/server',()=>({createClient:mocks.createClient}));
function request(body:unknown){return new Request(`https://icons.local/api/orders/${orderId}/claims`,{method:'POST',headers:{host:'icons.local',origin:'https://icons.local','content-type':'application/json'},body:JSON.stringify(body)});}
const context=()=>({params:Promise.resolve({orderId})});
describe('whole-order claim request boundary',()=>{
 beforeEach(()=>{
  vi.clearAllMocks();mocks.giftOrder.mockResolvedValue({kind:'ordinary'});mocks.rpc.mockResolvedValue({data:'requested',error:null});
  const query={select:vi.fn(),eq:mocks.eq,maybeSingle:vi.fn().mockResolvedValue({data:{id:orderId,user_id:'buyer'},error:null})};
  query.select.mockReturnValue(query);mocks.eq.mockReturnValue(query);
  mocks.createClient.mockResolvedValue({auth:{getUser:async()=>({data:{user:{id:'buyer'}}})},from:()=>query});
 });
 it.each(['items','orderItemId','quantity','refundAmount','amount','partial','scope'])('rejects unexpected %s before auth/DB and never starts a full refund',async key=>{
  for(const claimType of ['cancel','return']){
   const response=await POST(request({claimType,reasonType:'defect',[key]:key==='items'?[{id:'item',quantity:1}]:1}),context());
   expect(response.status).toBe(400);expect(await response.json()).toEqual({error:{code:'invalid_body'}});
  }
  expect(mocks.createClient).not.toHaveBeenCalled();expect(mocks.rpc).not.toHaveBeenCalled();
 });
 it.each([['cancel','change_of_mind'],['return','defect'],['exchange','defect']])('preserves valid existing %s requests and whole-order RPC arguments',async (claimType,reasonType)=>{
  const response=await POST(request({claimType,reasonType}),context());
  expect(response.status).toBe(202);
  expect(mocks.rpc).toHaveBeenCalledWith('request_order_claim',expect.objectContaining({p_order_id:orderId,p_user_id:'buyer',p_claim_type:claimType,p_reason_type:reasonType}));
  expect(Object.keys(mocks.rpc.mock.calls[0][1])).not.toContain('p_amount');
 });
 // R7: 취소(발주확인 전)는 단순 변심만 받는다. 하자·오배송은 반품·교환으로 받는다.
 it('rejects defect cancellation before auth/DB',async()=>{
  const response=await POST(request({claimType:'cancel',reasonType:'defect'}),context());
  expect(response.status).toBe(400);expect(await response.json()).toEqual({error:{code:'invalid_reason_type'}});
  expect(mocks.createClient).not.toHaveBeenCalled();expect(mocks.rpc).not.toHaveBeenCalled();
 });
 it('rejects array bodies',async()=>{expect((await POST(request([]),context())).status).toBe(400);expect(mocks.rpc).not.toHaveBeenCalled();});
});
