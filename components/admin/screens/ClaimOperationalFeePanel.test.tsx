import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { ClaimOperationalFeePanel } from './ClaimOperationalFeePanel';

vi.mock('@/app/admin/claim-actions', () => ({ recordOrderClaimOperationalFeeAction: vi.fn() }));

describe('클레임 운영 확인액 패널', () => {
  it('0원과 미확인을 구분하고 자동 청구·환불을 약속하지 않는다', () => {
    const html = renderToStaticMarkup(<ClaimOperationalFeePanel
      claimId="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
      claimType="return"
      fee={{ kind: 'return_shipping', amount: 0, note: '무료 확인', evidence: '택배 회신', confirmedBy: 'staff', confirmedAt: '2026-09-10T00:00:00Z', updatedAt: '2026-09-10T00:00:00Z' }}
    />);
    expect(html).toContain('value="0"');
    expect(html).toContain('0원은 확인된 무료 비용으로 구분됩니다.');
    expect(html).toContain('추가 청구하거나 환불액에서 차감하지 않으며');
    expect(html).toContain('운영 확인액 갱신');
  });
});
