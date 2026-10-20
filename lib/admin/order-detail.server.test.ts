import { beforeEach, expect, it, vi } from 'vitest';
import { getAdminOrderDetail } from './order-detail.server';
const mocks=vi.hoisted(()=>({rpc:vi.fn(),from:vi.fn(),select:vi.fn(),eq:vi.fn()}));
vi.mock('@/lib/order-delivery.server',()=>({loadAdminOrderDeliveries:async(ids:string[])=>new Map(ids.map(id=>[id,{orderId:id,address:null,isGift:false}]))}));
vi.mock('@/lib/order-transactions.server',()=>({loadAdminOrderTransactions:async(ids:string[])=>new Map(ids.map(id=>[id,null]))}));
vi.mock('@/lib/supabase/server',()=>({createClient:()=>({rpc:mocks.rpc,from:mocks.from})}));
beforeEach(()=>{
 vi.clearAllMocks();
 mocks.rpc.mockResolvedValue({data:{order:{id:'order'},items:[],shipments:[],timeline:[]},error:null});
 mocks.from.mockReturnValue({select:mocks.select});mocks.select.mockReturnValue({eq:mocks.eq});
 mocks.eq.mockResolvedValue({data:[{shipment_id:'shipment',status:'review',attempts:2,last_error_code:'provider_network_error',updated_at:'2026-09-08'}],error:null});
});
it('관리자 세션에서 해당 주문의 배송 메일 큐 상태만 읽는다',async()=>{
 const result=await getAdminOrderDetail('order');
 expect(mocks.from).toHaveBeenCalledWith('order_shipment_email_jobs');
 expect(mocks.eq).toHaveBeenCalledWith('order_id','order');
 expect(mocks.select).toHaveBeenCalledWith('shipment_id,status,attempts,last_error_code,updated_at');
 expect(result?.emailJobs).toEqual([{shipmentId:'shipment',status:'review',attempts:2,lastErrorCode:'provider_network_error',updatedAt:'2026-09-08'}]);
});
it('권한 검사 RPC가 주문을 반환하지 않으면 큐 조회도 하지 않는다',async()=>{
 mocks.rpc.mockResolvedValue({data:null,error:null});
 expect(await getAdminOrderDetail('order')).toBeNull();expect(mocks.from).not.toHaveBeenCalled();
});

it('order search access never reads delivery mail jobs or returns financial and internal timeline entries', async () => {
  mocks.rpc.mockResolvedValue({ data: { order: { id: 'order' }, items: [], shipments: [], timeline: [
    { id: 'order', source: 'order' }, { id: 'shipment', source: 'shipment' }, { id: 'financial', source: 'refund', body: 'private' }, { id: 'note', source: 'note', body: 'private' },
  ] }, error: null });
  const result = await getAdminOrderDetail('order', false);
  expect(mocks.from).not.toHaveBeenCalled();
  expect(result?.emailJobs).toEqual([]);
  expect(result?.timeline.map(entry => entry.id)).toEqual(['order', 'shipment']);
  expect(JSON.stringify(result)).not.toContain('private');
});

it('fulfillment-specific snapshots are not cast into a parcel regional policy', async () => {
 mocks.rpc.mockResolvedValue({data:{order:{id:'order'},items:[],timeline:[],shipments:[{id:'digital',regionalShipping:{regionMode:'fulfillment_method',policyVersion:null}}]},error:null});
 const result=await getAdminOrderDetail('order');
 expect(result?.shipments[0].regionalShipping).toBeNull();
});
