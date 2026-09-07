import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { AdminCouponActionState } from '@/app/admin/coupon-actions';
import type { AdminCouponRecord } from '@/lib/admin/coupons';
import { CouponSection } from './CouponSection';

/*
 * 현업 취합(2026-09-07) 3-4 #2 — 「저장 버튼 클릭 후 오류 발생 시 입력 내용이 모두 사라진다」.
 * 슬라이스 1 에서 IP·굿즈만 고쳤던 결함이 쿠폰 폼에 그대로 남아 있었다.
 */

const record: AdminCouponRecord = {
  id: 'CPNFIX5K',
  code: 'CPNFIX5K',
  name: '5천원 할인',
  discountType: 'fixed',
  discountValue: 5000,
  maxDiscountAmount: null,
  minSubtotal: 20000,
  startsAt: '2026-08-30T00:00:00.000Z',
  endsAt: null,
  issueLimit: null,
  issuedCount: 0,
  usedCount: 0,
  status: 'active',
  gradeBenefit: null,
};

function render(state: AdminCouponActionState) {
  return renderToStaticMarkup(
    <CouponSection
      action={() => {}}
      onSelect={() => {}}
      pending={false}
      records={[record]}
      selected={record}
      state={state}
    />,
  );
}

describe('CouponSection 저장 실패', () => {
  it('실패해도 방금 친 값이 남는다', () => {
    const html = render({
      errors: { code: '이미 사용 중인 코드입니다.' },
      values: {
        code: 'NEWCODE',
        name: '치다 만 쿠폰 이름',
        discountType: 'percent',
        discountValue: '15',
        minSubtotal: '30000',
      },
    });

    expect(html).toContain('value="NEWCODE"');
    expect(html).toContain('value="치다 만 쿠폰 이름"');
    expect(html).toContain('value="15"');
    expect(html).toContain('value="30000"');
    /* select 도 되돌아와야 한다 — React 는 마운트 뒤 defaultValue 변경을 무시한다. */
    expect(html).toContain('<option value="percent" selected="">');
    expect(html).toContain('이미 사용 중인 코드입니다.');
  });

  it('실패값이 없으면 레코드를 그대로 그린다', () => {
    const html = render({});

    expect(html).toContain('value="CPNFIX5K"');
    expect(html).toContain('value="5천원 할인"');
    expect(html).toContain('<option value="fixed" selected="">');
  });
});
