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
    status: 'shipping', total: 12800, shippingFee: 3000, discountTotal: 200,
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
  it('주문 당시 상품·정확한 금액·배송 정보와 출처별 시간순 이력을 보여준다', () => {
    const html = renderToStaticMarkup(<OrderDetailScreen detail={detail} noteOperationId="operation" />);
    for (const value of ['주문 당시 상품명', '12,800원', '수령자', '101호', '결제', '상태 변경', '신규주문', '발주확인', '수민', '지우', '운영자 메모', '물류팀 확인 필요']) expect(html).toContain(value);
    expect(html.indexOf('2026-09-01T01')).toBeGreaterThan(-1);
    expect(html.indexOf('2026-09-01T01')).toBeLessThan(html.indexOf('2026-09-01T04'));
    expect(html).toContain('/admin/cs/inquiries/40000000-0000-4000-8000-000000004141');
    expect(html).toContain('/admin/customers/buyer');
    expect(html).toContain(`query=${ORDER}&amp;order=${ORDER}`);
    expect(html).not.toContain('admin.order.status_updated');
  });
});

 it('아직 메일 원장이 생기기 전 큐의 대기·확인 필요 상태를 배송건별로 보여준다',()=>{
  const html=renderToStaticMarkup(<OrderDetailScreen detail={{...detail,emailJobs:[{shipmentId:detail.shipments[0].id,status:'review',attempts:2,lastErrorCode:'provider_network_error',updatedAt:'2026-09-08T00:00:00Z'}]}} noteOperationId="operation" />);
  expect(html).toContain('배송 메일 처리 상태');expect(html).toContain('운영자 확인 필요');expect(html).toContain('provider_network_error');expect(html).toContain('시도 2회');
 });
