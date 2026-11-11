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
  expect(form).toMatch(/<button[^>]*type="submit"[^>]*>검색<\/button>/);
  expect(form).toMatch(/<button[^>]*type="button"[^>]*>6개월<\/button>/);
  expect(form).not.toMatch(/<button[^>]*type="submit"[^>]*>6개월<\/button>/);
});

it('혜택상태는 같은 상태 같은 색의 배지로 보인다', () => {
  const html = render();
  expect(html).toMatch(/data-tone="(success|info|neutral)"[^>]*>(적용중|대기중|완료|중지)<\/span>/);
});

/* 줄마다 반복되던 빨간 중지가 표에서 제일 튀었다 — 줄에는 수정·발급만 두고 복사·중지는 더보기로 넣는다. 확인 창은 그대로다. */
it('혜택 이름이 앞 열이고 줄에는 빨간 중지 대신 더보기가 있다', () => {
  const html = render();
  expect(html.indexOf('혜택 이름')).toBeLessThan(html.indexOf('쿠폰 코드'));
  expect(html).not.toMatch(/<button[^>]*>중지<\/button>/);
  expect(html).toMatch(/<button[^>]*aria-label="웰컴 쿠폰 더보기"/);
  expect(html).toMatch(/<a[^>]*data-slot="button"[^>]*href="[^"]*issue\?couponCode=WELCOME10"[^>]*>발급<\/a>/);
});

it('기간은 다른 화면과 같은 표기로 한 줄씩 보인다', () => {
  const html = render();
  expect(html).toContain('2026. 11. 1. 09:00');
  expect(html).toContain('~ 무기한');
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

/* 매월 등급 혜택(S36-062) — 등급 쿠폰은 대상 칸에 지급 방식을 한 줄 더 적는다. */
it('등급 혜택 쿠폰은 대상 칸에 지급 방식을 함께 보인다', () => {
  const graded = (cadence: 'upgrade' | 'monthly') => ({ ...coupon, id: `GOLD-${cadence.toUpperCase()}`, code: `GOLD-${cadence.toUpperCase()}`, name: `골드 ${cadence}`, gradeBenefit: 'gold', gradeBenefitCadence: cadence }) as unknown as AdminCouponRecord;
  const html = renderToStaticMarkup(<CouponSection action={() => {}} draft={null} filters={normalizeAdminCouponFilters({})} onSelect={() => {}} pageSize={20} pending={false}
    records={[graded('monthly'), graded('upgrade')]} selected={null} state={{}} total={2} />);
  expect(html).toMatch(/GOLD 등급<small[^>]*>매월 1일<\/small>/);
  expect(html).toMatch(/GOLD 등급<small[^>]*>승급 시 1회<\/small>/);
});
