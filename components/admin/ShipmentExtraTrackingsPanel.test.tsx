import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock('@/app/admin/shipment-tracking-actions', () => ({ addShipmentExtraTrackingAction: vi.fn(), removeShipmentExtraTrackingAction: vi.fn() }));
import { ShipmentExtraTrackingsButton, ShipmentExtraTrackingsPanel } from './ShipmentExtraTrackingsPanel';
import { SHIPMENT_EXTRA_TRACKING_LIMIT } from '@/lib/admin/shipment-tracking';

const carriers = [
  { code: 'hanjin', label: '한진택배', active: true, trackingUrlTemplate: 'https://example.test/{trackingNumber}' },
  { code: 'epost', label: '우체국택배', active: true, trackingUrlTemplate: 'https://post.example.test/{trackingNumber}' },
  { code: 'retired', label: '계약 종료 택배', active: false, trackingUrlTemplate: 'https://old.example.test/{trackingNumber}' },
];
const extra = (n: number, carrier = 'epost') => ({ id: `00000000-0000-4000-8000-0000000000${String(n).padStart(2, '0')}`, carrier, trackingNumber: `XT1000000${n}` });

describe('배송 건 추가 운송장 패널 (QNA-019)', () => {
  it('붙은 추가 운송장을 조회 링크와 지우기 버튼으로 보이고, 사용 중 택배사만 골라 더하게 한다', () => {
    const html = renderToStaticMarkup(<ShipmentExtraTrackingsPanel shipmentId="s" reference="2026111230000001" carriers={carriers} defaultCarrier="epost" extras={[extra(1), extra(2, 'retired')]} />);
    expect(html).toMatch(/href="https:\/\/post\.example\.test\/XT10000001"[^>]*>우체국택배 XT10000001<\/a>/);
    // 계약이 끝난 택배사의 번호도 지난 배송 조회 링크를 지우지 않는다.
    expect(html).toMatch(/href="https:\/\/old\.example\.test\/XT10000002"[^>]*>계약 종료 택배 XT10000002<\/a>/);
    expect(html).toContain('aria-label="추가 운송장 우체국택배 XT10000001 지우기"');
    expect(html).toContain('<option value="epost" selected="">우체국택배</option>');
    expect(html).not.toContain('value="retired"');
    expect(html).toContain('추가 운송장 저장');
    expect(html).toContain('고객 주문 상세에 대표 운송장과 함께 보이고');
  });
  it('추가 운송장이 없으면 빈 안내와 더하기 양식만, 상한에 이르면 양식 대신 안내를 보인다', () => {
    expect(renderToStaticMarkup(<ShipmentExtraTrackingsPanel shipmentId="s" reference="r" carriers={carriers} extras={[]} />)).toContain('붙은 추가 운송장이 없습니다.');
    const full = renderToStaticMarkup(<ShipmentExtraTrackingsPanel shipmentId="s" reference="r" carriers={carriers}
      extras={Array.from({ length: SHIPMENT_EXTRA_TRACKING_LIMIT }, (_, index) => extra(index + 1))} />);
    expect(full).not.toContain('추가 운송장 저장');
    expect(full).toContain(`${SHIPMENT_EXTRA_TRACKING_LIMIT}개까지`);
  });
  it('목록 입구 버튼은 개수를 이름에 싣고 팝업은 누를 때만 연다', () => {
    const html = renderToStaticMarkup(<ShipmentExtraTrackingsButton shipmentId="s" reference="2026111230000001" carriers={carriers} extras={[extra(1)]} />);
    expect(html).toMatch(/aria-haspopup="dialog"[^>]*aria-label="배송 건 2026111230000001 추가 운송장 1개 관리"[^>]*>추가 운송장 1개 관리<\/button>/);
    expect(html).not.toContain('<dialog');
  });
});
