import Link from 'next/link';
import { EmptyState } from '@/components/wc/EmptyState';
import { MypageShell } from '@/components/wc/MypageShell';
import {
  couponBenefitLabel,
  couponConditionLabel,
  couponDisplayState,
  couponExpiryLabel,
  type CouponDisplayState,
  type UserCouponSummary,
} from '@/lib/coupons';
import { loyaltyGradeLabel, isLoyaltyGrade } from '@/lib/loyalty';

/*
 * 마이 쿠폰함 (R-05 §4.4 coupon-ticket-card, S7 #329).
 *
 * 2열 티켓형 카드 — 우변 노치 펀칭이 티켓 문법을 만든다(CSS). 카드 구성은
 * 레퍼런스 순서를 따른다: 배지 → 코드 → 이름 → 유효기간 → 사용조건.
 * 등급 혜택 쿠폰은 등급 뱃지 색(DESIGN.md §2 예외 토큰)을, 일반 쿠폰은
 * 무채색을 쓴다. 사용·만료 카드는 잉크를 낮춰 구분한다.
 */

const STATE_LABELS: Record<CouponDisplayState, string> = {
  usable: '사용 가능',
  used: '사용 완료',
  expired: '기간 만료',
};

function CouponTicketCard({ held }: { held: UserCouponSummary }) {
  const state = couponDisplayState(held);
  const grade = held.coupon.gradeBenefit;
  const gradeBadge = grade && isLoyaltyGrade(grade)
    ? { className: `wc-coupon-card__badge--${grade}`, label: loyaltyGradeLabel(grade) }
    : null;

  return (
    <li className={`wc-coupon-card wc-coupon-card--${state}`}>
      <div className="wc-coupon-card__badges">
        {gradeBadge ? (
          <span className={`wc-coupon-card__badge ${gradeBadge.className}`}>{gradeBadge.label}</span>
        ) : null}
        <span className="wc-coupon-card__state">{STATE_LABELS[state]}</span>
      </div>
      <p className="wc-coupon-card__code">{held.coupon.code}</p>
      <p className="wc-coupon-card__name">{held.coupon.name}</p>
      <p className="wc-coupon-card__benefit">{couponBenefitLabel(held.coupon)}</p>
      <dl className="wc-coupon-card__meta">
        <div><dt>유효기간</dt><dd>{couponExpiryLabel(held)}</dd></div>
        <div><dt>사용조건</dt><dd>{couponConditionLabel(held.coupon)}</dd></div>
      </dl>
    </li>
  );
}

export function MyCoupons({ coupons }: { coupons: UserCouponSummary[] }) {
  return (
    <MypageShell active="/my/coupons">
      <h1 className="wc-mypage__heading">쿠폰</h1>
      {coupons.length === 0 ? (
        <EmptyState
          action={<Link className="wc-coupon-empty__link" href="/cart">장바구니에서 코드 입력</Link>}
          className="wc-coupon-empty"
          description="쿠폰 코드가 있다면 장바구니에서 입력해 등록할 수 있어요."
          title="보유한 쿠폰이 없어요"
          titleAs="h2"
        />
      ) : (
        <ul className="wc-coupon-list">
          {coupons.map((held) => <CouponTicketCard held={held} key={held.id} />)}
        </ul>
      )}
      <div className="wc-coupon-guide">
        <p>쿠폰 안내</p>
        <ul>
          <li>회원 등급 혜택 쿠폰은 승급 시 자동 지급돼요.</li>
          <li>주문 한 건에는 쿠폰 한 장만 쓸 수 있어요.</li>
          <li>할인은 굿즈 금액에만 적용되고 배송비는 제외돼요.</li>
          <li>결제 전에 주문을 취소하면 사용한 쿠폰은 돌아와요.</li>
        </ul>
      </div>
    </MypageShell>
  );
}
