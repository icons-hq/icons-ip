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
  expect((missing.match(/구매자만 확인/g)??[])).toHaveLength(1);
 });
 it('원본 안내여부 필터를 실제 채널 결과로 구분하고 검색 폼의 중복 hidden 값을 만들지 않는다',()=>{
  const notice={status:'partial_failed' as const,noticeId:'11111111-1111-4111-8111-111111111111',requestedAt:'2026-10-13T10:00:00Z',inAppStatus:'sent' as const,emailStatus:'failed' as const,emailProviderState:'bounced'};
  const html=renderToStaticMarkup(<ShipmentConsoleScreen data={{...base,filters:{...base.filters,delayNotice:'partial_failed'},rows:[{...row,delayNotice:notice}]}}/>);
  expect(html).toContain('발송지연 안내여부');expect(html).toContain('지연 안내 결과');expect(html).toContain('앱 발송 · 이메일 실패');
  expect(html).toContain('<option value="partial_failed" selected="">일부 채널 실패·제외</option>');
  expect(html).toContain('delayNotice=partial_failed');expect(html).toContain('고객의 수신·열람을 뜻하지 않습니다');
  const searchForm=html.slice(html.indexOf('class="admin-sales-filters"'),html.indexOf('</form>'));
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
 it('운송장 가져오기는 목록과 분리된 접힌 작업으로 열고 닫아도 입력 상태를 보존한다',()=>{
  const html=renderToStaticMarkup(<ShipmentConsoleScreen data={{...base,rows:[row]}}/>);
  expect(html).toContain('<details class="admin-shipment-import-disclosure">');
  expect(html).toContain('<summary>운송장 가져오기 · 창고 회신 등록</summary>');
  expect(html).not.toContain('<details open="">');
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
