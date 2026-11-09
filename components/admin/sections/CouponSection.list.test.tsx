import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it, vi } from 'vitest';
import type { AdminCouponRecord } from '@/lib/admin/coupons';
vi.mock('@/app/admin/coupon-actions', () => ({ setAdminCouponStatusAction: vi.fn() }));
vi.mock('@/app/admin/coupon-target-actions', () => ({ searchCouponTargetGoodsAction: vi.fn() }));
import { CouponSection } from './CouponSection';
import { normalizeAdminCouponFilters } from '@/lib/admin/coupons';

const coupon = {
  id: 'coupon-1', code: 'WELCOME10', name: '웰컴 쿠폰', status: 'active', termsRevision: 3, issuanceMode: 'automatic',
  gradeBenefit: null, recipientSegment: 'all', benefitKind: 'goods', discountType: 'fixed', discountValue: 1000, maxDiscountAmount: null,
  issueStartsAt: null, issueEndsAt: null, startsAt: '2026-11-01T00:00:00.000Z', endsAt: null, validDays: null, issuedCount: 4, usedCount: 1,
} as unknown as AdminCouponRecord;

function render(filters = normalizeAdminCouponFilters({ q: '웰컴' })) {
  return renderToStaticMarkup(<CouponSection action={() => {}} draft={null} filters={filters} onSelect={() => {}} pageSize={20} pending={false}
    records={[coupon]} selected={null} state={{}} total={1} />);
}

it('혜택 조회 조건은 GET 폼으로 제출되고 빠른 기간 선택은 제출하지 않는다', () => {
  const html = render();
  const form = html.match(/<form[^>]*action="\/admin\/sales\/coupons"[^>]*method="get"[^>]*>(.*?)<\/form>/s)?.[1] ?? '';
  expect(form).toContain('name="q"');
  expect(form).toContain('value="웰컴"');
  expect(form).toMatch(/<button[^>]*type="submit"[^>]*>조회<\/button>/);
  expect(form).toMatch(/<button[^>]*type="button"[^>]*>6개월<\/button>/);
  expect(form).not.toMatch(/<button[^>]*type="submit"[^>]*>6개월<\/button>/);
});

it('혜택상태는 같은 상태 같은 색의 배지로 보인다', () => {
  const html = render();
  expect(html).toMatch(/data-tone="(success|info|neutral)"[^>]*>(적용중|대기중|완료|중지)<\/span>/);
});

it('혜택 이름이 앞 열이고 줄마다 있는 중지는 테두리 버튼이다', () => {
  const html = render();
  expect(html.indexOf('혜택 이름')).toBeLessThan(html.indexOf('쿠폰 코드'));
  expect(html).toMatch(/<button[^>]*text-destructive[^>]*>중지<\/button>/);
  expect(html).not.toMatch(/<button[^>]*bg-danger-soft[^>]*>중지<\/button>/);
});

it('혜택 중지 확인은 대상 코드·약관 개정·다음 상태를 담아 제출한다', () => {
  const html = render();
  const dialog = html.match(/<dialog[^>]*aria-label="혜택 상태 변경"[^>]*>(.*?)<\/dialog>/s)?.[1] ?? '';
  expect(dialog).toContain('<input type="hidden" name="code" value="WELCOME10"/>');
  expect(dialog).toContain('<input type="hidden" name="revision" value="3"/>');
  expect(dialog).toContain('<input type="hidden" name="status" value="archived"/>');
  expect(dialog).toMatch(/<button[^>]*type="submit"[^>]*>중지 확인<\/button>/);
  expect(dialog).toMatch(/<button[^>]*type="button"[^>]*>닫기<\/button>/);
});
