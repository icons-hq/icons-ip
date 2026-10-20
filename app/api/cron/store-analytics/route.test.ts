import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
const mocks=vi.hoisted(()=>({rpc:vi.fn()}));
vi.mock('@/lib/supabase/service',()=>({createServiceClient:()=>({rpc:mocks.rpc})}));
import {GET} from './route';
beforeEach(()=>{vi.clearAllMocks();vi.stubEnv('CRON_SECRET','synthetic-cron');mocks.rpc.mockResolvedValue({data:{busy:false,archivedDays:0},error:null});});afterEach(()=>vi.unstubAllEnvs());
describe('analytics retention job authorization',()=>{
 it('requires the exact configured Bearer secret before any database call',async()=>{for(const authorization of ['', 'synthetic-cron','Bearer wrong'])expect((await GET(new Request('https://icons.test/api/cron/store-analytics',{headers:{authorization}}))).status).toBe(401);expect(mocks.rpc).not.toHaveBeenCalled();});
 it('runs the sealed job once and does not turn failure into success',async()=>{expect((await GET(new Request('https://icons.test/api/cron/store-analytics',{headers:{authorization:'Bearer synthetic-cron'}}))).status).toBe(200);expect(mocks.rpc).toHaveBeenCalledWith('process_store_analytics_retention');mocks.rpc.mockResolvedValue({data:null,error:{code:'offline'}});expect((await GET(new Request('https://icons.test/api/cron/store-analytics',{headers:{authorization:'Bearer synthetic-cron'}}))).status).toBe(503);});
});
