import { shipmentDeliveryFixture } from '@/lib/shipment-delivery.fixture';
import { shipmentFixture } from '@/lib/orders/shipments.fixture';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { AdminOrderDetail } from '@/lib/admin/order-detail';
import { OrderDetailScreen } from './OrderDetailScreen';
vi.mock('react', async () => {
  const actual = await vi.importActual<typeof import('react')>('react');
  return { ...actual, useActionState: (_action: unknown, initial: unknown) => [initial, vi.fn(), false] };
});
vi.mock('@/app/admin/order-note-actions', () => ({ addOrderNoteAction: vi.fn() }));
const ORDER = '10000000-0000-4000-8000-000000004141';
const detail: AdminOrderDetail = {
  emailJobs: [],
  order: { id: ORDER, userId: 'buyer', buyerName: '주문자', buyerEmail: 'buyer@example.test',
    status: 'shipping', total: 12800, shippingFee: 3000, discountTotal: 200, storeCreditTotal: 0,
    createdAt: '2026-09-01T00:00:00Z',
    address: { recipientName: '수령자', phone: '01012345678', postalCode: '12345', address1: '서울시', address2: '101호' } },
  shipments: [shipmentFixture()],
  items: [{ variantId: '00000000-0000-4000-8000-000000000001', id: 'item', name: '주문 당시 상품명', type: '아크릴', qty: 2, unitPrice: 5000 }],
  timeline: [
    { id: 'one', source: 'payment', occurredAt: '2026-09-01T01:00:00Z', action: 'recorded', amount: 12800, status: 'paid', provider: 'korpay' },
    { id: 'two', source: 'status', occurredAt: '2026-09-01T02:00:00Z', action: 'admin.order.status_updated', fromStatus: 'paid', toStatus: 'confirmed', actorName: '수민' },
    { id: 'three', source: 'inquiry', occurredAt: '2026-09-01T03:00:00Z', action: 'created', title: '배송 확인', relatedId: '40000000-0000-4000-8000-000000004141', status: 'open' },
    { id: 'four', source: 'note', occurredAt: '2026-09-01T04:00:00Z', action: 'admin.order.note', body: '물류팀 확인 필요', actorName: '지우' },
  ],
};
describe('주문 상세', () => {
  it('디지털 주문은 실제 제공 기록과 주소 불필요 상태를 표시하고 택배 발송 이력으로 오인시키지 않는다', () => {
    const shipment=shipmentFixture({delivery:shipmentDeliveryFixture({method:'digital'}),status:'delivered'});
    const at='2026-10-16T00:00:00Z';
    const html=renderToStaticMarkup(<OrderDetailScreen detail={{...detail,shipments:[shipment],timeline:[
      {id:'sent',source:'shipment',action:'shipped',occurredAt:at,shipmentId:shipment.id},
      {id:'provided',source:'shipment',action:'delivered',occurredAt:at,shipmentId:shipment.id},
    ]}} downloads={{orderId:ORDER,items:[{itemId:'10000000-0000-4000-8000-000000000001',name:'구매 당시 디지털 상품',files:[
      {id:'10000000-0000-4000-8000-000000000002',name:'original.txt',mimeType:'text/plain',size:35,providedCount:2,firstProvidedAt:at,lastProvidedAt:at},
    ]}]}} noteOperationId="operation"/>);
    for(const value of ['디지털 파일 제공 기록','구매 당시 디지털 상품','original.txt','35 B','2회','파일 제공 시작','전송 완료나 고객의 열람을 의미하지 않습니다','배송 주소가 필요하지 않은']) expect(html).toContain(value);
    expect(html).not.toContain('상품 발송');expect(html).not.toContain('다운로드</button>');
  });
  it('할인 주문은 품목별 쿠폰·적립금 배분과 배분 후 금액을 보여주고, 나눌 수 없으면 그렇다고 적는다', () => {
    const allocated = renderToStaticMarkup(<OrderDetailScreen detail={{ ...detail, itemAllocations: { item: { source: 'legacy', volumeDiscount: 0, couponDiscount: 200, storeCreditDiscount: 0, paidGoodsTotal: 9800 } } }} noteOperationId="operation" />);
    expect(allocated).toContain('쿠폰 −200원 · 적립금 −0원');
    expect(allocated).toContain('배분 후 9,800원 · 배송비 제외');
    expect(renderToStaticMarkup(<OrderDetailScreen detail={detail} noteOperationId="operation" />)).toContain('주문 당시 기록이 없어 나누지 않았습니다');
    const plain = renderToStaticMarkup(<OrderDetailScreen detail={{ ...detail, order: { ...detail.order, discountTotal: 0 } }} noteOperationId="operation" />);
    expect(plain).not.toContain('배분 후');
  });
  it('배송완료 주문에서 별도 대리 접수 진입점을 제공한다', () => {
    const html = renderToStaticMarkup(<OrderDetailScreen detail={{ ...detail, order: { ...detail.order, status: 'delivered' } }} noteOperationId="operation" />);
    expect(html).toContain('판매자 직접 반품·교환 접수');
    expect(renderToStaticMarkup(<OrderDetailScreen detail={detail} noteOperationId="operation" />)).toContain('판매자 직접 반품·교환 접수');
  });
  it('주문 당시 상품·정확한 금액·배송 정보와 출처별 시간순 이력을 보여준다', () => {
    const html = renderToStaticMarkup(<OrderDetailScreen detail={detail} noteOperationId="operation" />);
    for (const value of ['주문 당시 상품명', '12,800원', '수령자', '101호', '결제', '상태 변경', '신규주문', '발주확인', '수민', '지우', '운영자 메모', '물류팀 확인 필요']) expect(html).toContain(value);
    expect(html.indexOf('2026-09-01T01')).toBeGreaterThan(-1);
    expect(html.indexOf('2026-09-01T01')).toBeLessThan(html.indexOf('2026-09-01T04'));
    expect(html).toContain('/admin/cs/inquiries/40000000-0000-4000-8000-000000004141');
    expect(html).toContain('/admin/customers/buyer');
    expect(html).toContain('href="/admin/sales/orders"');
    expect(html).toContain(`query=${ORDER}&amp;order=${ORDER}`);
    expect(html).not.toContain('admin.order.status_updated');
    expect(html).toContain('배송 방식·인계 확인');
 });

 it('상세에서 목록으로 돌아갈 때 전달받은 필터와 선택 주문을 유지한다', () => {
  const html = renderToStaticMarkup(<OrderDetailScreen
    backHref={`/admin/sales/orders?status=done&page=2&order=${ORDER}`}
    backLabel="주문 목록"
    detail={detail}
    noteOperationId="operation"
  />);
  expect(html).toContain(`href="/admin/sales/orders?status=done&amp;page=2&amp;order=${ORDER}"`);
 });
});

 it('아직 메일 원장이 생기기 전 큐의 대기·확인 필요 상태를 배송건별로 보여준다',()=>{
  const html=renderToStaticMarkup(<OrderDetailScreen detail={{...detail,emailJobs:[{shipmentId:detail.shipments[0].id,status:'review',attempts:2,lastErrorCode:'provider_network_error',updatedAt:'2026-09-08T00:00:00Z'}]}} noteOperationId="operation" />);
  expect(html).toContain('배송 메일 처리 상태');expect(html).toContain('운영자 확인 필요');expect(html).toContain('provider_network_error');expect(html).toContain('시도 2회');
 });

it('query-only detail does not mount any shipment or claim operation, note, or global customer link', () => {
  const html = renderToStaticMarkup(<OrderDetailScreen detail={{ ...detail, order: { ...detail.order, status: 'delivered' } }} canManage={false} canViewCustomer={false} noteOperationId="operation" />);
  expect(html).toContain('주문 당시 상품명');
  for (const text of ['판매자 직접 반품·교환 접수', '배송 방식·인계 확인', '고객 상세 열기', '>주문 처리<', 'name="body"']) expect(html).not.toContain(text);
});
