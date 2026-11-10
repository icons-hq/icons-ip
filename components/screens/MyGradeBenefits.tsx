import Link from 'next/link';
import { MypageShell } from '@/components/wc/MypageShell';
import { LOYALTY_GRADES, LOYALTY_WINDOW_DAYS, loyaltyGradeLabel, type LoyaltyGrade } from '@/lib/loyalty';
import {
  gradeBenefitCountLines,
  gradeBenefitCouponCopy,
  gradeCreditRateLabel,
  hasGradeCreditRates,
  loyaltyCriterionCopy,
  type GradeBenefitRow,
  type LoyaltyGradeBenefits,
  type MyLoyaltyStanding,
} from '@/lib/loyalty-benefits';
import { hrefFor } from '@/lib/routes';

/*
 * 회원 등급 혜택 (LFS 패리티 2차 L6 · MY-05 — 11 §5.5).
 *
 * 레퍼런스 순서: 안내 박스 → 등급표(등급·기준 280 | 혜택 640) → 쿠폰함 CTA → 산정 안내.
 * 등급 조건과 내 등급은 get_my_loyalty_status(), 등급별 혜택은 get_loyalty_grade_benefits()가 정본이다 —
 * 화면은 숫자를 지어내지 않고, 못 읽은 칸은 그 자리에 "확인하지 못했어요"라고 쓴다.
 * 아직 오르지 않은 등급은 쿠폰 내용 대신 종류별 장수만 받는다(RPC 공개 범위) — 내용은 승급 뒤 쿠폰함에서 본다.
 * 뱃지 색은 DESIGN §2 의 --wc-loyalty-* 쌍만 쓴다(레퍼런스 원색 금지). 용어는 '회원 등급' — 유료 v2 개념과 섞지 않는다.
 */

function EyeGlyph() {
  return (
    <svg aria-hidden className="wc-grade-benefits__notice-icon" fill="none" height="18" viewBox="0 0 24 24" width="18">
      <path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z" stroke="currentColor" strokeLinejoin="round" strokeWidth="1.6" />
      <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="1.6" />
    </svg>
  );
}

interface GradeRow {
  grade: LoyaltyGrade;
  criterion: string;
  current: boolean;
  benefits: GradeBenefitRow | null;
}

/** 표에 세울 등급. 자동 승급을 운영하지 않는 등급은 내 등급일 때만 남긴다(운영자 조정으로 머무를 수 있다). */
function gradeRows(standing: MyLoyaltyStanding | null, benefits: LoyaltyGradeBenefits | null): GradeRow[] {
  return LOYALTY_GRADES.flatMap((grade) => {
    const current = standing?.grade === grade;
    const criterion = standing ? loyaltyCriterionCopy(grade, standing.tiers) : '기준을 확인하지 못했어요';
    if (criterion === null && !current) return [];
    return [{
      grade,
      criterion: criterion ?? '지금은 자동으로 오르는 기준이 없는 등급이에요',
      current,
      benefits: benefits?.grades.find((row) => row.grade === grade) ?? null,
    }];
  });
}

function BenefitList({ row, unavailable, now }: { row: GradeBenefitRow | null; unavailable: boolean; now: Date }) {
  if (unavailable || !row) {
    return <p className="wc-grade-benefits__empty">혜택 정보를 확인하지 못했어요. 잠시 후 다시 열어주세요.</p>;
  }
  const rate = row.creditRateBps !== null && row.creditRateBps > 0 ? gradeCreditRateLabel(row.creditRateBps) : null;
  const countLines = row.reached ? [] : gradeBenefitCountLines(row.couponCounts);
  if (!row.coupons.length && !countLines.length && !rate) {
    return <p className="wc-grade-benefits__empty">지금은 이 등급에 지급 중인 혜택이 없어요.</p>;
  }
  return (
    <ul className="wc-grade-benefits__list">
      {countLines.map((line) => (
        <li key={`${row.grade}-${line}`}>
          <strong>{line}</strong>
          <span className="wc-grade-benefits__terms">쿠폰 내용은 이 등급에 오르면 쿠폰함에서 확인할 수 있어요</span>
        </li>
      ))}
      {row.coupons.map((coupon, index) => {
        const copy = gradeBenefitCouponCopy(coupon, now);
        return (
          <li key={`${row.grade}-${index}-${coupon.name}`}>
            <strong>{coupon.name}</strong> · {copy.benefit}
            <span className="wc-grade-benefits__terms">{copy.condition} · 사용 기간 {copy.validity}</span>
            {copy.recipient ? <span className="wc-grade-benefits__terms">{copy.recipient}</span> : null}
          </li>
        );
      })}
      {rate ? (
        <li>
          <strong>구매 금액의 {rate} 적립금</strong>
          <span className="wc-grade-benefits__terms">거래확정된 주문의 결제 금액(배송비 제외) 기준이며, 주문할 때의 등급 적립률이 적용돼요</span>
        </li>
      ) : null}
    </ul>
  );
}

export function MyGradeBenefits({
  benefits,
  now,
  standing,
}: {
  benefits: LoyaltyGradeBenefits | null;
  /** 사용 기간 문구의 기준 시각. 테스트 주입용 — 비우면 렌더 시각을 쓴다. */
  now?: Date;
  standing: MyLoyaltyStanding | null;
}) {
  const at = now ?? new Date();
  const rows = gradeRows(standing, benefits);
  const nothing = !standing && !benefits;

  return (
    <MypageShell active={hrefFor('gradeBenefits')}>
      <div className="wc-mypage__headbar">
        <h1 className="wc-mypage__headbar-title">회원 등급 혜택</h1>
      </div>

      <div className="wc-grade-benefits__notice">
        <EyeGlyph />
        <div>
          <p>등급이 오르면 새로 오른 등급까지의 혜택 쿠폰이 자동으로 지급되고, 쿠폰함에서 바로 확인할 수 있어요.</p>
          <p>등급은 최근 {LOYALTY_WINDOW_DAYS}일 동안 결제가 완료된 주문을 기준으로 결제 완료·취소 때 다시 계산돼요.</p>
        </div>
      </div>

      {nothing ? (
        <p className="wc-grade-benefits__error" role="alert">회원 등급 정보를 불러오지 못했어요. 잠시 후 다시 열어주세요.</p>
      ) : (
        <table className="wc-grade-benefits__table">
          <caption className="wc-sr-only">회원 등급별 기준과 혜택</caption>
          <colgroup>
            <col className="wc-grade-benefits__col-grade" />
            <col />
          </colgroup>
          <thead>
            <tr>
              <th scope="col">등급 / 기준</th>
              <th scope="col">혜택</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr className={row.current ? 'is-current' : undefined} key={row.grade}>
                <th scope="row">
                  <span aria-hidden className={`wc-mypage__tier-badge wc-mypage__tier-badge--${row.grade}`}>
                    {loyaltyGradeLabel(row.grade)}
                  </span>
                  <strong className="wc-grade-benefits__name">{loyaltyGradeLabel(row.grade)}</strong>
                  <span className="wc-grade-benefits__criterion">{row.criterion}</span>
                  {row.current ? (
                    <span className="wc-grade-benefits__current">
                      내 등급{standing?.nextNote ? ` · ${standing.nextNote}` : ''}
                    </span>
                  ) : null}
                </th>
                <td>
                  <BenefitList now={at} row={row.benefits} unavailable={!benefits} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <div className="wc-grade-benefits__cta">
        <Link className="wc-btn primary" href="/my/coupons">등급 혜택 쿠폰 확인</Link>
      </div>

      <div className="wc-grade-benefits__guide">
        <p className="wc-grade-benefits__guide-title">등급 산정 기준</p>
        <ul>
          <li>최근 {LOYALTY_WINDOW_DAYS}일 동안 결제가 완료된 주문의 결제 금액 합계 또는 굿즈 주문 항목 수가 등급 기준에 닿으면 올라가요.</li>
          <li>취소된 주문은 빼고 계산하며, 결제가 완료되거나 주문이 취소될 때 등급을 다시 계산해요.</li>
        </ul>
        <p className="wc-grade-benefits__guide-title">혜택 지급</p>
        <ul>
          <li>등급 혜택 쿠폰은 쿠폰마다 한 번만 지급되고, 이미 받은 쿠폰은 다시 지급되지 않아요.</li>
          {/* 표가 적립률 줄을 그릴 때만 — 등급 적립이 꺼져 있으면 없는 혜택을 약속하지 않는다. */}
          {hasGradeCreditRates(benefits) ? <li>등급 적립금은 기본 적립금 정책의 주문당·보유 한도 안에서 쌓여요.</li> : null}
        </ul>
        <p className="wc-grade-benefits__guide-title">유의사항</p>
        <ul>
          <li>등급 기준과 혜택은 스토어 운영 정책에 따라 바뀔 수 있어요. 바뀐 기준은 다음 등급 계산부터 적용돼요.</li>
        </ul>
      </div>
    </MypageShell>
  );
}
