import { beforeEach,afterEach,describe,expect,it,vi } from 'vitest';
const mocks=vi.hoisted(()=>({rpc:vi.fn(),getUser:vi.fn(),profile:vi.fn(),get:vi.fn(),set:vi.fn()}));
vi.mock('next/headers',()=>({cookies:async()=>({get:mocks.get,set:mocks.set})}));
vi.mock('@/lib/supabase/server',()=>({createClient:async()=>({auth:{getUser:mocks.getUser}})}));
vi.mock('@/lib/supabase/service',()=>({createServiceClient:()=>({rpc:mocks.rpc})}));
vi.mock('@/lib/auth/server',()=>({getProfileForUser:mocks.profile}));
import {acceptStoreAnalytics,bindStoreAnalyticsOrder,declineStoreAnalytics,recordStoreAnalytics,recordStoreAnalyticsNotice,storeAnalyticsState} from './store-analytics.server';
const token='a'.repeat(43);const cookies=new Map<string,string>();
const event={eventId:'11111111-1111-4111-8111-111111111111',pageKind:'home' as const,targetId:'home',linkToken:null,channel:'direct' as const,source:'none' as const,medium:'none' as const};
beforeEach(()=>{vi.clearAllMocks();vi.stubEnv('NODE_ENV','production');cookies.clear();mocks.get.mockImplementation(name=>cookies.has(name)?{value:cookies.get(name)}:undefined);mocks.set.mockImplementation((name,value)=>cookies.set(name,value));mocks.getUser.mockResolvedValue({data:{user:null},error:{name:'AuthSessionMissingError'}});mocks.rpc.mockResolvedValue({data:{enabled:true,noticeVersion:'analytics-v1',usable:true},error:null});});
afterEach(()=>vi.unstubAllEnvs());
describe('server-owned measurement consent and sessions',()=>{
 it('returns state without making sessions or setting cookies',async()=>{expect(await storeAnalyticsState()).toMatchObject({enabled:true,choice:'unset',usable:false});expect(mocks.set).not.toHaveBeenCalled();expect(mocks.rpc).toHaveBeenCalledTimes(1);});
 it('creates a secure HttpOnly token only after opt-in and stores only its hash',async()=>{
  const result=await acceptStoreAnalytics();expect(result.ok).toBe(true);const call=mocks.rpc.mock.calls.find(call=>call[0]==='start_store_analytics_session');expect(call?.[1].p_token_hash).toMatch(/^[0-9a-f]{64}$/);expect(JSON.stringify(result)).not.toContain(call?.[1].p_token_hash);
  expect(mocks.set).toHaveBeenCalledWith('__Host-icons_analytics_session',expect.stringMatching(/^[A-Za-z0-9_-]{43}$/),expect.objectContaining({httpOnly:true,secure:true,sameSite:'lax',path:'/'}));expect(mocks.rpc.mock.calls.some(call=>call[0]==='record_store_analytics_event')).toBe(false);
 });
 it('fails closed for auth errors, staff and missing/suspended profiles',async()=>{
  mocks.getUser.mockResolvedValue({data:{user:null},error:{name:'AuthApiError'}});expect((await storeAnalyticsState()).enabled).toBe(false);
  mocks.getUser.mockResolvedValue({data:{user:{id:'user-id'}},error:null});for(const profile of [null,{role:'staff',suspended_at:null},{role:'admin',suspended_at:'today'},{role:'user',suspended_at:'today'}]){mocks.profile.mockResolvedValue(profile);expect((await storeAnalyticsState()).enabled).toBe(false);}expect(mocks.rpc).not.toHaveBeenCalled();
 });
 it('does not record or bind without versioned consent',async()=>{cookies.set('__Host-icons_analytics_session',token);expect((await recordStoreAnalytics(event)).status).toBe(403);await bindStoreAnalyticsOrder('order','buyer');expect(mocks.rpc).not.toHaveBeenCalled();});
 it('withdraws server consent before deletion; failure retains the token only to retry',async()=>{
  cookies.set('__Host-icons_analytics_choice','analytics-v1:yes');cookies.set('__Host-icons_analytics_session',token);mocks.rpc.mockResolvedValue({error:{code:'offline'}});
  expect((await declineStoreAnalytics()).code).toBe('withdrawal_pending');expect(cookies.get('__Host-icons_analytics_choice')).toBe('analytics-v1:no');expect(cookies.get('__Host-icons_analytics_session')).toBe(token);await bindStoreAnalyticsOrder('order','buyer');expect(mocks.rpc).toHaveBeenCalledTimes(1);
 });
 it('binds only the server-supplied authenticated order owner and keeps purchase failure independent',async()=>{
  cookies.set('__Host-icons_analytics_choice','analytics-v1:yes');cookies.set('__Host-icons_analytics_session',token);await bindStoreAnalyticsOrder('own-order','authenticated-buyer');expect(mocks.rpc).toHaveBeenCalledWith('bind_store_analytics_order',{p_order_id:'own-order',p_user_id:'authenticated-buyer',p_token_hash:expect.stringMatching(/^[0-9a-f]{64}$/)});
  mocks.rpc.mockRejectedValue(new Error('offline'));await expect(bindStoreAnalyticsOrder('own-order','authenticated-buyer')).resolves.toBeUndefined();
 });
 it('records shell notice events only with versioned consent and an existing session, never starting one',async()=>{
  const notice={eventId:'22222222-2222-4222-8222-222222222222',curationId:'33333333-3333-4333-8333-333333333333',interaction:'impression' as const};
  cookies.set('__Host-icons_analytics_session',token);
  expect((await recordStoreAnalyticsNotice(notice)).status).toBe(403);expect(mocks.rpc).not.toHaveBeenCalled();
  cookies.set('__Host-icons_analytics_choice','analytics-v1:yes');cookies.delete('__Host-icons_analytics_session');
  expect(await recordStoreAnalyticsNotice(notice)).toMatchObject({status:409,code:'session_expired'});expect(mocks.rpc).not.toHaveBeenCalled();
  cookies.set('__Host-icons_analytics_session',token);mocks.rpc.mockResolvedValue({data:{recorded:true},error:null});
  expect(await recordStoreAnalyticsNotice(notice)).toMatchObject({ok:true,status:200});
  expect(mocks.rpc).toHaveBeenCalledWith('record_store_analytics_notice_event',{p_token_hash:expect.stringMatching(/^[0-9a-f]{64}$/),p_event_id:notice.eventId,p_curation_id:notice.curationId,p_interaction:'impression'});
  expect(mocks.rpc.mock.calls.some(call=>call[0]==='start_store_analytics_session')).toBe(false);
  for(const [error,status,code] of [[{code:'P0429',message:'analytics_rate_limited'},429,'not_recorded'],[{code:'28000',message:'analytics_session_expired'},409,'session_expired'],[{code:'P0002',message:'analytics_notice_unavailable'},400,'not_recorded']] as const){
   mocks.rpc.mockResolvedValue({data:null,error});expect(await recordStoreAnalyticsNotice(notice)).toMatchObject({ok:false,status,code});
  }
 });
});
