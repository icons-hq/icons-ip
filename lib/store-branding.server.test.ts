import { beforeEach,expect,it,vi } from 'vitest';
const mocks=vi.hoisted(()=>({rpc:vi.fn(),create:vi.fn(),configured:true}));
vi.mock('@supabase/ssr',()=>({createServerClient:mocks.create}));
vi.mock('next/cache',()=>({unstable_cache:(fn:unknown)=>fn}));
vi.mock('@/lib/supabase/config',()=>({getSupabaseConfig:()=>({url:'https://local.example.test',key:'anon-test',isConfigured:mocks.configured})}));
import { loadStorefrontBranding } from './store-branding.server';
import { DEFAULT_STOREFRONT_BRANDING } from './store-branding';
beforeEach(()=>{mocks.rpc.mockReset();mocks.create.mockReset().mockReturnValue({rpc:mocks.rpc,storage:{from:()=>({getPublicUrl:(path:string)=>({data:{publicUrl:`https://media.test/${path}`}})})}});mocks.configured=true;});
it('쿠키 없이 공개 전용 RPC를 읽고 검증한 경로로 Storage URL을 만든다',async()=>{
  const logo='public-media/catalog/curation/00000000-0000-4000-8000-000000016001.png';
  mocks.rpc.mockResolvedValue({data:{displayName:'합성 브랜드',logoPath:logo,mobileLogoPath:null,introduction:'공개 소개',profileImagePath:logo,socials:[]},error:null});
  expect(await loadStorefrontBranding()).toMatchObject({displayName:'합성 브랜드',logoUrl:`https://media.test/${logo.slice('public-media/'.length)}`,introduction:'공개 소개',profileImageUrl:`https://media.test/${logo.slice('public-media/'.length)}`});
  expect(mocks.rpc).toHaveBeenCalledWith('get_storefront_branding_v2');
  expect(mocks.create.mock.calls[0][2].cookies.getAll()).toEqual([]);
});
it('미적용 DB·잘못된 응답·미설정 환경은 기본 ICONS 셸을 유지한다',async()=>{
  mocks.rpc.mockResolvedValue({data:null,error:{message:'missing'}});expect(await loadStorefrontBranding()).toEqual(DEFAULT_STOREFRONT_BRANDING);
  mocks.rpc.mockResolvedValue({data:{displayName:'invalid',secret:'hidden'},error:null});expect(await loadStorefrontBranding()).toEqual(DEFAULT_STOREFRONT_BRANDING);
  mocks.configured=false;expect(await loadStorefrontBranding()).toEqual(DEFAULT_STOREFRONT_BRANDING);
});
