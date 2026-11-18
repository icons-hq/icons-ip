import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock('@/app/admin/shipment-tracking-actions', () => ({ swapShipmentTrackingAction: vi.fn() }));
import { ShipmentTrackingSwapForm } from './ShipmentTrackingSwapForm';

describe('뒤바뀐 운송장 맞바꾸기 양식 (SHP-031)', () => {
  it('상대 배송건번호·상대의 지금 운송장·사유를 받고, 한쪽만 틀린 경우는 운송장 수정으로 안내한다', () => {
    const html = renderToStaticMarkup(<ShipmentTrackingSwapForm shipmentId="s" reference="2026111830000001" trackingNumber="100000000001" />);
    expect(html).toContain('aria-label="배송 건 2026111830000001 운송장 맞바꾸기"');
    expect(html).toContain('상대 배송건번호');
    expect(html).toContain('상대 배송 건의 지금 운송장번호');
    expect(html).toContain('한쪽만 틀렸으면 위의 운송장 수정을 씁니다.');
    expect(html).toMatch(/<button[^>]*type="submit"[^>]*>운송장 맞바꾸기<\/button>/);
  });
});
