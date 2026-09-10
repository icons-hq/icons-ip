import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { ShippingRegionsScreen } from './ShippingRegionsScreen';
vi.mock('@/app/admin/shipping-region-actions', () => ({ saveShippingRegionPolicyAction: vi.fn(), setShippingRegionPolicyStatusAction: vi.fn() }));
const origin = { id: '00000000-0000-4000-8000-000000000001', code: 'fixture', name: '합성 출고지', defaultCarrier: 'hanjin',
  baseFee: 3000, freeThreshold: null, returnAddress: '', cutoff: null, exportTemplate: 'standard' as const, active: true, updatedAt: '2026-09-10T00:00:00Z' };
describe('지역 추가 배송비 운영 화면', () => {
  it('실제 지역·금액 없이 공란 초안을 제공하고 미등록 상태를 구별한다', () => {
    const html = renderToStaticMarkup(<ShippingRegionsScreen policies={[]} adoptions={[]} origins={[origin]} carriers={[]} canEdit />);
    for (const label of ['지역표 미등록', '기존 배송비로 주문 확정', '물류사 원본 회신', '무료 기준 금액', '초안 저장', '지역표·고객 안내 미리보기']) expect(html).toContain(label);
    expect(html).not.toContain('>저장된 정책 활성화</button>');
    expect(html).not.toContain('TEST-ONLY');
  });
  it('staff 조회 화면에는 생성·저장 입력을 제공하지 않는다', () => {
    const html = renderToStaticMarkup(<ShippingRegionsScreen policies={[]} adoptions={[]} origins={[origin]} carriers={[]} canEdit={false} />);
    expect(html).toContain('지역표 미등록');
    expect(html).not.toContain('초안 저장'); expect(html).not.toContain('<textarea');
  });
});
