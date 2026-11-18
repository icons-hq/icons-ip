import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock('@/app/admin/shipment-tracking-actions', () => ({ registerDuplicateShipmentTrackingAction: vi.fn() }));
import { ShipmentTrackingDuplicateForm } from './ShipmentTrackingDuplicateForm';

const carriers = [{ code: 'hanjin', label: '한진택배' }, { code: 'epost', label: '우체국택배' }];

describe('중복 확인 후 운송장 등록 양식 (SHP-030)', () => {
  it('발송 대기 행에서 거절된 번호는 고정하고 사유만 받는다', () => {
    const html = renderToStaticMarkup(<ShipmentTrackingDuplicateForm compact shipmentId="s" reference="2026111830000001" carriers={carriers}
      fixed={{ carrier: 'hanjin', trackingNumber: '100000000001' }} />);
    expect(html).toContain('aria-label="배송 건 2026111830000001 중복 확인 후 운송장 등록"');
    expect(html).toContain('한진택배 100000000001은(는) 다른 주문이 쓰는 번호입니다');
    expect(html).not.toContain('택배사 선택');
    expect(html).toContain('같은 상자로 확인한 사유');
    expect(html).toMatch(/<button[^>]*type="submit"[^>]*>중복 확인 후 등록<\/button>/);
  });
  it('주문 상세에서는 택배사·운송장번호를 함께 받는다', () => {
    const html = renderToStaticMarkup(<ShipmentTrackingDuplicateForm shipmentId="s" reference="r" carriers={carriers} defaultCarrier="epost" />);
    expect(html).toContain('<option value="epost" selected="">우체국택배</option>');
    expect(html).toContain('창고에 같은 상자로 확인한 경우에만 씁니다');
  });
});
