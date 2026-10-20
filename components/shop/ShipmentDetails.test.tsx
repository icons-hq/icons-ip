import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { ShipmentDetails } from './ShipmentDetails';
import { shipmentFixture } from '@/lib/orders/shipments.fixture';
import { shipmentDeliveryFixture } from '@/lib/shipment-delivery.fixture';
vi.mock('@/app/shipments/receipt-actions', () => ({ issueShipmentReceiptConfirmationAction: vi.fn() }));

describe('non-parcel customer shipment display', () => {
  it('shows the frozen pickup instructions and owner confirmation without fabricated tracking', () => {
    const shipment = shipmentFixture({ status: 'ready', carrier: null, carrierLabel: null, trackingNumber: null, trackingUrl: null,
      delivery: shipmentDeliveryFixture(), originalExpectedShipDate: '2026-09-20', expectedShipDate: '2026-09-25' });
    const html = renderToStaticMarkup(<ShipmentDetails shipments={[shipment]} />);
    for (const value of ['방문수령 준비', '합성 수령 장소', '합성 인계 담당', '일회 수령 확인값 발급', '10분', '5회', '주문 당시 배송비를 유지', '주문 당시 발송 예정일', '변경된 발송 예정일']) expect(html).toContain(value);
    expect(html).not.toContain('운송장번호'); expect(html).not.toContain('배송조회');
  });
  it('never renders a customer receipt-code button in the admin view or after receipt', () => {
    const shipment = shipmentFixture({ delivery: shipmentDeliveryFixture() });
    expect(renderToStaticMarkup(<ShipmentDetails admin shipments={[shipment]} />)).not.toContain('일회 수령 확인값 발급');
    const completed = shipmentFixture({ status: 'delivered', delivery: shipmentDeliveryFixture({ canIssueReceipt: false }) });
    const html = renderToStaticMarkup(<ShipmentDetails shipments={[completed]} />);
    expect(html).toContain('방문수령 완료'); expect(html).not.toContain('일회 수령 확인값 발급');
  });
  it('does not turn a malformed method response into a parcel tracking action', () => {
    const html = renderToStaticMarkup(<ShipmentDetails shipments={[shipmentFixture({ delivery: null })]} />);
    expect(html).toContain('확인 필요'); expect(html).not.toContain('운송장번호'); expect(html).not.toContain('배송조회');
  });
  it('labels charge-group members with the names saved on order items', () => {
    const shipment = shipmentFixture({ chargeDetails: { version: 1, unassignedBaseFee: 0, originRegionalFee: 0, originRegionFeeUnit: null,
      groups: [{ groupId: '00000000-0000-4000-8000-000000000001', revision: 1, mode: 'min', quantity: 2, subtotal: 20000,
        baseFee: 3000, regionalFee: 0, regionMode: 'inherit', goodIds: ['keyring', 'doll'] }] } });
    const html = renderToStaticMarkup(<ShipmentDetails shipments={[shipment]} items={[
      { id: 'line-1', goodId: 'keyring', name: '주문 당시 키링', qty: 1 }, { id: 'line-2', goodId: 'doll', name: '주문 당시 인형', qty: 1 },
    ]} />);
    expect(html).toContain('주문 당시 키링 · 주문 당시 인형');
    expect(html).not.toContain('굿즈 1');
  });
});
