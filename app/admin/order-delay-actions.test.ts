import {beforeEach,describe,expect,it,vi} from 'vitest';
import {prepareOrderDelayNoticeAction,requestOrderDelayNoticeAction,retryOrderDelayNoticeAction} from './order-delay-actions';
const mocks=vi.hoisted(()=>({auth:vi.fn(),rpc:vi.fn(),dispatcher:vi.fn(),refresh:vi.fn()}));
vi.mock('@/lib/auth/admin',()=>({getCurrentAdminAuthState:mocks.auth}));
vi.mock('@/lib/supabase/server',()=>({createClient:async()=>({rpc:mocks.rpc})}));
vi.mock('@/lib/email/dispatcher.server',()=>({emailDispatcherFromEnvironment:mocks.dispatcher}));
vi.mock('next/cache',()=>({revalidatePath:mocks.refresh}));
const id='40000000-0000-4000-8000-000000000001';
const notice={id,title:'발송 지연 안내',customerBody:'별도 고객 문구',expectedShipDate:null,createdAt:'2026-09-11T00:00:00Z',expiresAt:'2026-09-11T01:00:00Z',requestedAt:null,emailEnabled:true,
 targets:[{id:'40000000-0000-4000-8000-000000000002',orderId:'40000000-0000-4000-8000-000000000003',buyerName:'실제 구매자',recipientEmail:'buyer@example.test',shipmentIds:[id],shipmentLabels:['김포 · 00000001'],messageBody:'별도 고객 문구\n발송 예정일: 확인 중',inAppStatus:'prepared',emailStatus:'prepared',emailProviderState:null,errorCode:null,retryable:false,attempts:0}]};
beforeEach(()=>{vi.clearAllMocks();mocks.auth.mockResolvedValue({isConfigured:true,user:{id:'staff'},isStaff:true});mocks.dispatcher.mockReturnValue({});});
describe('지연 안내 서버 액션',()=>{
 it('직원 권한 없이 대상·내용을 저장하거나 고객에게 요청하지 못한다',async()=>{
  mocks.auth.mockResolvedValue({isConfigured:true,user:{id:'buyer'},isStaff:false});
  expect(await prepareOrderDelayNoticeAction({requestId:id,shipmentIds:[id],title:'안내',body:'고객 문구',expectedShipDate:null})).toEqual({error:'직원 권한이 필요합니다.'});
  expect(await requestOrderDelayNoticeAction(id)).toEqual({error:'직원 권한이 필요합니다.'});
  expect(await retryOrderDelayNoticeAction(id)).toEqual({error:'직원 권한이 필요합니다.'});
  expect(mocks.rpc).not.toHaveBeenCalled();
 });
 it('클라이언트 수신자를 받지 않고 선택한 배송 건과 별도 고객 문구만 DB에 전달한다',async()=>{
  mocks.rpc.mockResolvedValue({data:notice,error:null});
  const result=await prepareOrderDelayNoticeAction({requestId:id,shipmentIds:[id,id],title:' 발송 지연 안내 ',body:' 별도 고객 문구 ',expectedShipDate:null});
  expect(result).toEqual({notice,emailConfigured:true});
  expect(mocks.rpc).toHaveBeenCalledWith('admin_prepare_order_delay_notice',{target_notice:id,target_shipments:[id],customer_title:'발송 지연 안내',customer_body:'별도 고객 문구',expected_ship_date:null});
 });
 it('메일 설정이 없으면 두 채널 요청을 막고 준비 안 된 이유를 돌려준다',async()=>{
  mocks.rpc.mockResolvedValue({data:notice,error:null});mocks.dispatcher.mockReturnValue(null);
  expect(await requestOrderDelayNoticeAction(id)).toMatchObject({emailConfigured:false,error:'이메일 공급자 또는 발송 서명 설정이 준비되지 않았습니다.'});
  expect(mocks.rpc.mock.calls.map(([name])=>name)).toEqual(['admin_get_order_delay_notice']);
 });
 it('요청 뒤 응답이 유실돼도 이미 저장된 영수증으로 복구하며 추가 채널 발송을 요청하지 않는다',async()=>{
  const requested={...notice,requestedAt:'2026-09-11T00:01:00Z',targets:notice.targets.map(target=>({...target,inAppStatus:'sent',emailStatus:'unknown'}))};
  mocks.rpc.mockResolvedValue({data:requested,error:null});mocks.dispatcher.mockReturnValue(null);
  expect(await requestOrderDelayNoticeAction(id)).toEqual({notice:requested,emailConfigured:false});
  expect(mocks.rpc.mock.calls.map(([name])=>name)).toEqual(['admin_get_order_delay_notice']);
 });
 it('부분 영수증을 성공으로 표시하지 않고 stale 원인을 고객 정보 없이 돌려준다',async()=>{
  mocks.rpc.mockResolvedValueOnce({data:{id},error:null});
  expect(await prepareOrderDelayNoticeAction({requestId:id,shipmentIds:[id],title:'안내',body:'내용',expectedShipDate:null})).toHaveProperty('error');
  mocks.rpc.mockResolvedValueOnce({data:null,error:{message:'delay_notice_stale'}});
  expect(await prepareOrderDelayNoticeAction({requestId:id,shipmentIds:[id],title:'안내',body:'내용',expectedShipDate:null})).toMatchObject({error:expect.stringContaining('미리보기 이후')});
 });
 it.each(['2026-02-30','not-a-date'])('잘못된 예정일 %s는 저장 전에 거절한다',async date=>{
  expect(await prepareOrderDelayNoticeAction({requestId:id,shipmentIds:[id],title:'안내',body:'내용',expectedShipDate:date})).toHaveProperty('error');
  expect(mocks.rpc).not.toHaveBeenCalled();
 });
});
