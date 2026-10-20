import { beforeEach,describe,expect,it,vi } from 'vitest';
const mocks=vi.hoisted(()=>({accept:vi.fn(),decline:vi.fn(),record:vi.fn(),state:vi.fn()}));
vi.mock('@/lib/store-analytics.server',()=>({acceptStoreAnalytics:mocks.accept,declineStoreAnalytics:mocks.decline,recordStoreAnalytics:mocks.record,storeAnalyticsState:mocks.state}));
import { GET,POST } from './route';
const event={eventId:'11111111-1111-4111-8111-111111111111',pageKind:'good',targetId:'test-good',linkToken:null,channel:'direct',source:'none',medium:'none'};
const request=(body:unknown,origin='https://icons.test')=>new Request('https://icons.test/api/store-analytics',{method:'POST',headers:{origin,'content-type':'application/json'},body:JSON.stringify(body)});
beforeEach(()=>{vi.clearAllMocks();mocks.accept.mockResolvedValue({ok:true,status:200});mocks.decline.mockResolvedValue({ok:true,status:200});mocks.record.mockResolvedValue({ok:true,status:200});});
describe('analytics same-origin endpoint',()=>{
 it('does not collect on reads or backend failure',async()=>{mocks.state.mockRejectedValue(new Error('offline'));expect((await GET()).status).toBe(503);expect(mocks.record).not.toHaveBeenCalled();});
 it('rejects cross-origin, absent origin, oversized or extra-field input before privileged work',async()=>{
  expect((await POST(request({action:'accept'},'https://evil.test'))).status).toBe(403);
  expect((await POST(new Request('https://icons.test/api/store-analytics',{method:'POST',body:'{}'}))).status).toBe(403);
  expect((await POST(request({action:'record',event:{...event,session:'fake'}}))).status).toBe(400);
  expect((await POST(request({action:'accept',extra:'x'.repeat(4096)}))).status).toBe(400);
  expect(mocks.accept).not.toHaveBeenCalled();expect(mocks.record).not.toHaveBeenCalled();
 });
 it('uses only the fixed parsed event and separate consent actions',async()=>{
  expect((await POST(request({action:'record',event}))).status).toBe(200);expect(mocks.record).toHaveBeenCalledWith(event);
  await POST(request({action:'accept'}));expect(mocks.accept).toHaveBeenCalledWith();
  await POST(request({action:'decline'}));expect(mocks.decline).toHaveBeenCalledWith();
 });
});
