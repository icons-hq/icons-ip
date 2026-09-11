import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {GET} from './route';
const mocks=vi.hoisted(()=>({process:vi.fn()}));
vi.mock('@/lib/email/order-delay-jobs.server',()=>({processOrderDelayEmails:mocks.process}));
beforeEach(()=>{vi.stubEnv('CRON_SECRET','synthetic-cron-secret');mocks.process.mockReset();});
afterEach(()=>vi.unstubAllEnvs());
const request=(secret?:string)=>new Request('https://example.test/api/cron/order-delay-notices',{headers:secret?{Authorization:`Bearer ${secret}`}:{}});
describe('지연 안내 cron',()=>{
 it.each([undefined,'wrong'])('인증되지 않은 호출을 worker 전에 거절한다',async secret=>{
  expect((await GET(request(secret))).status).toBe(401);expect(mocks.process).not.toHaveBeenCalled();
 });
 it('일부 실패를 비정상 결과로 관측하고 수신자나 문구는 반환하지 않는다',async()=>{
  mocks.process.mockResolvedValue({claimed:2,sent:1,queued:0,failed:1,unknown:0,suppressed:0,stale:0});
  const response=await GET(request('synthetic-cron-secret'));expect(response.status).toBe(503);
  expect(response.headers.get('cache-control')).toContain('no-store');
  expect(await response.json()).toEqual({ok:false,claimed:2,sent:1,queued:0,failed:1,unknown:0,suppressed:0,stale:0});
 });
 it('내부 오류의 개인정보를 응답에 싣지 않는다',async()=>{
  mocks.process.mockRejectedValue(new Error('buyer@example.test private copy'));
  expect(await (await GET(request('synthetic-cron-secret'))).json()).toEqual({ok:false});
 });
});
