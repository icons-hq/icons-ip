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
    mocks.rpc.mockResolvedValue({data:policy,error:null});
    expect(await loadGoodShippingPolicy('good')).toEqual(policy);
    expect(mocks.rpc).toHaveBeenCalledWith('get_good_shipping_policy',{target_good_id:'good'});
    mocks.rpc.mockResolvedValue({data:{...policy,baseFee:-1},error:null});
    expect(await loadGoodShippingPolicy('good')).toBeNull();
  });
  it('keeps missing configuration and lookup failures unavailable instead of inventing a fee',async()=>{
    mocks.configured=false;
    expect(await loadGoodShippingPolicy('good')).toBeNull();
    expect(mocks.client).not.toHaveBeenCalled();
    mocks.configured=true;mocks.rpc.mockResolvedValue({data:null,error:{message:'unavailable'}});
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
