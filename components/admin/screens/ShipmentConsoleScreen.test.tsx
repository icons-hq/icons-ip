import {renderToStaticMarkup} from 'react-dom/server';
import {describe,expect,it,vi} from 'vitest';
import {ShipmentConsoleScreen} from './ShipmentConsoleScreen';
import type {ShipmentConsoleData} from '@/lib/admin/shipment-dispatch';
import {shipmentDeliveryFixture} from '@/lib/shipment-delivery.fixture';
vi.mock('next/navigation',()=>({useRouter:()=>({refresh:vi.fn()}),usePathname:()=>'/admin/sales/dispatch'}));
vi.mock('@/app/admin/order-actions',()=>({bulkConfirmAdminOrdersAction:vi.fn(),bulkRegisterAdminOrderTrackingAction:vi.fn(),saveAdminOrderDispatchDelayAction:vi.fn()}));
vi.mock('@/app/admin/shipment-actions',()=>({completeShipmentsAction:vi.fn(),exportShipmentsAction:vi.fn(),exportPendingOriginShipmentsAction:vi.fn()}));
vi.mock('@/app/admin/dispatch-delivery-actions',()=>({readDispatchShipmentDeliveryAction:vi.fn(),recordDispatchShipmentDeliveryAction:vi.fn()}));
vi.mock('@/app/admin/shipment-tracking-actions',()=>({addShipmentExtraTrackingAction:vi.fn(),removeShipmentExtraTrackingAction:vi.fn()}));
const base:ShipmentConsoleData={surface:'dispatch',filters:{tab:'ready',originId:null,query:'',from:null,to:null,page:1},rows:[],total:2,pageSize:100,counts:{new:0,ready:2,delayed:0,transit:0,delivered:0},carriers:[{code:'hanjin',label:'한진택배',active:true,trackingUrlTemplate:'https://example.test/{trackingNumber}'}],origins:[{id:'one',name:'김포',template:'wms_csv',active:true},{id:'two',name:'남양주',template:'seowon_xlsx',active:true},{id:'three',name:'중지된 창고',template:'standard',active:false}]};
const row={id:'60000000-0000-4000-8000-000000000001',orderId:'50000000-0000-4000-8000-000000000001',originId:'one',originName:'김포',status:'ready' as const,createdAt:'2026-09-08T00:00:00Z',confirmedAt:'2026-09-08T01:00:00Z',buyerName:'구매자',recipientName:'받는 분',total:30000,paymentMethod:'card',shippingFee:3000,carrier:null,trackingNumber:null,shippedAt:null,deliveredAt:null,exportedAt:null,updatedAt:'2026-09-08T00:00:00Z',delayReason:null,expectedShipDate:null,items:[{id:'item-1',name:'상품',variantName:'파랑',qty:2}]};
describe('배송 건 콘솔',()=>{
 it('물류 계정(판매 관리 권한 없음)의 신규주문 탭에는 발주확인을 못 하는 이유를 한 줄 알린다(QA 라운드 1b)',()=>{
  const newTab={...base,filters:{...base.filters,tab:'new' as const},rows:[]};
  expect(renderToStaticMarkup(<ShipmentConsoleScreen canManageSales={false} canReadOrders={false} data={newTab}/>)).toContain('발주확인은 계정 주매니저가 합니다. 물류 계정은 발송 대기부터 처리합니다.');
  expect(renderToStaticMarkup(<ShipmentConsoleScreen data={newTab}/>)).not.toContain('발주확인은 계정 주매니저가 합니다');
 });
 it('주문 조회 권한이 없는 출고 전용 운영자에게는 구매자·결제·금액 조건과 주문 상세 링크 없이 택배 외 인계 팝업을 둔다 (1014-084 수령인 정보만)',()=>{
  const rows=[{...row,buyerName:null as unknown as string,total:null as unknown as number,paymentMethod:null as unknown as string,shippingFee:null as unknown as number,production:{count:1,completed:1,ready:true}},
   {...row,id:'60000000-0000-4000-8000-000000000002',delivery:shipmentDeliveryFixture({method:'quick'})}] as ShipmentConsoleData['rows'];
  for(const surface of ['dispatch','shipping'] as const){
   const html=renderToStaticMarkup(<ShipmentConsoleScreen canReadOrders={false} data={{...base,surface,filters:{...base.filters,tab:'ready'},rows}}/>);
   expect(html).not.toContain('구매자명');expect(html).not.toContain('/admin/sales/orders/');expect(html).not.toContain('name="paymentMethod"');
   expect(html).not.toContain('주문금액 높은순');expect(html).not.toContain('>결제일<');expect(html).not.toContain('value="buyer"');
   expect(html).toContain('받는 분');expect(html).toContain('상품 · 파랑');expect(html).toContain('배송건번호 · 주문번호 · 수령인');
  }
  const dispatch=renderToStaticMarkup(<ShipmentConsoleScreen canReadOrders={false} data={{...base,rows}}/>);
  expect(dispatch).toMatch(/aria-haspopup="dialog"[^>]*>퀵 인계·수령 확인<\/button>/);expect(dispatch).toContain('<span>주문제작 1/1건 완료</span>');
 });
 /* 2026-11-12 "착불 금액은 보이게": 착불 배송비·합포장 착불 합계·착불 수납 정보는 파일뿐 아니라 이 화면에서도 읽기 전용으로 보인다. */
 it.each([false,true])('발송·배송현황 행에 착불 배송비·합포장 착불 합계·착불 수납 정보를 읽기 전용으로 보인다 (주문 조회 권한 %s)',canReadOrders=>{
  const collector={name:'한진택배',method:'수령 시 기사에게 현금',refundContact:'고객센터 1588-0000',instructions:'착불 배송비는 상품 수령 때 지급합니다.'};
  const pack={id:'70000000-0000-4000-8000-0000000000aa',revision:1,count:2,shipmentIds:['60000000-0000-4000-8000-000000000001','60000000-0000-4000-8000-000000000002'],collectFee:8000,canRelease:true};
  const rows=[{...row,pack,collect:{collectFee:4000,collector}},{...row,id:'60000000-0000-4000-8000-000000000002',pack,collect:{collectFee:4000,collector:null}},
   {...row,id:'60000000-0000-4000-8000-000000000003',collect:null}] as ShipmentConsoleData['rows'];
  for(const surface of ['dispatch','shipping'] as const){
   const html=renderToStaticMarkup(<ShipmentConsoleScreen actorId="10000000-0000-4000-8000-000000000001" canManageSales={false} canReadOrders={canReadOrders} data={{...base,surface,filters:{...base.filters,tab:surface==='dispatch'?'ready':'transit'},rows}}/>);
   expect(html.match(/착불 배송비 ₩4,000/g)).toHaveLength(2);expect(html.match(/합포장 착불 합계 ₩8,000/g)).toHaveLength(2);
   for(const text of ['착불 수납 주체','한진택배','수납 방법','수령 시 기사에게 현금','고객 안내','착불 배송비는 상품 수령 때 지급합니다.','착불 환급 문의','고객센터 1588-0000']) expect(html).toContain(text);
   expect(html).toContain('이 주문에는 착불 수납 정보 기록이 없습니다.');expect(html.match(/data-shipment-collect=""/g)).toHaveLength(2);
   // 읽기 전용: 합포장 만들기·해제(합포장 관리)는 판매 관리 권한에만 있다.
   expect(html).not.toContain('>합포장 관리</button>');
  }
  expect(renderToStaticMarkup(<ShipmentConsoleScreen actorId="10000000-0000-4000-8000-000000000001" canReadOrders={canReadOrders} data={{...base,rows}}/>)).toContain('>합포장 관리</button>');
 });
 it('주문 조회 권한이 있는 주매니저 화면은 지금과 같다 (1014-084)',()=>{
  const data={...base,rows:[row,{...row,id:'60000000-0000-4000-8000-000000000002',delivery:shipmentDeliveryFixture({method:'quick'})}]} as ShipmentConsoleData;
  const html=renderToStaticMarkup(<ShipmentConsoleScreen data={data}/>);
  expect(renderToStaticMarkup(<ShipmentConsoleScreen data={data} canReadOrders/>)).toBe(html);
  expect(html).toContain('구매자명');expect(html).toContain('/admin/sales/orders/');expect(html).toContain('name="paymentMethod"');
  expect(html).toContain('주문금액 높은순');expect(html).toContain('>결제일<');expect(html).toMatch(/<a [^>]*href="\/admin\/sales\/orders\/[^"]*"[^>]*>퀵 인계·수령 확인<\/a>/);
 });
 it('지원하는 모든 배송방법을 검색하고 다운로드 방식은 파일 제공 이력으로 연결한다',()=>{
  const html=renderToStaticMarkup(<ShipmentConsoleScreen data={{...base,rows:[{...row,delivery:shipmentDeliveryFixture({method:'digital'})}]}}/>);
  for(const method of ['parcel','quick','pickup','direct','freight','none','digital']) expect(html).toContain(`value="${method}"`);
  expect(html).toContain('디지털 파일 제공 이력');expect(html).not.toContain('디지털 파일 다운로드 인계·수령 확인');
 });
 it.each(['dispatch','shipping'] as const)('구매자와 수령인을 각각 기본 열로 보여준다: %s',surface=>{
  const html=renderToStaticMarkup(<ShipmentConsoleScreen data={{...base,surface,filters:{...base.filters,tab:surface==='dispatch'?'ready':'delivered'},
   rows:[{...row,buyerName:'서로 다른 구매자',recipientName:'별도 수령인'}]}}/>);
  expect(html).toContain('구매자명');expect(html).toContain('서로 다른 구매자');expect(html).toContain('별도 수령인');
  expect(html).toContain('조회항목 설정');
  const missing=renderToStaticMarkup(<ShipmentConsoleScreen data={{...base,surface,filters:{...base.filters,tab:surface==='dispatch'?'ready':'delivered'},
   rows:[{...row,buyerName:'구매자만 확인',recipientName:null}]}}/>);
  expect(missing).toContain('미기록');
  /* 수령인 칸이 구매자명으로 채워지지 않는다. 긴 이름을 자르는 title에도 같은 값이 있으므로 보이는 글자 칸만 센다. */
  expect((missing.match(/>구매자만 확인</g)??[])).toHaveLength(1);
 });
 it('원본 안내여부 필터를 실제 채널 결과로 구분하고 검색 폼의 중복 hidden 값을 만들지 않는다',()=>{
  const notice={status:'partial_failed' as const,noticeId:'11111111-1111-4111-8111-111111111111',requestedAt:'2026-10-13T10:00:00Z',inAppStatus:'sent' as const,emailStatus:'failed' as const,emailProviderState:'bounced'};
  const html=renderToStaticMarkup(<ShipmentConsoleScreen data={{...base,filters:{...base.filters,delayNotice:'partial_failed'},rows:[{...row,delayNotice:notice}]}}/>);
  expect(html).toContain('발송지연 안내여부');expect(html).toContain('지연 안내 결과');expect(html).toContain('앱 발송 · 이메일 실패');
  expect(html).toContain('<option value="partial_failed" selected="">일부 채널 실패·제외</option>');
  expect(html).toContain('delayNotice=partial_failed');expect(html).toContain('고객의 수신·열람을 뜻하지 않습니다');
  expect(html).toContain('data-sales-filters=""');
  const searchForm=html.slice(html.indexOf('data-sales-filters=""'),html.indexOf('</form>'));
  expect((searchForm.match(/name="delayNotice"/g)??[])).toHaveLength(1);
  const shipping=renderToStaticMarkup(<ShipmentConsoleScreen data={{...base,surface:'shipping',filters:{...base.filters,tab:'transit'}}}/>);
  expect(shipping).not.toContain('name="delayNotice"');
 });
 it('지연 탭은 예약 미할당·방문수령도 고객 안내 대상으로 선택하면서 기존 출고 실행은 막는다',()=>{
  const html=renderToStaticMarkup(<ShipmentConsoleScreen data={{...base,filters:{...base.filters,tab:'delayed'},rows:[{...row,preorderReady:false,delivery:shipmentDeliveryFixture()}]}}/>);
  expect(html).toContain(`aria-label="배송 건 ${row.id.slice(-8).toUpperCase()} 선택"`);
  expect(html).toContain('고객 지연 안내');expect(html).toContain('고객 지연 안내 이력·결과');
  expect(html).toMatch(/disabled=""[^>]*>출고지시 내보내기/);
 });
 it('같은 주문의 두 출고지를 별도 행으로 표시하고 발송은 업로드 한 곳으로 모은다',()=>{
  const html=renderToStaticMarkup(<ShipmentConsoleScreen data={{...base,rows:[row,{...row,id:'60000000-0000-4000-8000-000000000002',originName:'남양주',originId:'two',exportedAt:'2026-09-08T01:10:00Z'}]}}/>);
  expect(html).toContain('김포');expect(html).toContain('남양주');expect(html).toContain('상품 · 파랑');
  expect(html).toContain('출고지시 내보내기');expect(html).toContain('출고지시 전달');expect(html).toContain('1,000');
  expect(html).not.toContain('선택→발송');expect(html).not.toContain('name="status" value="shipping"');
  expect(html).toContain('name="originId"');expect(html).toContain('/admin/sales/orders/50000000');
  expect(html).toContain('target="_blank"');expect(html).toContain('rel="noopener noreferrer"');
  expect(html).toContain('주문 00000001 상세 열기 (새 탭)');expect(html).toContain('back=%2Fadmin%2Fsales%2Fdispatch');
 });
 it('배송완료는 배송 건 선택으로 처리하고 개별 운송장 링크를 보여준다',()=>{
  const html=renderToStaticMarkup(<ShipmentConsoleScreen data={{...base,surface:'shipping',filters:{...base.filters,tab:'transit'},rows:[{...row,status:'shipping',carrier:'hanjin',trackingNumber:'12345678',shippedAt:'2026-09-08T02:00:00Z'}]}}/>);
  expect(html).toContain('선택 배송완료');expect(html).toContain('https://example.test/12345678');
  // 회신 재업로드·늦은 회신도 배송현황에서 바로 올린다. 출고지시 내려받기는 발주·발송에만 있다.
  expect(html).toContain('엑셀 일괄 운송장 등록');expect(html).not.toContain('새 출고지시 전체 내려받기');
 });
 it('발송 대기·지연 탭은 사용 중 출고지마다 새 출고지시 전체 내려받기를, 출고지 필터에서는 그 출고지만 보여준다',()=>{
  const all=renderToStaticMarkup(<ShipmentConsoleScreen data={{...base,rows:[row]}}/>);
  expect(all).toContain('김포 새 출고지시 전체 내려받기');expect(all).toContain('남양주 새 출고지시 전체 내려받기');
  expect(all).not.toContain('중지된 창고 새 출고지시');
  const filtered=renderToStaticMarkup(<ShipmentConsoleScreen data={{...base,filters:{...base.filters,tab:'delayed',originId:'two'},rows:[row]}}/>);
  expect(filtered).toContain('남양주 새 출고지시 전체 내려받기');expect(filtered).not.toContain('김포 새 출고지시 전체 내려받기');
  const incoming=renderToStaticMarkup(<ShipmentConsoleScreen data={{...base,filters:{...base.filters,tab:'new'},rows:[row]}}/>);
  expect(incoming).not.toContain('새 출고지시 전체 내려받기');expect(incoming).toContain('엑셀 일괄 운송장 등록');
 });
 it('퀵·방문수령은 목록에서 방식별 확인으로 연결하고 택배 일괄 선택에서 제외한다',()=>{
  const pickup={...row,delivery:shipmentDeliveryFixture()};
  const html=renderToStaticMarkup(<ShipmentConsoleScreen data={{...base,rows:[pickup]}}/>);
  expect(html).toContain('배송 방식');expect(html).toContain('방문수령 인계·수령 확인');
  expect(html).not.toContain(`aria-label="배송 건 ${row.id.slice(-8).toUpperCase()} 선택"`);
  // 회신 업로드는 파일로 출고지를 찾으므로 퀵·방문수령만 보이는 페이지에서도 연다.
  expect(html).toContain('엑셀 일괄 운송장 등록');expect(html).not.toContain('운송장 확인 필요');
  expect(html).not.toContain('출고지시 내보내기');
  const transit=renderToStaticMarkup(<ShipmentConsoleScreen data={{...base,surface:'shipping',filters:{...base.filters,tab:'transit'},
   rows:[{...pickup,status:'shipping',delivery:shipmentDeliveryFixture({method:'quick',providerName:'실제 퀵 업체'})}]}}/>);
  expect(transit).toContain('퀵 배송 중');expect(transit).toContain('퀵 인계·수령 확인');
  expect(transit).not.toContain('운송장 확인 필요');
  expect(transit).not.toContain('선택 배송완료');
 });
 it('실재고가 미할당된 예약 배송 건은 출고 파일 선택을 막고 주문 확인은 유지한다',()=>{
  const held={...row,preorderReady:false};
  const ready=renderToStaticMarkup(<ShipmentConsoleScreen data={{...base,rows:[held]}}/>);
  expect(ready).toContain('예약 재고 할당 필요');expect(ready).not.toContain(`aria-label="배송 건 ${row.id.slice(-8).toUpperCase()} 선택"`);
  const incoming=renderToStaticMarkup(<ShipmentConsoleScreen data={{...base,filters:{...base.filters,tab:'new'},rows:[held]}}/>);
  expect(incoming).toContain(`aria-label="배송 건 ${row.id.slice(-8).toUpperCase()} 선택"`);expect(incoming).toContain('발주확인');
 });
 it('배송 상태와 처리할 신규주문을 색으로 구분한다',()=>{
  const html=renderToStaticMarkup(<ShipmentConsoleScreen now={new Date('2026-09-09T02:00:00Z')} data={{...base,surface:'shipping',counts:{...base.counts,new:3},filters:{...base.filters,tab:'transit'},rows:[{...row,status:'shipping',carrier:'hanjin',trackingNumber:'12345678',shippedAt:'2026-09-08T02:00:00Z'}]}}/>);
  expect(html).toMatch(/data-tone="info"[^>]*>배송 중</);
  const dispatch=renderToStaticMarkup(<ShipmentConsoleScreen data={{...base,counts:{...base.counts,new:3},rows:[row]}}/>);
  expect(dispatch).toMatch(/aria-label="신규주문 3건"[^>]*data-tone="warning"/);
 });
 it('1440 화면에 주요 열이 들어오도록 지연 안내 결과는 지연 탭·해당 조건에서만 기본으로 보인다',()=>{
  const header=(html:string)=>html.slice(html.indexOf('<thead'),html.indexOf('</thead>'));
  expect(header(renderToStaticMarkup(<ShipmentConsoleScreen data={{...base,rows:[row]}}/>))).not.toContain('지연 안내 결과');
  expect(header(renderToStaticMarkup(<ShipmentConsoleScreen data={{...base,filters:{...base.filters,tab:'delayed'},rows:[row]}}/>))).toContain('지연 안내 결과');
  const order=header(renderToStaticMarkup(<ShipmentConsoleScreen data={{...base,rows:[row]}}/>));
  expect(order.indexOf('상품 · 옵션')).toBeLessThan(order.indexOf('출고지'));
  expect(order.indexOf('발송·인계')).toBeLessThan(order.indexOf('배송 방식'));
 });
 it('운송장 회신이 일이 아닌 신규주문 탭에서는 표 아래로 비켜 표가 먼저 보이고, 탭을 옮겨도 패널의 트리 자리는 그대로다',()=>{
  /* 코드 리뷰: DOM 자리가 탭마다 달라 패널이 다시 마운트되면 붙여넣은 내용·고른 파일·실패 보고가 사라졌다. 화면 위치만 CSS order로 바꾼다. */
  const slot=(html:string)=>html.match(/<div class="([^"]*)" data-shipment-import-slot=""/)?.[1]??'';
  const at=(html:string)=>[html.indexOf('data-sales-results-heading'),html.indexOf('data-shipment-import-slot'),html.indexOf('<thead')];
  const incoming=renderToStaticMarkup(<ShipmentConsoleScreen data={{...base,filters:{...base.filters,tab:'new'},rows:[row]}}/>);
  const ready=renderToStaticMarkup(<ShipmentConsoleScreen data={{...base,rows:[row]}}/>);
  for(const html of [incoming,ready]){const [heading,panel,table]=at(html);expect(heading).toBeGreaterThan(0);expect(panel).toBeGreaterThan(heading);expect(table).toBeGreaterThan(panel);}
  expect(slot(incoming)).toContain('order-last');expect(slot(ready)).not.toContain('order-last');
 });
 it('오래 배송 중인 건을 표에 적고 배송중·배송완료 카드를 다른 아이콘으로 나눈다',()=>{
  const html=renderToStaticMarkup(<ShipmentConsoleScreen now={new Date('2026-09-15T02:00:00Z')} data={{...base,surface:'shipping',counts:{...base.counts,transit:1,delivered:1},filters:{...base.filters,tab:'transit'},rows:[{...row,status:'shipping',carrier:'hanjin',trackingNumber:'12345678',shippedAt:'2026-09-08T02:00:00Z'}]}}/>);
  expect(html).toContain('7일째 배송 중');
  const icon=(label:string)=>html.slice(html.indexOf(`aria-label="${label}`)).match(/lucide-[a-z-]+/)?.[0];
  expect(icon('배송중 1건')).not.toBe(icon('배송완료 1건'));
 });
 /* 사람 눈 판정: 전부 같은 회색 '내보내기 전'이라 며칠 묵은 주문이 안 띄었고, 위에 지연 건수가 있어도 표에서 어느 건인지 몰랐다. */
 it('묵은 신규주문과 발송 지연 건을 표에서 바로 구분한다',()=>{
  const now=new Date('2026-09-15T02:00:00Z');
  const fresh={...row,createdAt:'2026-09-15T01:00:00Z',confirmedAt:null};
  const stale={...row,id:'60000000-0000-4000-8000-000000000002',createdAt:'2026-09-08T00:00:00Z',confirmedAt:null};
  const incoming=renderToStaticMarkup(<ShipmentConsoleScreen now={now} data={{...base,filters:{...base.filters,tab:'new'},rows:[fresh,stale]}}/>);
  /* 사람 눈 판정(3라운드): 위 카드는 빨간 지연인데 표는 전부 노란 'N일째 대기'라 어느 줄이 지연인지 몰랐다. 색은 카드와 같은 판정인 줄에만 쓰고 나머지 대기는 글자로 둔다. */
  expect(incoming).not.toMatch(/data-tone="[a-z]+"[^>]*>7일째 대기</);expect(incoming).toContain('>7일째 대기<');expect(incoming).toContain('>오늘 주문<');expect(incoming).not.toContain('내보내기 전');
  /* 진짜 상태인 발주확인 전은 날짜 밑 작은 글자가 아니라 상태로 보인다. */
  expect(incoming).toMatch(/data-tone="warning"[^>]*>발주확인 전</);
  const late=renderToStaticMarkup(<ShipmentConsoleScreen now={now} data={{...base,rows:[row]}}/>);
  expect(late).toMatch(/data-tone="danger"[^>]*>발송 지연 · 7일째</);
  const onTime=renderToStaticMarkup(<ShipmentConsoleScreen now={new Date('2026-09-09T02:00:00Z')} data={{...base,rows:[row]}}/>);
  expect(onTime).not.toContain('발송 지연 ·');
 });
 it('예약 건의 지연 날수는 약속한 발송일부터 세고, 약속일이 안 지났으면 지연으로 적지 않는다',()=>{
  const now=new Date('2026-09-15T02:00:00Z');
  const preorder=(expectedShipDate:string)=>({...row,originalExpectedShipDate:'2026-09-10',expectedShipDate,confirmedAt:'2026-09-01T01:00:00Z'});
  expect(renderToStaticMarkup(<ShipmentConsoleScreen now={now} data={{...base,rows:[preorder('2026-09-12')]}}/>)).toMatch(/data-tone="danger"[^>]*>발송 지연 · 3일째</);
  expect(renderToStaticMarkup(<ShipmentConsoleScreen now={now} data={{...base,rows:[preorder('2026-09-15')]}}/>)).not.toContain('발송 지연 ·');
 });
 it('오늘·N일째는 24시간이 아니라 한국 달력으로 센다',()=>{
  /* 전날 23시 30분(KST)에 들어온 주문은 1시간 뒤 자정을 넘기면 오늘 주문이 아니다. */
  const incoming=renderToStaticMarkup(<ShipmentConsoleScreen now={new Date('2026-09-14T15:30:00Z')} data={{...base,filters:{...base.filters,tab:'new'},rows:[{...row,createdAt:'2026-09-14T14:30:00Z',confirmedAt:null}]}}/>);
  expect(incoming).toContain('>1일째 대기<');expect(incoming).not.toContain('>오늘 주문<');
  /* 같은 날 안에서는 23시간이 지나도 오늘이다. */
  expect(renderToStaticMarkup(<ShipmentConsoleScreen now={new Date('2026-09-14T14:30:00Z')} data={{...base,filters:{...base.filters,tab:'new'},rows:[{...row,createdAt:'2026-09-13T15:10:00Z',confirmedAt:null}]}}/>)).toContain('>오늘 주문<');
 });
 it('긴 구매자·수령인 이름은 한 줄로 자르고 전체 값을 title에 둔다',()=>{
  const name='메이플20년차모험가_민지';
  const html=renderToStaticMarkup(<ShipmentConsoleScreen data={{...base,rows:[{...row,buyerName:name,recipientName:name}]}}/>);
  expect(html.match(new RegExp(`class="block truncate [^"]*" title="${name}"`,'g'))).toHaveLength(2);
 });
 it('상품 · 옵션 칸은 품목을 줄이지 않고 옵션과 수량을 모두 보여주며 긴 이름은 줄바꿈한다',()=>{
  const items=[1,2,3,4].map(index=>({id:`item-${index}`,name:`아주 긴 상품 이름 ${index}`,variantName:`옵션 ${index}`,qty:index+1}));
  const html=renderToStaticMarkup(<ShipmentConsoleScreen data={{...base,rows:[{...row,items}]}}/>);
  for(const item of items){
   expect(html).toMatch(new RegExp(`wrap-anywhere[^>]*>${item.name} · ${item.variantName}<`));
   expect(html).toContain(`× ${item.qty}`);
  }
  expect(html).not.toMatch(/외 \d+건/);
  expect(html).not.toMatch(/line-clamp-1[^>]*>아주 긴 상품 이름/);
 });
 it('오래 배송 중인 건수를 카드로 세우고 운송장 번호를 한 줄로 둔다',()=>{
  const transit={...row,status:'shipping' as const,carrier:'hanjin',trackingNumber:'12345678',shippedAt:'2026-09-08T02:00:00Z'};
  const html=renderToStaticMarkup(<ShipmentConsoleScreen now={new Date('2026-09-15T02:00:00Z')} data={{...base,surface:'shipping',total:1,counts:{...base.counts,transit:1},filters:{...base.filters,tab:'transit'},rows:[transit]}}/>);
  expect(html).toContain('5일 이상 배송');expect(html).toMatch(/data-tone="warning"[^>]*>7일째 배송 중</);expect(html).toMatch(/tabular-nums whitespace-nowrap"[^>]*>한진택배 12345678</);
 });
 it('운송장 가져오기는 목록 머리의 버튼으로 두어 표를 밀지 않고 신규주문 탭에서는 표 아래에 둔다',()=>{
  const ready=renderToStaticMarkup(<ShipmentConsoleScreen data={{...base,rows:[row]}}/>);
  const heading=ready.slice(ready.indexOf('data-sales-results-heading'),ready.indexOf('<thead'));
  expect(heading).toMatch(/<summary[^>]*data-slot="button"[^>]*>운송장 가져오기 · 창고 회신 등록/);
 });
 it('운송장 가져오기는 목록과 분리된 접힌 작업으로 열고 닫아도 입력 상태를 보존한다',()=>{
  const html=renderToStaticMarkup(<ShipmentConsoleScreen data={{...base,rows:[row]}}/>);
  /* 접힌 채로 그린다 — 운송장 가져오기 disclosure에는 open이 없다. */
  expect(html).toMatch(/<details (?:(?!open)[^>])*data-shipment-import=""(?:(?!open)[^>])*>/);
  expect(html).toMatch(/<summary[^>]*>운송장 가져오기 · 창고 회신 등록</);
  expect(html).toContain('순서: 대상 선택 → 출고지시 내보내기 → 창고 회신 → 운송장 등록');
 });
});
describe('배송 건 목록 엑셀 다운로드',()=>{
 it('출고지시 파일과 다른 이름으로 현재 탭·출고지 조건을 내려받는다',()=>{
  const html=renderToStaticMarkup(<ShipmentConsoleScreen data={{...base,filters:{...base.filters,originId:'00000000-0000-4000-8000-000000042201',query:'홍',page:2},rows:[row]}}/>);
  expect(html).toContain('목록 엑셀 다운로드');expect(html).toContain('출고지시 내보내기');
  expect(html).toContain('data-export-href="/api/admin/list-export?screen=dispatch&amp;tab=ready&amp;originId=00000000-0000-4000-8000-000000042201&amp;query=%ED%99%8D"');
  const shipping=renderToStaticMarkup(<ShipmentConsoleScreen data={{...base,surface:'shipping',filters:{...base.filters,tab:'delivered'}}}/>);
  expect(shipping).toContain('data-export-href="/api/admin/list-export?screen=shipping&amp;tab=delivered"');
 });
});
describe('주문번호 상세 팝업 (S36-075)',()=>{
 it.each(['dispatch','shipping'] as const)('번호는 같은 목록 위 팝업(orderId)을 열고 새 탭 열기는 보조 링크로 남긴다: %s',surface=>{
  const html=renderToStaticMarkup(<ShipmentConsoleScreen data={{...base,surface,filters:{...base.filters,tab:surface==='dispatch'?'ready':'transit',query:'maple'},rows:[{...row,status:surface==='dispatch'?'ready':'shipping'}]}}/>);
  expect(html).toContain(`href="/admin/sales/${surface}?tab=${surface==='dispatch'?'ready':'transit'}&amp;page=1&amp;query=maple&amp;orderId=${row.orderId}"`);
  expect(html).toContain('aria-label="주문 00000001 상세 팝업 열기"');expect(html).toContain('aria-label="주문 00000001 상세 열기 (새 탭)"');
  expect(html).toMatch(/aria-label="주문 00000001 상세 팝업 열기"(?:(?!target=)[^>])*>/);
 });
});
describe('발송처리 화면의 행 운송장·배송 방법 (S36-072·S36-X04)',()=>{
 const header=(html:string)=>html.slice(html.indexOf('<thead'),html.indexOf('</thead>'));
 const withCarrier={...base,origins:[{...base.origins[0],defaultCarrier:'hanjin'},...base.origins.slice(1)]};
 it('발송 대기·지연 탭은 발송할 수 있는 택배 행마다 택배사·운송장 칸을 두고 출고지 기본 택배사를 미리 고른다',()=>{
  const html=renderToStaticMarkup(<ShipmentConsoleScreen data={{...withCarrier,rows:[row]}}/>);
  /* QA 라운드 1 M1-a: 운송장 입력은 발송 상태 칸 아래에 둔다(1440 화면에서 가로 스크롤 없이 [등록]이 보이게). */
  expect(header(html)).toContain('발송 · 운송장');expect(header(html)).not.toContain('택배사 · 운송장');
  expect(html).toContain('aria-label="배송 건 00000001 운송장번호"');expect(html).toContain('aria-label="배송 건 00000001 택배사"');
  expect(html).toMatch(/<option value="hanjin" selected="">한진택배<\/option>/);
  expect(html).toContain('data-shipment-row-tracking=""');
  const delayed=renderToStaticMarkup(<ShipmentConsoleScreen data={{...withCarrier,filters:{...base.filters,tab:'delayed'},rows:[row]}}/>);
  expect(delayed).toContain('data-shipment-row-tracking=""');expect(delayed).toContain('택배 외 발송처리');
 });
 it('예약 재고 할당 전·택배 외 행은 운송장 칸 대신 이유를 적고, 신규주문·배송현황에는 칸을 두지 않는다',()=>{
  const held=renderToStaticMarkup(<ShipmentConsoleScreen data={{...base,rows:[{...row,preorderReady:false}]}}/>);
  expect(held).not.toContain('data-shipment-row-tracking=""');expect(held).toContain('예약 재고 할당·제작 완료 뒤 입력합니다.');
  /* 택배 외 행은 같은 칸의 인계·수령 확인으로 처리한다 — 따로 '주문 상세에서 처리' 안내를 두지 않는다(QA 라운드 1 m7). */
  const pickup=renderToStaticMarkup(<ShipmentConsoleScreen data={{...base,rows:[{...row,delivery:shipmentDeliveryFixture()}]}}/>);
  expect(pickup).not.toContain('택배 외 배송 — 배송 방법·주문 상세에서 처리합니다.');expect(pickup).toContain('방문수령 인계·수령 확인');
  expect(pickup).not.toContain('data-shipment-row-tracking');
  const incoming=renderToStaticMarkup(<ShipmentConsoleScreen data={{...base,filters:{...base.filters,tab:'new'},rows:[row]}}/>);
  expect(header(incoming)).not.toContain('운송장');expect(incoming).not.toContain('data-shipment-row-tracking');
  const shipping=renderToStaticMarkup(<ShipmentConsoleScreen data={{...base,surface:'shipping',filters:{...base.filters,tab:'transit'},rows:[{...row,status:'shipping',carrier:'hanjin',trackingNumber:'12345678'}]}}/>);
  expect(header(shipping)).not.toContain('발송 · 운송장');expect(shipping).not.toContain('배송 방법 변경·인계');
 });
 it('출고지시 전달 전 준비 건에만 행의 배송 방법 버튼을 두고 배송없음·디지털은 구매 때 방식을 유지한다',()=>{
  const html=renderToStaticMarkup(<ShipmentConsoleScreen data={{...base,rows:[row]}}/>);
  expect(html).toContain('aria-label="배송 건 00000001 배송 방법 변경·인계"');
  const exported=renderToStaticMarkup(<ShipmentConsoleScreen data={{...base,rows:[{...row,exportedAt:'2026-09-08T01:10:00Z'}]}}/>);
  expect(exported).not.toContain('배송 방법 변경·인계');
  const fixed=renderToStaticMarkup(<ShipmentConsoleScreen data={{...base,rows:[{...row,delivery:shipmentDeliveryFixture({method:'none'})}]}}/>);
  expect(fixed).not.toContain('배송 방법 변경·인계');
  const incoming=renderToStaticMarkup(<ShipmentConsoleScreen data={{...base,filters:{...base.filters,tab:'new'},rows:[row]}}/>);
  expect(incoming).toContain('배송 방법 변경·인계');
 });
 it('택배 외 한 방법만 모아 본 발송 대기 목록은 그 건을 골라 일괄 발송처리하고 출고지시·합포장 막대는 숨긴다',()=>{
  const quick={...row,delivery:shipmentDeliveryFixture({method:'quick'})};
  const unfiltered=renderToStaticMarkup(<ShipmentConsoleScreen actorId="actor" data={{...base,rows:[quick]}}/>);
  expect(unfiltered).not.toContain(`aria-label="배송 건 ${row.id.slice(-8).toUpperCase()} 선택"`);
  const filtered=renderToStaticMarkup(<ShipmentConsoleScreen actorId="actor" data={{...base,filters:{...base.filters,method:'quick'},rows:[quick]}}/>);
  expect(filtered).toContain(`aria-label="배송 건 ${row.id.slice(-8).toUpperCase()} 선택"`);
  expect(filtered).toContain('택배 외 발송처리');expect(filtered).not.toContain('합포장 관리');
  const workbar=filtered.slice(filtered.indexOf('data-sales-workbar'),filtered.indexOf('출고지별 새 출고지시 내려받기'));
  expect(workbar).not.toContain('출고지시 내보내기');
  /* 택배가 섞인 기본 목록의 전체 선택은 그대로 택배 건만 고른다. */
  const mixed=renderToStaticMarkup(<ShipmentConsoleScreen data={{...base,rows:[row,{...quick,id:'60000000-0000-4000-8000-000000000002'}]}}/>);
  expect(mixed).toContain(`aria-label="배송 건 ${row.id.slice(-8).toUpperCase()} 선택"`);expect(mixed).not.toContain('aria-label="배송 건 00000002 선택"');
  expect(mixed).toContain('출고지시 내보내기');expect(mixed).toContain('택배 외 발송처리');
 });
});
describe('리뷰 반영: 주문번호 글자 팝업·택배 외 필터 안내',()=>{
 it('배송건번호와 "주문 번호" 글자 모두 같은 목록 위 팝업을 열고, 아이콘만 새 탭으로 연다',()=>{
  const html=renderToStaticMarkup(<ShipmentConsoleScreen data={{...base,rows:[row]}}/>);
  const popup=`href="/admin/sales/dispatch?tab=ready&amp;page=1&amp;orderId=${row.orderId}"`;
  expect(html.split(popup).length-1).toBe(2);
  expect(html).toContain('aria-label="배송 건 00000001의 주문 상세 팝업 열기"');expect(html).toMatch(/aria-label="주문 00000001 상세 팝업 열기"[^>]*>주문 00000001/);
  expect(html).toMatch(/aria-label="주문 00000001 상세 열기 \(새 탭\)"[^>]*target="_blank"|target="_blank"[^>]*aria-label="주문 00000001 상세 열기 \(새 탭\)"/);
 });
 it('택배가 섞인 발송 대기 목록에서 체크칸 없는 택배 외 행이 있으면 작업 막대에 방법별 필터 링크를 둔다',()=>{
  const quick={...row,id:'60000000-0000-4000-8000-000000000002',delivery:shipmentDeliveryFixture({method:'quick'})};
  const pickup={...row,id:'60000000-0000-4000-8000-000000000003',delivery:shipmentDeliveryFixture()};
  const mixed=renderToStaticMarkup(<ShipmentConsoleScreen data={{...base,rows:[row,quick,pickup]}}/>);
  const bar=mixed.slice(mixed.indexOf('data-sales-workbar'),mixed.indexOf('data-non-parcel-hint')+5000);
  expect(bar).toContain('택배 외 배송 건 2건은 여기서 고를 수 없습니다');
  expect(bar).toContain('href="/admin/sales/dispatch?tab=ready&amp;page=1&amp;method=quick">퀵 1건만 보기');
  expect(bar).toContain('href="/admin/sales/dispatch?tab=ready&amp;page=1&amp;method=pickup">방문수령 1건만 보기');
  /* 택배 행이 없어 처리 막대가 없는 목록도 안내만 담은 막대를 그리고, 출고지시 버튼은 두지 않는다. */
  const only=renderToStaticMarkup(<ShipmentConsoleScreen data={{...base,rows:[pickup]}}/>);
  expect(only).toContain('data-non-parcel-hint=""');expect(only).not.toContain('출고지시 내보내기');
  /* 그 방법만 모아 본 목록·다른 탭에는 안내가 없다. */
  expect(renderToStaticMarkup(<ShipmentConsoleScreen data={{...base,filters:{...base.filters,method:'quick'},rows:[quick]}}/>)).not.toContain('data-non-parcel-hint');
  expect(renderToStaticMarkup(<ShipmentConsoleScreen data={{...base,filters:{...base.filters,tab:'delayed'},rows:[row,quick]}}/>)).not.toContain('data-non-parcel-hint');
 });
});
describe('QA 라운드 1 물류: 1440 화면 열 구성·변경 표시·안내',()=>{
 const header=(html:string)=>html.slice(html.indexOf('<thead'),html.indexOf('</thead>'));
 it('구매자는 수령인 칸 아래 줄에 두고, 발송 상태와 운송장 입력을 한 칸에 모아 열 수를 줄인다',()=>{
  const html=renderToStaticMarkup(<ShipmentConsoleScreen data={{...base,rows:[row]}}/>);
  const heads=[...header(html).matchAll(/<th[^>]*data-slot="table-head"[^>]*>(?:<label[\s\S]*?<\/label>)?([^<]*)/g)].map(match=>match[1]).filter(Boolean);
  expect(heads).toEqual(['배송건번호 / 주문번호','상품 · 옵션','출고지','수령인 / 구매자','주문 / 발주확인','발송 · 운송장','배송 방식']);
  expect(html).toContain('aria-label="구매자 구매자"');
  // 발송 상태 배지와 운송장 입력이 같은 칸이다.
  const cell=html.slice(html.indexOf('내보내기 전'),html.indexOf('data-shipment-row-tracking'));
  expect(cell).not.toContain('</td>');
  // 출고 전용 운영자는 구매자 줄도 머리글도 없다.
  const logistics=renderToStaticMarkup(<ShipmentConsoleScreen canReadOrders={false} data={{...base,rows:[row]}}/>);
  expect(header(logistics)).toContain('>수령인<');expect(logistics).not.toContain('aria-label="구매자 ');
 });
 it('고객이 고른 방식과 다르게 바뀐 배송 건에 변경 표시를 둔다 (m3)',()=>{
  const changed=renderToStaticMarkup(<ShipmentConsoleScreen data={{...base,rows:[{...row,delivery:shipmentDeliveryFixture({method:'quick',customerMethod:'parcel',changedBy:'store'})}]}}/>);
  expect(changed).toContain('data-method-changed=""');expect(changed).toContain('고객 선택 택배에서 변경');
  const chosen=renderToStaticMarkup(<ShipmentConsoleScreen data={{...base,rows:[{...row,delivery:shipmentDeliveryFixture({method:'quick',customerMethod:'quick'})}]}}/>);
  expect(chosen).not.toContain('data-method-changed');
  const legacy=renderToStaticMarkup(<ShipmentConsoleScreen data={{...base,rows:[{...row,delivery:shipmentDeliveryFixture({method:'quick'})}]}}/>);
  expect(legacy).not.toContain('data-method-changed');
 });
 it('출고 전용 운영자의 안내는 열 수 없는 주문 상세 대신 행의 인계·수령 확인을 가리킨다 (m7)',()=>{
  const pickup={...row,delivery:shipmentDeliveryFixture()};
  for(const [surface,tab] of [['dispatch','ready'],['shipping','transit']] as const){
   const logistics=renderToStaticMarkup(<ShipmentConsoleScreen canReadOrders={false} data={{...base,surface,filters:{...base.filters,tab},rows:[row,pickup]}}/>);
   expect(logistics).toContain("행의 &#x27;인계·수령 확인&#x27;에서");expect(logistics).not.toContain('주문 상세에서 확인');expect(logistics).not.toContain('주문 상세에서 수령 확인값');
   const manager=renderToStaticMarkup(<ShipmentConsoleScreen data={{...base,surface,filters:{...base.filters,tab},rows:[row,pickup]}}/>);
   expect(manager).toMatch(/주문 상세에서 (확인|수령 확인값)/);
  }
 });
 it('택배 외 건 필터 안내는 막대 한 줄을 차지하는 본문 크기 글자와 버튼 모양 링크다 (m5)',()=>{
  const quick={...row,id:'60000000-0000-4000-8000-000000000002',delivery:shipmentDeliveryFixture({method:'quick'})};
  const html=renderToStaticMarkup(<ShipmentConsoleScreen data={{...base,rows:[row,quick]}}/>);
  const hint=html.slice(html.indexOf('<span class="flex basis-full'),html.indexOf('퀵 1건만 보기'));
  expect(hint).toContain('text-sm text-foreground');expect(hint).not.toContain('text-xs text-muted-foreground');
  expect(hint).toMatch(/<a[^>]*data-slot="button"[^>]*href="\/admin\/sales\/dispatch\?tab=ready&amp;page=1&amp;method=quick"/);
 });
});
describe('물류 출고 권한 화면 숨김 (T05 통합용 props)',()=>{
 it('판매 관리 권한이 없으면 발주확인·합포장 관리·고객 지연 안내·지연 메모·목록 엑셀을 숨기고 출고·운송장·택배 외 발송처리는 남긴다',()=>{
  const delayed=renderToStaticMarkup(<ShipmentConsoleScreen actorId="actor" canManageSales={false} data={{...base,filters:{...base.filters,tab:'delayed'},rows:[row]}}/>);
  expect(delayed).not.toContain('목록 엑셀 다운로드');expect(delayed).not.toContain('지연 메모');expect(delayed).not.toContain('지연 안내 결과');
  expect(delayed).not.toContain('고객 지연 안내');expect(delayed).not.toContain('합포장 관리');expect(delayed).not.toContain('발송지연 안내여부');
  expect(delayed).toContain('출고지시 내보내기');expect(delayed).toContain('택배 외 발송처리');expect(delayed).toContain('data-shipment-row-tracking=""');
  expect(delayed).toContain('엑셀 일괄 운송장 등록');
  const incoming=renderToStaticMarkup(<ShipmentConsoleScreen canManageSales={false} data={{...base,filters:{...base.filters,tab:'new'},rows:[row]}}/>);
  expect(incoming).not.toContain('발주확인</button>');expect(incoming).not.toContain(`aria-label="배송 건 ${row.id.slice(-8).toUpperCase()} 선택"`);
  const transit=renderToStaticMarkup(<ShipmentConsoleScreen canManageSales={false} data={{...base,surface:'shipping',filters:{...base.filters,tab:'transit'},rows:[{...row,status:'shipping',carrier:'hanjin',trackingNumber:'12345678'}]}}/>);
  expect(transit).toContain('선택 배송완료');expect(transit).not.toContain('목록 엑셀 다운로드');
 });
 it('기본값은 지금 화면 그대로다',()=>{
  const delayed=renderToStaticMarkup(<ShipmentConsoleScreen actorId="actor" data={{...base,filters:{...base.filters,tab:'delayed'},rows:[row]}}/>);
  expect(delayed).toContain('목록 엑셀 다운로드');expect(delayed).toContain('지연 메모');expect(delayed).toContain('고객 지연 안내');expect(delayed).toContain('합포장 관리');
 });
 /* 택배 외 실물 배송의 인계·수령은 출고 전용 운영자도 이 화면의 팝업에서 기록한다(1014-084, 오케스트레이터 판단 — 발송·배송완료를 택배로 좁히지 않음). */
 it('주문 열람 권한이 없으면 번호·제작 현황을 글자로 두고 상세 팝업·새 탭 링크를 만들지 않으며, 택배 외 인계·수령은 이 화면의 팝업으로 기록한다',()=>{
  const html=renderToStaticMarkup(<ShipmentConsoleScreen canReadOrders={false} data={{...base,rows:[row,{...row,id:'60000000-0000-4000-8000-000000000002',delivery:shipmentDeliveryFixture()},
   {...row,id:'60000000-0000-4000-8000-000000000003',production:{count:1,completed:0,ready:false,dueAt:null}},
   {...row,id:'60000000-0000-4000-8000-000000000004',delivery:shipmentDeliveryFixture({method:'digital'})}]}}/>);
  expect(html).not.toContain('data-order-preview-link');expect(html).not.toContain('상세 열기 (새 탭)');expect(html).not.toContain('/admin/sales/orders/');
  expect(html).toMatch(/aria-haspopup="dialog"[^>]*>방문수령 인계·수령 확인<\/button>/);expect(html).toContain('주문제작 0/1건 완료');
  expect(html).toContain('디지털 파일 제공 이력은 주문 상세에서 합니다.');
 });

});
describe('배송현황 추가 운송장·택배 추적 표시 (QNA-019·QNA-028)',()=>{
  const shipped={...row,status:'shipping' as const,carrier:'hanjin',trackingNumber:'123456789012',shippedAt:'2026-11-10T00:00:00Z',delivery:{method:'parcel' as const,providerName:null,canIssueReceipt:false,policy:null}};
  const delivered={...shipped,id:'60000000-0000-4000-8000-000000000002',status:'delivered' as const,deliveredAt:'2026-11-11T00:00:00Z'};
  const extra={id:'00000000-0000-4000-8000-0000000000e1',carrier:'hanjin',trackingNumber:'223456789012',source:'warehouse_reply' as const,createdAt:'2026-11-10T01:00:00Z'};
  const shipping=(rows:ShipmentConsoleData['rows'],autoDelivery?:boolean,tab:'transit'|'delivered'='transit')=>renderToStaticMarkup(<ShipmentConsoleScreen now={new Date('2026-11-12T00:00:00Z')}
   data={{...base,surface:'shipping',filters:{...base.filters,tab},rows,...(autoDelivery===undefined?{}:{autoDelivery})}}/>);
  const TRACKING_COPY=['자동 확인','수동 처리','택배 추적','자동 배송완료 보류','도착 '];
  it('추가 운송장은 조회 링크로 대표 운송장 아래에 보이고 관리 팝업 입구가 생긴다',()=>{
   const html=shipping([{...shipped,trackingSummary:{extraTrackings:[extra],deliveredBy:null,tracking:null}}],false);
   expect(html).toMatch(/href="https:\/\/example.test\/223456789012"[^>]*>추가 한진택배 223456789012<\/a>/);
   expect(html).toMatch(/aria-haspopup="dialog"[^>]*>추가 운송장 1개 관리<\/button>/);
   expect(shipping([{...shipped,trackingSummary:{extraTrackings:[],deliveredBy:null,tracking:null}}],false)).toMatch(/>추가 운송장 더하기<\/button>/);
  });
  it('스위치가 꺼져 있으면 자동·수동 구분과 추적 진행을 하나도 그리지 않는다',()=>{
   const off=shipping([{...shipped,trackingSummary:{extraTrackings:[],deliveredBy:null,tracking:null}},{...delivered,trackingSummary:{extraTrackings:[],deliveredBy:null,tracking:null}}],false);
   for(const copy of TRACKING_COPY)expect(off).not.toContain(copy);
   // 추적 표시는 스위치를 따른다 — 값이 실려 와도 꺼져 있으면 그리지 않는다.
   const leaked=shipping([{...shipped,trackingSummary:{extraTrackings:[],deliveredBy:'manual',tracking:{total:1,delivered:0,latestStatus:'in_transit',latestAt:null,held:true}}}],false);
   expect(leaked).toBe(shipping([{...shipped,trackingSummary:{extraTrackings:[],deliveredBy:null,tracking:null}}],false));
   // 추가 운송장 요약이 없던 행(발주·발송 목록·옛 응답)은 이 칸이 종전 그대로다(일괄 등록 안내의 서원 회신 설명은 행 밖이다).
   const plain=shipping([shipped]).replace(/<section[^>]*aria-label="엑셀 일괄 운송장 등록"[\s\S]*?<\/section>/,'');
   for(const copy of [...TRACKING_COPY,'추가 운송장'])expect(plain).not.toContain(copy);
  });
  it('켜져 있으면 배송완료 건에 자동 확인·수동 처리를, 배송 중 건에 추적 진행과 보류를 보인다',()=>{
   const transit=shipping([{...shipped,trackingSummary:{extraTrackings:[extra],deliveredBy:null,tracking:{total:2,delivered:1,latestStatus:'out_for_delivery',latestAt:'2026-11-11T03:00:00Z',held:true}}}],true);
   expect(transit).toContain('택배 추적 배송 출발 · 도착 1/2');expect(transit).toContain('자동 배송완료 보류');expect(transit).toContain('택배 추적이 켜져 있습니다');
   const done=shipping([{...delivered,trackingSummary:{extraTrackings:[],deliveredBy:'tracking',tracking:null}},{...delivered,id:'60000000-0000-4000-8000-000000000003',trackingSummary:{extraTrackings:[],deliveredBy:'manual',tracking:null}}],true,'delivered');
   expect(done).toContain('자동 확인 · 택배 추적');expect(done).toContain('수동 처리');
  });
});
