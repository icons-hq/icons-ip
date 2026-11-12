import type { ReactElement } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { AdminCouponActionState } from '@/app/admin/coupon-actions';
import type { AdminCouponListData, AdminCouponRecord } from '@/lib/admin/coupons';

/* 화면 함수를 직접 불러 이동·표시만 본다 — effect는 그 자리에서 실행하고 상태는 초깃값이다. */
const mocks = vi.hoisted(() => ({ state: {} as AdminCouponActionState, replace: vi.fn() }));
vi.mock('react', async () => {
  const actual = await vi.importActual<typeof import('react')>('react');
  return { ...actual, useActionState: () => [mocks.state, vi.fn(), false], useTransition: () => [false, (fn: () => void) => fn()],
    useState: (initial: unknown) => [typeof initial === 'function' ? (initial as () => unknown)() : initial, vi.fn()],
    useRef: (value: unknown) => ({ current: value }), useEffect: (effect: () => void) => { effect(); } };
});
vi.mock('next/navigation', () => ({ useRouter: () => ({ replace: mocks.replace }) }));
vi.mock('@/app/admin/coupon-actions', () => ({ upsertAdminCouponAction: vi.fn(), setAdminCouponStatusAction: vi.fn() }));
vi.mock('@/app/admin/coupon-target-actions', () => ({ searchCouponTargetGoodsAction: vi.fn() }));
import { CouponScreen } from './CouponScreen';
import { normalizeAdminCouponFilters } from '@/lib/admin/coupons';

const record = { id: 'NEW-1', code: 'NEW-1', name: '새 혜택', targetGoodIds: [], targetGoods: [] } as unknown as AdminCouponRecord;
const data = (query: Record<string, string> = {}): AdminCouponListData => ({ filters: normalizeAdminCouponFilters(query), records: [record], selectedRecord: null, total: 1, pageSize: 20 } as unknown as AdminCouponListData);
const replaceState = vi.fn();
beforeEach(() => { mocks.state = {}; mocks.replace.mockReset(); replaceState.mockReset();
  vi.stubGlobal('window', { history: { replaceState }, location: { pathname: '/admin/sales/coupons', search: '?couponCode=NEW-1&page=1&saved=1' } }); });
afterEach(() => { vi.unstubAllGlobals(); });

/* 1027T-026 ②: 새 혜택은 저장 뒤 수정 화면으로 옮겨 가며 '저장했습니다'가 사라졌다. 옮겨 갈 주소에 한 번용 표시를 붙인다. */
it('등록 화면에서 처음 저장하면 한 번용 saved 표시를 붙여 맨 위에서 시작하고, 수정 저장은 그대로 머문다', () => {
  mocks.state = { message: 'NEW-1 쿠폰을 저장했습니다.', savedCode: 'NEW-1' };
  CouponScreen({ data: data(), mode: 'create' });
  expect(mocks.replace).toHaveBeenCalledWith('/admin/sales/coupons?couponCode=NEW-1&page=1&saved=1');

  mocks.replace.mockReset();
  mocks.state = { message: 'NEW-1 쿠폰을 저장했습니다.', savedCode: 'NEW-1', openTargetIssuance: true };
  CouponScreen({ data: data(), mode: 'create' });
  expect(mocks.replace).toHaveBeenCalledWith('/admin/sales/coupons/issue?couponCode=NEW-1&saved=1');

  mocks.replace.mockReset();
  mocks.state = { message: 'NEW-1 쿠폰을 저장했습니다.', savedCode: 'NEW-1' };
  CouponScreen({ data: data({ couponCode: 'NEW-1' }) });
  expect(mocks.replace).toHaveBeenCalledWith('/admin/sales/coupons?couponCode=NEW-1&page=1', { scroll: false });
});

it('표시를 받은 수정 화면은 저장 결과를 넘기고 주소에서 표시를 지운다', () => {
  const screen = CouponScreen({ data: data({ couponCode: 'NEW-1', saved: '1' }), justSaved: true }) as ReactElement<{ savedCode: string | null }>;
  expect(screen.props.savedCode).toBe('NEW-1');
  expect(replaceState).toHaveBeenCalledWith(null, '', '/admin/sales/coupons?couponCode=NEW-1&page=1');

  mocks.state = { errors: { form: '쿠폰을 저장하지 못했습니다. 다시 시도해주세요.' } };
  expect((CouponScreen({ data: data({ couponCode: 'NEW-1' }), justSaved: true }) as ReactElement<{ savedCode: string | null }>).props.savedCode).toBeNull();
  mocks.state = {};
  expect((CouponScreen({ data: data({ couponCode: 'NEW-1' }) }) as ReactElement<{ savedCode: string | null }>).props.savedCode).toBeNull();
});
