import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it, vi } from 'vitest';
import type { AdminCouponRecord } from '@/lib/admin/coupons';
vi.mock('@/app/admin/coupon-actions', () => ({ setAdminCouponStatusAction: vi.fn() }));
vi.mock('@/app/admin/coupon-target-actions', () => ({ searchCouponTargetGoodsAction: vi.fn() }));
import { CouponSection } from './CouponSection';
import { normalizeAdminCouponFilters } from '@/lib/admin/coupons';
function render(draft: Record<string, string> | null = null, copySource?: AdminCouponRecord | null) {
  return renderToStaticMarkup(<CouponSection action={() => {}} draft={draft} filters={normalizeAdminCouponFilters({})}
    onSelect={() => {}} pageSize={20} pending={false} records={[]} selected={null} state={{}} total={0} mode="create" initialGrade="silver" copySource={copySource} />);
}
function selectedGrade(html: string) { return html.match(/<select[^>]*name="gradeBenefit"[^>]*>(.*?)<\/select>/s)?.[1].match(/<option value="([^"]*)" selected=""/)?.[1]; }
it('새 쿠폰의 초기 등급이 실제 select의 선택값으로 렌더된다', () => { expect(selectedGrade(render())).toBe('silver'); });
it('실패 입력과 복사한 쿠폰의 연결 여부가 URL 초기 등급보다 우선한다', () => {
  expect(selectedGrade(render({ gradeBenefit: 'gold' }))).toBe('gold');
  expect(selectedGrade(render({ gradeBenefit: '' }))).toBe('');
  const copy = { id: 'COPY', code: 'COPY', name: '복사본', gradeBenefit: 'platinum', targetGoodIds: [], targetGoods: [] } as unknown as AdminCouponRecord;
  expect(selectedGrade(render(null, copy))).toBe('platinum');
  expect(selectedGrade(render(null, { ...copy, gradeBenefit: null }))).toBe('');
});
