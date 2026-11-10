import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
vi.mock('@/app/my/coupons/actions', () => ({ claimCouponCodeAction: vi.fn() }));
import { MarketingMessageContent } from './MarketingMessageContent';
const content = { template: 'text' as const, title: '첨부 테스트', body: '본문', imagePath: null, goodIds: [], buttons: [], couponCode: 'TEST-1000' };
const coupon = { code: 'TEST-1000', name: '테스트 쿠폰', discountType: 'fixed' as const, discountValue: 1000, maxDiscountAmount: null, minSubtotal: 10000,
  startsAt: '2026-10-16T01:00:00Z', endsAt: null, validDays: 7, issueStartsAt: '2026-10-16T01:00:00Z', issueEndsAt: null, available: true };
describe('첨부 쿠폰 표시', () => {
  it('실제 발급과 미리보기 버튼을 구분하고 현재 정보가 없으면 발급을 막는다', () => {
    const preview = renderToStaticMarkup(<MarketingMessageContent content={content} coupon={coupon} preview />);
    expect(preview).toContain('1,000원 할인'); expect(preview).toContain('쿠폰 받기 (미리보기)'); expect(preview).toContain('disabled=""');
    const actual = renderToStaticMarkup(<MarketingMessageContent content={content} coupon={coupon} />);
    expect(actual).toContain('>쿠폰 받기</button>'); expect(actual).not.toContain('disabled=""');
    const missing = renderToStaticMarkup(<MarketingMessageContent content={content} coupon={null} />);
    expect(missing).toContain('현재 발급 불가'); expect(missing).toContain('disabled=""');
  });
});
