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

/* m27 D5②: 랜덤 판매 주문은 운영자에게 배정된 옵션 그대로 보이되, 그 옵션이 DB가 무작위로 배정한 것인지 구분한다.
   admin_order_detail 품목의 optionSaleMode(coalesce(option_sale_mode_snapshot,'select'))를 읽고, 모르는 값·없는 키(옛 응답)는 'select'다. */
it('품목의 판매 방식(optionSaleMode)을 랜덤 배정과 고른 옵션으로 읽고 모르는 값은 고른 옵션으로 둔다', async () => {
 const item=(id:string,extra:Record<string,unknown>)=>({id,variantId:`variant-${id}`,name:'랜덤 포토카드',variantName:'B',variantCode:'RANDOM-B',type:'포토카드',qty:1,unitPrice:4000,...extra});
 mocks.rpc.mockResolvedValue({data:{order:{id:'order'},shipments:[],timeline:[],items:[
  item('random',{optionSaleMode:'random'}),item('select',{optionSaleMode:'select'}),item('legacy',{}),item('unknown',{optionSaleMode:'lucky'}),
 ]},error:null});
 const result=await getAdminOrderDetail('order');
 expect(result?.items.map(entry=>[entry.id,entry.optionSaleMode])).toEqual([['random','random'],['select','select'],['legacy','select'],['unknown','select']]);
 expect(result?.items[0]).toMatchObject({variantName:'B',variantCode:'RANDOM-B',variantId:'variant-random'});
});

it('품목 배분 조회가 실패하면 나눌 수 없는 주문과 구분해 불러오지 못했다고 표시한다', async () => {
 const detail={data:{order:{id:'order'},items:[],shipments:[],timeline:[]},error:null};
 mocks.rpc.mockImplementation(async(name:string)=>name==='admin_order_item_allocation_inputs'?{data:null,error:{message:'statement_timeout'}}:detail);
 const failed=await getAdminOrderDetail('10000000-0000-4000-8000-000000002714');
 expect(mocks.rpc).toHaveBeenCalledWith('admin_order_item_allocation_inputs',{p_order_ids:['10000000-0000-4000-8000-000000002714']});
 expect(failed?.itemAllocationsUnavailable).toBe(true);expect(failed?.itemAllocations).toEqual({});
 mocks.rpc.mockImplementation(async(name:string)=>name==='admin_order_item_allocation_inputs'?{data:[],error:null}:detail);
 const loaded=await getAdminOrderDetail('10000000-0000-4000-8000-000000002714');
 expect(loaded).not.toHaveProperty('itemAllocationsUnavailable');expect(loaded?.itemAllocations).toEqual({});
});
