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
import type { GoodsTransactionRuntimeMode } from '@/lib/checkout-transaction.server';
import type { CouponCombinationPolicy } from '@/lib/coupon-combinations';

/*
 * 마이 쿠폰함 (R-05 §4.4 coupon-ticket-card, S7 #329).
 *
 * 2열 티켓형 카드 — 우변 노치 펀칭이 티켓 문법을 만든다(CSS). 카드 구성은
 * 레퍼런스 순서를 따른다: 배지 → 코드 → 이름 → 유효기간 → 사용조건.
 * 등급 혜택 쿠폰은 등급 뱃지 색(DESIGN.md §2 예외 토큰)을, 일반 쿠폰은
 * 무채색을 쓴다. 사용·만료 카드는 잉크를 낮춰 구분한다.
 *
 * 등급 혜택 쿠폰은 코드 줄을 그리지 않는다. 승급 때 자동 지급되고 주문서에서 보유 쿠폰으로 고르므로 회원이
 * 코드를 쓸 일이 없다. 반면 코드 입력 발급은 회원 등급을 묻지 않아, 보유한 등급 쿠폰 코드에서 운영 코드
 * 규칙이 드러나면 상위 등급 코드를 짐작해 받을 수 있다(L6 리뷰 l6-data-1). 일반 쿠폰은 코드를 그대로 보여 준다.
 */

const STATE_LABELS: Record<CouponDisplayState, string> = {
  usable: '사용 가능',
  used: '사용 완료',
  expired: '기간 만료',
  ineligible: '사용 조건 미충족',
};

/** 지금 주문서 계약. 쿠폰 안내는 이것을 따른다 — 장바구니·주문서 쿠폰 칸과 같은 판정이다(R25). */
export interface MyCouponsCheckoutRules {
  transactionMode: GoodsTransactionRuntimeMode;
  /** 거래 런타임 주문서의 쿠폰 조합 정책. 읽지 못했으면 null. */
  couponPolicy: CouponCombinationPolicy | null;
}

const LEGACY_SHIPPING_LINE = '굿즈 쿠폰은 대상 굿즈 금액에 적용돼요. 배송비 쿠폰은 지금 주문에 쓸 수 없어요.';

/** 쿠폰 안내 두 줄 — 어디서 고르고 몇 장 쓰는지, 무엇에 적용되는지. 계약을 모르면 장수와 배송비 쿠폰을 단정하지 않는다. */
function couponGuideLines({ transactionMode, couponPolicy }: MyCouponsCheckoutRules): [string, string] {
  /* 운영 주문서(legacy): 주문 1건에 굿즈 쿠폰 1장, 배송비 쿠폰은 선택 RPC 가 받지 않는다. */
  if (transactionMode === 'legacy') {
    return ['장바구니와 주문서에서 보유 쿠폰을 고르거나 코드를 입력할 수 있어요. 한 주문에 굿즈 쿠폰 1장을 쓸 수 있어요.', LEGACY_SHIPPING_LINE];
  }
  if (transactionMode !== 'transaction' || !couponPolicy) {
    return ['장바구니에서 보유 쿠폰을 고르거나 코드를 입력할 수 있어요. 함께 쓸 수 있는 쿠폰 수와 배송비 쿠폰 사용 여부는 주문서에서 확인해주세요.',
      '굿즈 쿠폰은 대상 굿즈 금액에 적용돼요.'];
  }
  /* 거래 런타임 주문서: 중복 사용이 꺼져 있으면 쿠폰 1장(굿즈 또는 배송비), 켜져 있으면 굿즈 쿠폰 최대 N장 + 배송비 쿠폰 1장. */
  const { stackingEnabled, maxGoodsCoupons, shippingEnabled } = couponPolicy;
  const ONE_GOODS_COUPON = '한 주문에 굿즈 쿠폰 1장을 쓸 수 있어요.';
  let count: string;
  if (!stackingEnabled) count = shippingEnabled ? '한 주문에 굿즈 쿠폰 또는 배송비 쿠폰 1장을 쓸 수 있어요.' : ONE_GOODS_COUPON;
  else if (shippingEnabled) count = `중복 사용을 허용한 쿠폰끼리 굿즈 쿠폰 ${maxGoodsCoupons > 1 ? `최대 ${maxGoodsCoupons}장` : '1장'}과 배송비 쿠폰 1장을 함께 쓸 수 있어요.`;
  else count = maxGoodsCoupons > 1 ? `중복 사용을 허용한 굿즈 쿠폰끼리 최대 ${maxGoodsCoupons}장까지 함께 쓸 수 있어요.` : ONE_GOODS_COUPON;
  return [
    `장바구니에서 굿즈 쿠폰을 미리 고르거나 코드를 입력하고, 주문서에서 함께 쓸 쿠폰을 확정해요. ${count}`,
    shippingEnabled
      ? '굿즈 쿠폰은 남은 굿즈 금액에, 배송비 쿠폰은 선결제 운송비에 적용돼요. 설치비와 착불 운송비는 배송비 할인에서 제외됩니다.'
      : LEGACY_SHIPPING_LINE,
  ];
}

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
      {grade ? null : <p className="wc-coupon-card__code">{held.coupon.code}</p>}
      <p className="wc-coupon-card__name">{held.coupon.name}</p>
      <p className="wc-coupon-card__benefit">{couponBenefitLabel(held.coupon)}</p>
      <dl className="wc-coupon-card__meta">
        <div><dt>유효기간</dt><dd>{couponValidityLabel(held)}</dd></div>
        <div><dt>사용조건</dt><dd className="wc-coupon-card__condition">{couponConditionLabel(held.coupon)}</dd></div>
        <div><dt>할인 대상</dt><dd>{held.coupon.benefitKind === 'shipping' ? '선결제 배송비 · 설치비와 착불 제외' : '굿즈 금액'}</dd></div>
        <div><dt>중복 사용</dt><dd>{held.coupon.stackable ? '허용 · 주문서에서 조합 확인' : '단독 사용'}</dd></div>
        <div><dt>사용 대상</dt><dd>{couponTargetingLabel(held.coupon)}</dd></div>
      </dl>
      {state === 'ineligible' ? <p>{mapCouponActionError(held.coupon.status === 'archived' ? 'coupon_archived' : held.eligibilityReason ?? 'coupon_not_started')}</p> : null}
    </li>
  );
}

export function MyCoupons({ coupons, checkoutRules }: { coupons: UserCouponSummary[] | null; checkoutRules: MyCouponsCheckoutRules }) {
  const [whereLine, targetLine] = couponGuideLines(checkoutRules);
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
      {/* 안내 박스 — 레퍼런스처럼 굵은 소제목 두 묶음(쿠폰 안내 / 취소·반품 안내, 11 §5.4). */}
      <div className="wc-coupon-guide">
        <p>쿠폰 안내</p>
        <ul>
          <li>회원 등급 혜택 쿠폰은 승급 시 자동 지급돼요.</li>
          <li>{whereLine}</li>
          <li>{targetLine}</li>
        </ul>
        <p>취소·반품 안내</p>
        <ul>
          <li>주문 취소가 확정되면 사용한 쿠폰이 돌아옵니다. 실제 환불 송금과는 처리 시점이 다를 수 있습니다. 현재의 기간·고객 자격·대상 굿즈 조건을 다시 확인해주세요.</li>
        </ul>
      </div>
    </MypageShell>
  );
}
