import { beforeEach, describe, expect, it, vi } from 'vitest';
import { loadReviewBestSettings, loadSelectedReviewCards } from './review-best.server';
const mocks=vi.hoisted(()=>({rpc:vi.fn(),sign:vi.fn(),disclosures:vi.fn(),configured:true}));
vi.mock('server-only',()=>({}));
vi.mock('@/lib/supabase/config',()=>({getSupabaseConfig:()=>({isConfigured:mocks.configured})}));
vi.mock('@/lib/supabase/server',()=>({createClient:async()=>({rpc:mocks.rpc,storage:{from:()=>({createSignedUrl:mocks.sign})}})}));
vi.mock('@/lib/review-events.server',()=>({loadReviewEventDisclosures:mocks.disclosures}));
const cards=[1,2,3].map(n=>({kind:'ordinary',repeatPurchase:null,id:`93500000-0000-4000-8000-${String(n).padStart(12,'0')}`,rating:n,body:'선정된 리뷰 본문',authorName:'구매자',createdAt:'2026-10-13T00:00:00Z',imagePaths:['customer/shared.jpg'],orderId:'private'}));
beforeEach(()=>{vi.clearAllMocks();mocks.configured=true;mocks.rpc.mockResolvedValue({data:cards,error:null});mocks.sign.mockResolvedValue({data:{signedUrl:'https://fixture.test/signed'},error:null});mocks.disclosures.mockResolvedValue(new Map([[cards[0].id,{eventTitle:'혜택 제공 이벤트',revoked:false}]]));});
describe('선정 리뷰 로더',()=>{
 it('동일 사진은 한번 서명하고 선정 원장 외 혜택 고지도 유지한다',async()=>{const rows=await loadSelectedReviewCards('good');expect(rows).toHaveLength(3);expect(mocks.sign).toHaveBeenCalledTimes(1);expect(rows[0].imageUrls).toEqual(['https://fixture.test/signed']);expect(rows[0].eventDisclosure?.eventTitle).toBe('혜택 제공 이벤트');expect(rows[0]).not.toHaveProperty('orderId');expect(rows[0]).not.toHaveProperty('imagePaths');});
 it('서명 오류는 사진만 제거하고 원문과 혜택고지는 유지한다',async()=>{mocks.sign.mockRejectedValueOnce(new Error('sign unavailable'));const rows=await loadSelectedReviewCards('good');expect(rows).toHaveLength(3);expect(rows[0].imageUrls).toEqual([]);expect(rows[0].eventDisclosure).toBeTruthy();});
 it('2개·잘못된 응답·RPC오류는 공개 영역을 숨긴다',async()=>{mocks.rpc.mockResolvedValueOnce({data:cards.slice(0,2),error:null});expect(await loadSelectedReviewCards('good')).toEqual([]);mocks.rpc.mockResolvedValueOnce({data:cards,error:{message:'unavailable'}});expect(await loadSelectedReviewCards('good')).toEqual([]);expect(mocks.sign).not.toHaveBeenCalled();});
 it('설정 오류는 저장할 수 없는 상태로 반환한다',async()=>{mocks.rpc.mockResolvedValueOnce({data:{enabled:true,revision:2},error:{message:'unavailable'}});expect(await loadReviewBestSettings()).toEqual({enabled:false,revision:0,unavailable:true});});
});
