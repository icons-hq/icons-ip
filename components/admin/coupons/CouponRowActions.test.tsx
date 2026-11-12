import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, expect, it, vi } from 'vitest';
import type { AdminCouponActionState } from '@/app/admin/coupon-actions';
import type { AdminCouponRecord } from '@/lib/admin/coupons';

/* 줄의 중지·재개 확인은 useActionState에 감싼 함수를 넘긴다. 그 함수를 잡아 직접 실행한다. */
const hooks = vi.hoisted(() => ({ reducer: null as null | ((state: AdminCouponActionState, formData: FormData) => Promise<AdminCouponActionState>), setStatus: vi.fn() }));
vi.mock('react', async () => {
  const actual = await vi.importActual<typeof import('react')>('react');
  return { ...actual, useActionState: (reducer: typeof hooks.reducer) => { hooks.reducer = reducer; return [{}, vi.fn(), false]; } };
});
vi.mock('@/app/admin/coupon-actions', () => ({ setAdminCouponStatusAction: hooks.setStatus }));
import { CouponRowActions } from './CouponRowActions';
import { CouponSection } from '../sections/CouponSection';
import { normalizeAdminCouponFilters } from '@/lib/admin/coupons';

const coupon = { id: 'FALL-3000', code: 'FALL-3000', name: '가을 혜택', status: 'active', termsRevision: 2 } as unknown as AdminCouponRecord;
beforeEach(() => { hooks.reducer = null; hooks.setStatus.mockReset(); });
function renderRow(onStatusChanged = vi.fn()) {
  renderToStaticMarkup(<CouponRowActions coupon={coupon} copyHref="/copy" issueHref="/issue" onEdit={() => {}} onStatusChanged={onStatusChanged} />);
  return onStatusChanged;
}

/* 1027T-026 ①: 상태가 바뀐 줄은 새로 그려져 확인 창의 결과 문장이 함께 사라졌다. 저장되면 목록 위 결과 자리로 올린다. */
it('중지·재개가 저장되면 혜택 이름·코드와 결과 문장을 목록에 알린다', async () => {
  const onStatusChanged = renderRow();
  hooks.setStatus.mockResolvedValue({ message: '혜택을 중지했습니다.' });
  await hooks.reducer!({}, new FormData());
  expect(onStatusChanged).toHaveBeenCalledWith('가을 혜택(FALL-3000) 혜택을 중지했습니다.');
});

it('저장하지 못하면 목록에 알리지 않고 확인 창 안 오류로 남긴다', async () => {
  const onStatusChanged = renderRow();
  hooks.setStatus.mockResolvedValue({ errors: { form: '혜택 상태를 변경하지 못했습니다.' } });
  await expect(hooks.reducer!({}, new FormData())).resolves.toEqual({ errors: { form: '혜택 상태를 변경하지 못했습니다.' } });
  expect(onStatusChanged).not.toHaveBeenCalled();
});

it('목록 위 결과 자리에 받은 문장을 상태 문장으로 보인다', () => {
  const html = renderToStaticMarkup(<CouponSection action={() => {}} draft={null} filters={normalizeAdminCouponFilters({})} onSelect={() => {}} pageSize={20} pending={false}
    records={[]} selected={null} state={{}} total={0} statusResult={{ id: 1, message: '가을 혜택(FALL-3000) 혜택을 중지했습니다.' }} />);
  expect(html).toMatch(/data-coupon-status-result=""[^>]*tabindex="-1"[^>]*>.*role="status"[^>]*>.*가을 혜택\(FALL-3000\) 혜택을 중지했습니다\./s);
  expect(html.indexOf('data-coupon-status-result')).toBeLessThan(html.indexOf('혜택 목록'));
});
