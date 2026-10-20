import { afterEach,beforeEach,describe,expect,it,vi } from 'vitest';
import { GET } from './route';
const mocks=vi.hoisted(()=>({process:vi.fn()}));vi.mock('@/lib/marketing-messages-jobs.server',()=>({processMarketingMessages:mocks.process}));
describe('marketing cron authentication',()=>{
 beforeEach(()=>{vi.clearAllMocks();vi.stubEnv('CRON_SECRET','synthetic-cron-secret');});afterEach(()=>vi.unstubAllEnvs());
 it('rejects missing and different bearer credentials without processing',async()=>{for(const value of ['', 'Bearer wrong', 'Basic synthetic-cron-secret'])expect((await GET(new Request('http://localhost/api/cron/marketing-messages',{headers:{authorization:value}}))).status).toBe(401);expect(mocks.process).not.toHaveBeenCalled();});
 it('runs only authenticated jobs and returns no private recipient data',async()=>{mocks.process.mockResolvedValue({batches:2});const response=await GET(new Request('http://localhost/api/cron/marketing-messages',{headers:{authorization:'Bearer synthetic-cron-secret'}}));expect(response.status).toBe(200);expect(await response.json()).toEqual({ok:true,batches:2});expect(response.headers.get('cache-control')).toContain('no-store');});
 it('reports execution failure without treating publication as delivered',async()=>{mocks.process.mockRejectedValue(new Error('db unavailable'));expect((await GET(new Request('http://localhost/api/cron/marketing-messages',{headers:{authorization:'Bearer synthetic-cron-secret'}}))).status).toBe(503);});
});
