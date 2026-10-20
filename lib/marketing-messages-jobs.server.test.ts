import { beforeEach,describe,expect,it,vi } from 'vitest';
import { processMarketingMessages } from './marketing-messages-jobs.server';
const mocks=vi.hoisted(()=>({rpc:vi.fn()}));vi.mock('server-only',()=>({}));vi.mock('@/lib/supabase/service',()=>({createServiceClient:()=>({rpc:mocks.rpc})}));
describe('bounded in-app processing',()=>{
 beforeEach(()=>vi.clearAllMocks());
 it('materializes and registers batches until no due work remains',async()=>{mocks.rpc.mockResolvedValueOnce({data:{processed:true,state:'processing'}}).mockResolvedValueOnce({data:{processed:true,state:'completed'}}).mockResolvedValueOnce({data:{processed:false}});expect(await processMarketingMessages('campaign')).toEqual({batches:2});expect(mocks.rpc).toHaveBeenCalledWith('process_due_marketing_campaigns',{p_campaign_id:'campaign'});});
 it('leaves excess work to the next invocation',async()=>{mocks.rpc.mockResolvedValue({data:{processed:true}});expect(await processMarketingMessages()).toEqual({batches:20});expect(mocks.rpc).toHaveBeenCalledTimes(20);});
 it('does not invent success from a malformed or failed RPC',async()=>{mocks.rpc.mockResolvedValue({error:{code:'XX000'}});await expect(processMarketingMessages()).rejects.toThrow('marketing_processing_failed');mocks.rpc.mockResolvedValue({data:{processed:'yes'}});await expect(processMarketingMessages()).rejects.toThrow('marketing_processing_failed');});
});
