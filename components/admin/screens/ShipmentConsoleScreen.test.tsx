import {renderToStaticMarkup} from 'react-dom/server';
import {describe,expect,it,vi} from 'vitest';
import {ShipmentConsoleScreen} from './ShipmentConsoleScreen';
import type {ShipmentConsoleData} from '@/lib/admin/shipment-dispatch';
import {shipmentDeliveryFixture} from '@/lib/shipment-delivery.fixture';
vi.mock('next/navigation',()=>({useRouter:()=>({refresh:vi.fn()}),usePathname:()=>'/admin/sales/dispatch'}));
vi.mock('@/app/admin/order-actions',()=>({bulkConfirmAdminOrdersAction:vi.fn(),bulkRegisterAdminOrderTrackingAction:vi.fn(),saveAdminOrderDispatchDelayAction:vi.fn()}));
vi.mock('@/app/admin/shipment-actions',()=>({completeShipmentsAction:vi.fn(),exportShipmentsAction:vi.fn(),exportPendingOriginShipmentsAction:vi.fn()}));
const base:ShipmentConsoleData={surface:'dispatch',filters:{tab:'ready',originId:null,query:'',from:null,to:null,page:1},rows:[],total:2,pageSize:100,counts:{new:0,ready:2,delayed:0,transit:0,delivered:0},carriers:[{code:'hanjin',label:'한진택배',active:true,trackingUrlTemplate:'https://example.test/{trackingNumber}'}],origins:[{id:'one',name:'김포',template:'wms_csv',active:true},{id:'two',name:'남양주',template:'seowon_xlsx',active:true},{id:'three',name:'중지된 창고',template:'standard',active:false}]};
const row={id:'60000000-0000-4000-8000-000000000001',orderId:'50000000-0000-4000-8000-000000000001',originId:'one',originName:'김포',status:'ready' as const,createdAt:'2026-09-08T00:00:00Z',confirmedAt:'2026-09-08T01:00:00Z',buyerName:'구매자',recipientName:'받는 분',total:30000,paymentMethod:'card',shippingFee:3000,carrier:null,trackingNumber:null,shippedAt:null,deliveredAt:null,exportedAt:null,updatedAt:'2026-09-08T00:00:00Z',delayReason:null,expectedShipDate:null,items:[{id:'item-1',name:'상품',variantName:'파랑',qty:2}]};
describe('배송 건 콘솔',()=>{
 it('지원하는 모든 배송방법을 검색하고 다운로드 방식은 파일 제공 이력으로 연결한다',()=>{
  const html=renderToStaticMarkup(<ShipmentConsoleScreen data={{...base,rows:[{...row,delivery:shipmentDeliveryFixture({method:'digital'})}]}}/>);
  for(const method of ['parcel','quick','pickup','direct','freight','none','digital']) expect(html).toContain(`value="${method}"`);
  expect(html).toContain('디지털 파일 제공 이력');expect(html).not.toContain('디지털 파일 다운로드 인계·수령 확인');
 });
 it.each(['dispatch','shipping'] as const)('구매자와 수취인을 각각 기본 열로 보여준다: %s',surface=>{
  const html=renderToStaticMarkup(<ShipmentConsoleScreen data={{...base,surface,filters:{...base.filters,tab:surface==='dispatch'?'ready':'delivered'},
   rows:[{...row,buyerName:'서로 다른 구매자',recipientName:'별도 수취인'}]}}/>);
  expect(html).toContain('구매자명');expect(html).toContain('서로 다른 구매자');expect(html).toContain('별도 수취인');
  expect(html).toContain('조회항목 설정');
  const missing=renderToStaticMarkup(<ShipmentConsoleScreen data={{...base,surface,filters:{...base.filters,tab:surface==='dispatch'?'ready':'delivered'},
   rows:[{...row,buyerName:'구매자만 확인',recipientName:null}]}}/>);
  expect(missing).toContain('미기록');
  /* 수취인 칸이 구매자명으로 채워지지 않는다. 긴 이름을 자르는 title에도 같은 값이 있으므로 보이는 글자 칸만 센다. */
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
 it('긴 구매자·수취인 이름은 한 줄로 자르고 전체 값을 title에 둔다',()=>{
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
