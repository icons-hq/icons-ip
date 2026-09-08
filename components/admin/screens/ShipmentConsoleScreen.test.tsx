import {renderToStaticMarkup} from 'react-dom/server';
import {describe,expect,it,vi} from 'vitest';
import {ShipmentConsoleScreen} from './ShipmentConsoleScreen';
import type {ShipmentConsoleData} from '@/lib/admin/shipment-dispatch';
vi.mock('next/navigation',()=>({useRouter:()=>({refresh:vi.fn()}),usePathname:()=>'/admin/sales/dispatch'}));
vi.mock('@/app/admin/order-actions',()=>({bulkConfirmAdminOrdersAction:vi.fn(),bulkRegisterAdminOrderTrackingAction:vi.fn(),saveAdminOrderDispatchDelayAction:vi.fn()}));
vi.mock('@/app/admin/shipment-actions',()=>({completeShipmentsAction:vi.fn(),exportShipmentsAction:vi.fn()}));
const base:ShipmentConsoleData={surface:'dispatch',filters:{tab:'ready',originId:null,query:'',from:null,to:null,page:1},rows:[],total:2,pageSize:100,counts:{new:0,ready:2,delayed:0,transit:0,delivered:0},carriers:[{code:'hanjin',label:'한진택배',active:true,trackingUrlTemplate:'https://example.test/{trackingNumber}'}],origins:[{id:'one',name:'김포'},{id:'two',name:'남양주'}]};
const row={id:'60000000-0000-4000-8000-000000000001',orderId:'50000000-0000-4000-8000-000000000001',originId:'one',originName:'김포',status:'ready' as const,createdAt:'2026-09-08T00:00:00Z',confirmedAt:'2026-09-08T01:00:00Z',buyerName:'구매자',recipientName:'받는 분',total:30000,paymentMethod:'card',shippingFee:3000,carrier:null,trackingNumber:null,shippedAt:null,deliveredAt:null,exportedAt:null,updatedAt:'2026-09-08T00:00:00Z',delayReason:null,expectedShipDate:null,items:[{id:'item-1',name:'상품',variantName:'파랑',qty:2}]};
describe('배송 건 콘솔',()=>{
 it('같은 주문의 두 출고지를 별도 행으로 표시하고 발송은 업로드 한 곳으로 모은다',()=>{
  const html=renderToStaticMarkup(<ShipmentConsoleScreen data={{...base,rows:[row,{...row,id:'60000000-0000-4000-8000-000000000002',originName:'남양주',originId:'two',exportedAt:'2026-09-08T01:10:00Z'}]}}/>);
  expect(html).toContain('김포');expect(html).toContain('남양주');expect(html).toContain('상품 · 파랑');
  expect(html).toContain('출고지시 내보내기');expect(html).toContain('출고지시 전달');expect(html).toContain('1,000');
  expect(html).not.toContain('선택→발송');expect(html).not.toContain('name="status" value="shipping"');
  expect(html).toContain('name="originId"');expect(html).toContain('/admin/sales/orders/50000000');
 });
 it('배송완료는 배송 건 선택으로 처리하고 개별 운송장 링크를 보여준다',()=>{
  const html=renderToStaticMarkup(<ShipmentConsoleScreen data={{...base,surface:'shipping',filters:{...base.filters,tab:'transit'},rows:[{...row,status:'shipping',carrier:'hanjin',trackingNumber:'12345678',shippedAt:'2026-09-08T02:00:00Z'}]}}/>);
  expect(html).toContain('선택 배송완료');expect(html).toContain('https://example.test/12345678');expect(html).not.toContain('엑셀 일괄 운송장 등록');
 });
});
