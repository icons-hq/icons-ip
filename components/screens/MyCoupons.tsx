import Link from 'next/link';
import { EmptyState } from '@/components/wc/EmptyState';
import { MypageShell } from '@/components/wc/MypageShell';
import {
  couponBenefitLabel,
  couponConditionLabel,
  couponDisplayState,
  couponValidityLabel,
  mapCouponActionError,
  type CouponDisplayState,
  type UserCouponSummary,
} from '@/lib/coupons';
import { loyaltyGradeLabel, isLoyaltyGrade } from '@/lib/loyalty';
import { couponTargetingLabel } from '@/lib/coupon-targeting';
import { CouponCodeClaim } from '@/components/shop/CouponCodeClaim';

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
  ineligible: '사용 조건 미충족',
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
        <div><dt>유효기간</dt><dd>{couponValidityLabel(held)}</dd></div>
        <div><dt>사용조건</dt><dd>{couponConditionLabel(held.coupon)}</dd></div>
        <div><dt>할인 대상</dt><dd>{held.coupon.benefitKind === 'shipping' ? '선결제 배송비 · 설치비와 착불 제외' : '굿즈 금액'}</dd></div>
        <div><dt>중복 사용</dt><dd>{held.coupon.stackable ? '허용 · 주문서에서 조합 확인' : '단독 사용'}</dd></div>
        <div><dt>사용 대상</dt><dd>{couponTargetingLabel(held.coupon)}</dd></div>
      </dl>
      {state === 'ineligible' ? <p>{mapCouponActionError(held.coupon.status === 'archived' ? 'coupon_archived' : held.eligibilityReason ?? 'coupon_not_started')}</p> : null}
    </li>
  );
}

export function MyCoupons({ coupons }: { coupons: UserCouponSummary[] | null }) {
  return (
    <MypageShell active="/my/coupons">
      <h1 className="wc-mypage__heading">쿠폰</h1>
      <CouponCodeClaim />
      {coupons === null ? <p role="alert">쿠폰 내역을 불러오지 못했습니다. 잠시 후 다시 열어주세요.</p> : coupons.length === 0 ? (
        <EmptyState
          action={<Link className="wc-coupon-empty__link" href="/cart">장바구니에서 코드 입력</Link>}
          className="wc-coupon-empty"
          description="쿠폰 코드가 있다면 위 입력란에서 등록할 수 있어요."
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
          <li>주문서에서 굿즈 쿠폰의 적용 순서와 배송비 쿠폰을 선택할 수 있어요. 중복 사용은 스토어 정책과 각 쿠폰의 허용 조건을 따릅니다.</li>
          <li>굿즈 쿠폰은 남은 굿즈 금액에, 배송비 쿠폰은 선결제 운송비에 적용돼요. 설치비와 착불 운송비는 배송비 할인에서 제외됩니다.</li>
          <li>주문 취소가 확정되면 사용한 쿠폰이 돌아옵니다. 실제 환불 송금과는 처리 시점이 다를 수 있습니다. 현재의 기간·고객 자격·대상 굿즈 조건을 다시 확인해주세요.</li>
        </ul>
      </div>
    </MypageShell>
  );
}
