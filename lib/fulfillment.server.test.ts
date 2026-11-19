import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks=vi.hoisted(()=>({rpc:vi.fn(),client:vi.fn(),configured:true}));
vi.mock('server-only',()=>({}));
vi.mock('@/lib/supabase/server',()=>({createClient:mocks.client}));
vi.mock('@/lib/supabase/config',()=>({getSupabaseConfig:()=>({isConfigured:mocks.configured})}));
import { loadGoodsShippingQuote, loadGoodShippingPolicy } from './fulfillment.server';
beforeEach(()=>{vi.resetAllMocks();mocks.configured=true;mocks.client.mockResolvedValue({rpc:mocks.rpc});});
describe('server shipping read boundary',()=>{
  it('passes only goods identity to the public policy RPC and validates the result',async()=>{
    const policy={originId:'origin',originName:'창고',baseFee:4700,freeThreshold:null,feeType:'policy',individualFee:0};
    mocks.rpc.mockImplementation(async(name:string)=>name==='get_good_shipping_policy'?{data:policy,error:null}:{data:null,error:{message:'missing'}});
    expect(await loadGoodShippingPolicy('good')).toEqual(policy);
    expect(mocks.rpc).toHaveBeenCalledWith('get_good_shipping_policy',{target_good_id:'good'});
    mocks.rpc.mockImplementation(async(name:string)=>name==='get_good_shipping_policy'?{data:{...policy,baseFee:-1},error:null}:{data:null,error:null});
    expect(await loadGoodShippingPolicy('good')).toBeNull();
  });
  /* S36-038: 지역별 추가 배송비 요약은 같은 굿즈로 함께 읽고, 읽지 못하거나 어긋나면 금액 없이 정책만 둔다. */
  it('attaches the region fee summary only when it reads back cleanly',async()=>{
    const policy={originId:'origin',originName:'창고',baseFee:3000,freeThreshold:30000,feeType:'policy',individualFee:0};
    const fees={state:'listed',regions:[{label:'제주',minFee:3000,maxFee:3000}],regionCount:1,feeUnit:'per_shipment',waivedAtFreeThreshold:true,nextChangeAt:'2026-12-01T00:00:00Z'};
    let regionResult:unknown={data:fees,error:null};
    mocks.rpc.mockImplementation(async(name:string)=>name==='get_good_shipping_policy'?{data:policy,error:null}:regionResult);
    expect(await loadGoodShippingPolicy('good')).toEqual({...policy,regionFees:fees});
    expect(mocks.rpc).toHaveBeenCalledWith('get_good_shipping_region_fees',{target_good_id:'good'});
    regionResult={data:{...fees,regions:[{label:'제주',minFee:-1,maxFee:3000}]},error:null};
    expect(await loadGoodShippingPolicy('good')).toEqual(policy);
    regionResult={data:null,error:{code:'PGRST202',message:'missing function'}};
    expect(await loadGoodShippingPolicy('good')).toEqual(policy);
  });
  /* 반품배송비 차감(ADR-0031)이 켜져 있으면 상세의 고객 귀책 반품비가 정책 금액(편도·무료배송 왕복)을 따른다. */
  it('overlays the return fee deduction policy on the claim policy only while it is on',async()=>{
    const claimPolicy={returnAllowed:true,exchangeAllowed:true,restrictionReason:null,returnFee:2500,returnFreeShippingFee:5000,exchangeFee:5000};
    const policy={originId:'origin',originName:'창고',baseFee:3000,freeThreshold:null,feeType:'policy',individualFee:0,claimPolicy};
    let fee:unknown={data:{enabled:true,oneWayAmount:3000},error:null};
    mocks.rpc.mockImplementation(async(name:string)=>name==='get_good_shipping_policy'?{data:policy,error:null}:name==='get_return_fee_deduction_policy'?fee:{data:null,error:null});
    expect(await loadGoodShippingPolicy('good')).toMatchObject({claimPolicy:{returnFee:3000,returnFreeShippingFee:6000,exchangeFee:5000}});
    fee={data:{enabled:false,oneWayAmount:null},error:null};
    expect(await loadGoodShippingPolicy('good')).toMatchObject({claimPolicy});
    fee={data:null,error:{message:'down'}};
    expect(await loadGoodShippingPolicy('good')).toMatchObject({claimPolicy});
  });
  it('keeps missing configuration and lookup failures unavailable instead of inventing a fee',async()=>{
    mocks.configured=false;
    expect(await loadGoodShippingPolicy('good')).toBeNull();
    expect(mocks.client).not.toHaveBeenCalled();
    mocks.configured=true;mocks.rpc.mockResolvedValue({data:null,error:{message:'unavailable'}});
    expect(await loadGoodShippingPolicy('good')).toBeNull();
    expect(await loadGoodShippingPolicy('good')).toBeNull();
    expect(await loadGoodsShippingQuote([{goodId:'good',variantId:'00000000-0000-4000-8000-000000000001',qty:1}])).toBeNull();
  });
  it('preserves option identities and rejects inconsistent quote totals',async()=>{
    const items=[{goodId:'good',variantId:'00000000-0000-4000-8000-000000000001',qty:100}];
    mocks.rpc.mockResolvedValue({data:{totalFee:0,groups:[]},error:null});
    expect(await loadGoodsShippingQuote(items)).toEqual({totalFee:0,groups:[]});
    expect(mocks.rpc).toHaveBeenCalledWith('quote_goods_shipping',{items});
    mocks.rpc.mockResolvedValue({data:{totalFee:9000,groups:[]},error:null});
    expect(await loadGoodsShippingQuote(items)).toBeNull();
  });
});
