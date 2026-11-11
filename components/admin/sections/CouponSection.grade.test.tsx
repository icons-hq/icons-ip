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
function selectedCadence(html: string) { return html.match(/<select[^>]*name="gradeBenefitCadence"[^>]*>(.*?)<\/select>/s)?.[1].match(/<option value="([^"]*)" selected=""/)?.[1]; }
it('등급 혜택을 고르면 지급 방식(승급 시 1회 기본·매월 1일)을 함께 고른다', () => {
  expect(selectedCadence(render())).toBe('upgrade');
  expect(render()).toContain('매월 1일 0시(한국 시간)에 그 시점 이 등급 이상인 회원에게 한 장씩 발급');
  expect(render()).toContain('지급 직전에 대상 회원의 등급을 최근 90일 실적으로 다시 계산하므로 실적이 줄어든 회원은 그때 강등되어 받지 않습니다');
  expect(selectedCadence(render({ gradeBenefit: 'gold', gradeBenefitCadence: 'monthly' }))).toBe('monthly');
  const copy = { id: 'COPY', code: 'COPY', name: '복사본', gradeBenefit: 'gold', gradeBenefitCadence: 'monthly', targetGoodIds: [], targetGoods: [] } as unknown as AdminCouponRecord;
  expect(selectedCadence(render(null, copy))).toBe('monthly');
});
it('등급 혜택이 없으면 지급 방식 칸을 보내지 않는다(서버가 승급 시 1회로 둔다)', () => {
  const html = render({ gradeBenefit: '' });
  expect(html).not.toContain('name="gradeBenefitCadence"');
  expect(html).not.toContain('data-grade-cadence-help');
});
it('새 쿠폰의 초기 등급이 실제 select의 선택값으로 렌더된다', () => { expect(selectedGrade(render())).toBe('silver'); });
it('실패 입력과 복사한 쿠폰의 연결 여부가 URL 초기 등급보다 우선한다', () => {
  expect(selectedGrade(render({ gradeBenefit: 'gold' }))).toBe('gold');
  expect(selectedGrade(render({ gradeBenefit: '' }))).toBe('');
  const copy = { id: 'COPY', code: 'COPY', name: '복사본', gradeBenefit: 'platinum', targetGoodIds: [], targetGoods: [] } as unknown as AdminCouponRecord;
  expect(selectedGrade(render(null, copy))).toBe('platinum');
  expect(selectedGrade(render(null, { ...copy, gradeBenefit: null }))).toBe('');
});
