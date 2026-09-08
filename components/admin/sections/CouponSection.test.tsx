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
  targetKind: 'all',
  targetGoodId: null,
};

function render(state: AdminCouponActionState, selected: AdminCouponRecord | null = record) {
  return renderToStaticMarkup(
    <CouponSection
      action={() => {}}
      goodOptions={[{ id: 'g-poster', title: '한정 포스터', archivedAt: null }]}
      onSelect={() => {}}
      pending={false}
      records={[selected ?? record]}
      selected={selected}
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

/*
 * 현업 취합(2026-09-07) — 「특정 고객군에게만 쿠폰을 줄 수 없다」.
 * 자격은 발급 시점에 한 번만 본다: 화면 문구도 그 규칙을 말해야 운영자가
 * 「조건이 깨지면 회수된다」로 오해하지 않는다.
 */
describe('CouponSection 고객 타겟팅', () => {
  it('대상이 상품일 때만 상품 선택기를 연다', () => {
    const openOnly = render({}, { ...record, targetKind: 'first_purchase', targetGoodId: null });
    expect(openOnly).not.toContain('name="targetGoodId"');

    const withGood = render({}, { ...record, targetKind: 'bought_good', targetGoodId: 'g-poster' });
    expect(withGood).toContain('name="targetGoodId"');
    expect(withGood).toContain('한정 포스터');
  });

  it('저장 실패 뒤에도 고른 대상이 남는다', () => {
    const html = render({
      errors: { form: '쿠폰을 저장하지 못했습니다.' },
      values: { targetKind: 'bought_good', targetGoodId: 'g-poster' },
    });

    expect(html).toContain('<option value="bought_good" selected="">');
    expect(html).toContain('name="targetGoodId"');
  });

  it('목록 줄에 대상을 함께 적는다 — 조건이 걸린 쿠폰을 목록에서 알아봐야 한다', () => {
    const html = render({}, { ...record, targetKind: 'repeat_purchase', targetGoodId: null });
    expect(html).toContain('CPNFIX5K · 5천원 할인 · 5,000원 · 재구매 고객만');

    /* 조건 없는 쿠폰에는 아무것도 붙지 않는다 — 「누구나」를 매 줄에 적으면 조건이 묻힌다. */
    expect(render({})).toContain('CPNFIX5K · 5천원 할인 · 5,000원<');
  });
});
