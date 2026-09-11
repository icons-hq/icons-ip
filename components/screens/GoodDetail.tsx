'use client';

import { krw } from '@/lib/format';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { GoodBuyBars, GoodPurchasePanel, isMiniBuybarVisible, useGoodPurchase } from '@/components/shop/GoodPurchasePanel';
import { PdpGallery } from '@/components/shop/PdpGallery';
import { WishlistHeart } from '@/components/shop/WishlistHeart';
import { Badge } from '@/components/wc/Badge';
import { PriceBlock } from '@/components/wc/PriceBlock';
import { TabPanels, type TabPanelDef } from '@/components/wc/TabPanels';
import type { GoodDetailContent } from '@/lib/goods-detail';
import { goodsNoticeRows } from '@/lib/goods-notice';
import { GoodsKcDisclosure } from '@/components/shop/GoodsKcDisclosure';
import { GoodsDescription } from '@/components/shop/GoodsDescription';
import { goodDisplayBadges } from '@/lib/goods-taxonomy';
import { newInquiryHref } from '@/lib/inquiries';
import { LEGAL_DOCUMENT_LABELS, legalDocumentHref } from '@/lib/legal/links';
import { formatReviewAverage, reviewRatingLabel, type ReviewRatingSummary } from '@/lib/reviews';
import { shippingPolicyDescription, type GoodShippingPolicy } from '@/lib/fulfillment';
import { cartOptionGood } from '@/lib/goods-options';
import { goodsShipDateLabel } from '@/lib/goods-preorders';
import type { Good } from '@/lib/data';

/*
 * 굿즈 상세 (#173 → #326 White Catalog 재조판).
 *
 * 골격은 R-04: 상단 2칼럼(갤러리 649 : 정보 531) + 하부 sticky 패널 탭.
 * 브레드크럼은 없다(레퍼런스 실측 — GNB 와 갤러리 사이에 아무것도 두지 않는다).
 *
 * 리뷰 본문은 slot 이다. 이 화면은 갤러리·수량 때문에 `'use client'` 인데 리뷰는
 * 서버에서 읽어 서버에서 그린다 — 그래야 리뷰 사진의 서명 URL 이 클라이언트 번들의
 * props 로 직렬화되지 않는다. 어드민 미리보기(#184)는 저장 전 입력값으로 같은
 * 마크업을 그리되 인터랙티브 컨트롤만 비활성으로 둔다.
 */

export type PdpPanelId = 'detail' | 'reviews' | 'qna' | 'shipping';

/* 리뷰 정렬·필터·페이지는 URL 로 움직이고(lib/reviews.ts) 링크는 전부 풀 페이지 이동이다.
   그 링크를 밟고 돌아온 화면이 상세정보 탭이면 사용자는 방금 누른 "다음 페이지"의
   결과를 볼 수 없다. 리뷰 조건이 URL 에 있으면 리뷰 탭에서 시작한다. */
const REVIEW_PARAM_NAMES = ['reviewSort', 'reviewPhoto', 'reviewPage'] as const;

/* 상품 Q&A 도 같은 문법을 쓴다(lib/product-questions.ts). 알림·내 Q&A 목록에서
   들어오는 링크도 이 파라미터를 달고 오므로, 도착한 화면이 Q&A 탭이어야 한다. */
const QNA_PARAM_NAMES = ['qnaPage'] as const;

export function pdpDefaultPanelId(search: { has: (name: string) => boolean } | null): PdpPanelId {
  if (!search) return 'detail';
  if (REVIEW_PARAM_NAMES.some((name) => search.has(name))) return 'reviews';
  if (QNA_PARAM_NAMES.some((name) => search.has(name))) return 'qna';
  return 'detail';
}

/** 별점은 색·기호로만 전하지 않는다 — 별 문자를 그대로 읽히면 "검은 별 검은 별…"이 된다. */
function Stars({ rating }: { rating: number }) {
  const filled = Math.max(0, Math.min(5, Math.round(rating)));

  return (
    <span className="wc-rating__stars">
      <span aria-hidden="true">{'★'.repeat(filled)}{'☆'.repeat(5 - filled)}</span>
      <span className="wc-sr-only">{reviewRatingLabel(rating)}</span>
    </span>
  );
}

function NoticeTable({ detail }: { detail: GoodDetailContent }) {
  const rows = goodsNoticeRows(detail.notice);

  return (
    <section aria-labelledby="pdp-notice-heading" className="wc-pdp-notice">
      {/* 제목은 용어집(CONTEXT.md '고시정보')을 따른다. 어드민 폼·lib/goods-notice.ts 와 같은 말이어야
          운영자와 이용자가 같은 표를 다른 이름으로 부르지 않는다. */}
      <h2 className="wc-pdp-panel__title" id="pdp-notice-heading">고시정보</h2>
      {rows.length ? (
        /* 360px 에서 표가 페이지를 가로로 밀지 않도록 자기 컨테이너 안에서 흐른다. */
        <div className="wc-pdp-notice__scroll">
          <table className="wc-pdp-notice__table">
            {/* 법정 고시 제도의 이름은 제목이 아니라 표 캡션에서 각주처럼 밝힌다. */}
            <caption className="wc-pdp-notice__caption">
              전자상거래법에 따라 표시하는 상품정보제공고시 항목입니다.
            </caption>
            <tbody>
              {rows.map((row) => (
                <tr key={row.key}>
                  <th scope="row">{row.label}</th>
                  <td>{row.value}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="wc-pdp-panel__note">
          아직 등록된 고시정보가 없습니다. 판매 시작 전에 등록됩니다.
        </p>
      )}
    </section>
  );
}

function ShippingGuide({ policy, goods }: { policy?: GoodShippingPolicy | null; goods: readonly Good[] }) {
  const preorders = goods.flatMap(good => (good.options ?? [])
    .filter(option => option.supply?.mode === 'preorder')
    .map(option => ({ id: option.id, label: `${good.name} · ${option.name}`, date: option.supply!.expectedShipDate })));
  return (
    <section aria-labelledby="pdp-shipping-heading" className="wc-pdp-guide">
      <h2 className="wc-pdp-panel__title" id="pdp-shipping-heading">배송 안내</h2>
      <ul className="wc-pdp-guide__list">
        <li>{policy ? shippingPolicyDescription(policy) : '배송 정책을 확인하지 못했습니다. 주문 전에 배송비를 확인해주세요.'}</li>
        {policy?.shippingNotice && <li style={{ whiteSpace: 'pre-wrap' }}>{policy.shippingNotice}</li>}
        <li>출고지별 정책 적용 굿즈의 기간 할인 적용 후, 쿠폰·적립금 차감 전 소계로 무료배송 조건을 확인합니다. 다른 출고지의 배송비는 각각 더합니다.</li>
        {/*
         * 출고 기한의 진실원은 배송·반품 정책(/legal/shipping 1. 배송 안내)이다. 여기서 더 짧은
         * 영업일 수를 따로 적으면 약관 제13조 3항이 손해배상 기준으로 삼는 "약정 배송기간"이
         * 두 개가 되어, 어느 쪽이 약정인지 정할 수 없다. 그래서 정책 문장을 그대로 싣는다.
         */}
        {preorders.length ? <>
          <li>예약판매 옵션은 아래 발송 예정일에 맞춰 공급을 준비합니다. 같은 출고지의 일반 상품과 예약상품을 함께 주문하면 가장 늦은 예정일에 함께 발송합니다. 주문서에서 최종 발송 예정일을 확인해주세요.</li>
          {preorders.map(option => <li key={option.id}>{option.label}: {goodsShipDateLabel(option.date)}</li>)}
          <li>일반 판매 옵션만 주문한 경우에는 기본 배송 정책을 따릅니다. 예약 공급 일정이 바뀌면 주문 상세에서 변경된 예정일을 확인할 수 있습니다.</li>
        </> : <li>대금을 먼저 지급하는 선지급 주문이므로, 결제가 확정된 날부터 3영업일 이내에 배송에 필요한 조치를 취합니다. 무통장 입금 주문은 입금이 확인된 날이 결제 확정일입니다. 공급 절차가 늦어지면 그 진행 상황을 알립니다.</li>}
        <li>배송지에 따른 추가 배송비는 주문서에서 주소를 입력한 뒤 확인합니다. 배송 가능 여부와 최종 배송비를 확인해야 주문할 수 있습니다.</li>
        <li>원화(KRW)로 결제하며 대한민국 주소로 배송합니다. 국내 배송대행지를 이용할 수 있고, 이후 해외 운송은 고객이 배송대행사에 별도로 신청합니다.</li>
      </ul>
    </section>
  );
}

function ReturnGuide({ policy }: { policy?: GoodShippingPolicy | null }) {
  const terms = policy?.claimPolicy;
  return (
    <section aria-labelledby="pdp-return-heading" className="wc-pdp-guide">
      <h2 className="wc-pdp-panel__title" id="pdp-return-heading">교환 · 반품 안내</h2>
      <ul className="wc-pdp-guide__list">
        {terms?.restrictionReason && <li style={{ whiteSpace: 'pre-wrap' }}>상품별 확인 조건: {terms.restrictionReason} · 고객센터에 사유를 접수하면 개별 확인합니다.</li>}
        {terms && <>
          <li>고객 귀책 반품비(편도): {terms.returnFee === null ? '확인 후 안내' : krw(terms.returnFee)}</li>
          <li>최초 무료배송 후 반품비(왕복 합계): {terms.returnFreeShippingFee === null ? '확인 후 안내' : krw(terms.returnFreeShippingFee)}</li>
          <li>고객 귀책 교환비(왕복 합계): {terms.exchangeFee === null ? '확인 후 안내' : krw(terms.exchangeFee)}</li>
        </>}
        {policy?.returnExchangeNotice && <li style={{ whiteSpace: 'pre-wrap' }}>{policy.returnExchangeNotice}</li>}
        {policy?.returnAddress && <li>회수 주소: {policy.returnAddress} · 먼저 고객센터에 접수한 뒤 안내에 따라 보내주세요.</li>}
        {policy?.cs && (policy.cs.name || policy.cs.phone || policy.cs.email) && <li>고객센터: {[policy.cs.name, policy.cs.phone, policy.cs.email].filter(Boolean).join(' · ')}</li>}
        <li>굿즈를 받은 날부터 7일 이내에 청약철회를 신청할 수 있습니다.</li>
        <li>단순 변심으로 반품하는 경우 반송비는 구매자가 부담하며 착불로 보내주세요.</li>
        <li>굿즈가 파손·오배송된 경우에는 반송비를 ICONS가 부담합니다.</li>
        <li>사용·훼손해 재판매가 어려워진 굿즈는 청약철회가 제한될 수 있습니다.</li>
      </ul>
      {/* 요약만 두면 반송비 부담·반품 절차·환급 기한을 확인할 곳이 없다. 전문은 정책 문서가 진실원이다. */}
      <Link className="wc-pdp-guide__link" href={legalDocumentHref('shipping')}>
        {LEGAL_DOCUMENT_LABELS.shipping} 전문 보기
      </Link>
    </section>
  );
}

/*
 * 상품 문의 진입점(#253).
 *
 * 공개 브라우징을 깨지 않는다 — 링크는 비로그인에게도 보이고, 로그인은 문의 화면이
 * 요구한다. 여기서 감추면 "물어볼 데가 없는 상품"으로 보인다.
 */
function InquiryEntry({ goodId }: { goodId: string }) {
  return (
    <section aria-labelledby="pdp-inquiry-heading" className="wc-pdp-guide">
      <h2 className="wc-pdp-panel__title" id="pdp-inquiry-heading">상품 문의</h2>
      <p className="wc-pdp-panel__note">
        구성, 재고, 배송 일정처럼 이 굿즈에 대해 궁금한 점을 운영자에게 비공개로 물어볼 수 있습니다.
        영업일 기준 24시간 안에 첫 답변을 드립니다.
      </p>
      <Link className="wc-pdp-guide__link" href={newInquiryHref({ category: 'good', goodId })}>
        상품 문의하기
      </Link>
    </section>
  );
}

export interface GoodDetailViewProps {
  detail: GoodDetailContent;
  shippingPolicy?: GoodShippingPolicy | null;
  /** 어드민 미리보기처럼 다른 화면 안에 놓일 때. 구매 패널·하트를 비활성으로 그린다. */
  embedded?: boolean;
  reviews?: ReactNode;
  /** 상품 Q&A 본문. 리뷰와 같은 이유로 서버에서 읽어 서버에서 그린 블록을 받는다. */
  qna?: ReactNode;
  engagement?: { wished: boolean; restockRequested: boolean };
  /**
   * 정보 칼럼의 별점 요약과 리뷰 탭 카운트. 리뷰 본문은 slot 이 그리므로 개수·평균만
   * 따로 받는다 — 어드민 미리보기처럼 리뷰가 없는 호출은 생략한다.
   */
  reviewSummary?: ReviewRatingSummary;
  /** Q&A 탭 카운트. 본문과 같은 이유로 개수만 따로 받는다. */
  qnaSummary?: { count: number };
}

export function GoodDetailView({
  detail,
  shippingPolicy,
  embedded = false,
  engagement,
  qna,
  qnaSummary,
  reviewSummary,
  reviews,
}: GoodDetailViewProps) {
  const { good, ip } = detail;
  const searchParams = useSearchParams();
  const router = useRouter();
  const tabsRef = useRef<HTMLDivElement>(null);
  const [panelsInView, setPanelsInView] = useState(false);

  const purchase = useGoodPurchase({
    disabled: embedded,
    good,
    additionalGoods: detail.additionalGoods ?? [],
    restockRequested: engagement?.restockRequested ?? false,
  });
  const nextPriceChange = [good, ...(detail.additionalGoods ?? [])].flatMap((item) => item.options ?? []).reduce<number | null>((next, option) => {
    return [option.pricing?.nextChangeAt, option.supply?.nextChangeAt].reduce<number | null>((earliest, changeAt) => {
      const time = changeAt ? Date.parse(changeAt) : NaN;
      return Number.isFinite(time) ? Math.min(earliest ?? time, time) : earliest;
    }, next);
  }, null) ?? null;
  useEffect(() => {
    if (embedded || nextPriceChange === null) return;
    const refreshAtBoundary = () => {
      if (document.visibilityState !== 'hidden' && Date.now() >= nextPriceChange) router.refresh();
    };
    let timer: ReturnType<typeof setTimeout>;
    const scheduleBoundary = () => {
      timer = setTimeout(() => {
        if (Date.now() < nextPriceChange) scheduleBoundary();
        else refreshAtBoundary();
      }, Math.min(2_147_483_647, Math.max(100, nextPriceChange - Date.now() + 25)));
    };
    scheduleBoundary();
    window.addEventListener('focus', refreshAtBoundary);
    document.addEventListener('visibilitychange', refreshAtBoundary);
    return () => {
      clearTimeout(timer);
      window.removeEventListener('focus', refreshAtBoundary);
      document.removeEventListener('visibilitychange', refreshAtBoundary);
    };
  }, [embedded, nextPriceChange, router]);

  /* 미니 구매바는 상단 구매 패널이 화면 밖으로 밀려난 뒤에만 의미가 있다. 그 시점을
     스크롤 좌표로 계산하지 않고 하부 탭 영역의 가시성으로 읽는다 — 탭이 보인다는 것은
     정보 칼럼이 이미 지나갔다는 뜻이고, 뷰포트 높이·헤더 높이를 다시 재지 않아도 된다. */
  useEffect(() => {
    const node = tabsRef.current;
    if (!node || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver(
      (entries) => setPanelsInView(entries.some((entry) => entry.isIntersecting)),
      { threshold: 0 },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  /* 갤러리가 비어도 대표 이미지 한 장으로 정상 렌더된다(#172 완료 조건). */
  const frames = [good.img, ...detail.gallery];
  const displayedGood = purchase.selectedOption ? cartOptionGood(good, purchase.selectedOption.id) ?? good : good;
  const badges = goodDisplayBadges(displayedGood);

  const panels: TabPanelDef[] = [
    {
      id: 'detail',
      label: '상세정보',
      content: (
        <div className="wc-pdp-panel">
          <GoodsDescription description={detail.description} format={detail.descriptionFormat} imagePaths={detail.descriptionImagePaths} />
          {detail.detailImageUrl ? (
            /* 긴 세로 이미지는 크롭하지 않고 <img> 로 그린다. 어드민이 넣는 외부 URL 이라
               next/image 의 최적화 대상이 아니다. */
            /* eslint-disable-next-line @next/next/no-img-element */
            <img alt={`${good.name} 상세 이미지`} className="wc-pdp-panel__image" src={detail.detailImageUrl} />
          ) : null}
          <NoticeTable detail={detail} />
          <GoodsKcDisclosure disclosures={detail.kcDisclosures ?? []} />
          <InquiryEntry goodId={good.id} />
        </div>
      ),
    },
    {
      id: 'reviews',
      label: '리뷰',
      count: reviewSummary?.count,
      content: (
        <div className="wc-pdp-panel">
          {reviews ?? (
            <p className="wc-pdp-panel__note">아직 등록된 리뷰가 없습니다.</p>
          )}
        </div>
      ),
    },
    {
      id: 'qna',
      label: 'Q&A',
      count: qnaSummary?.count,
      content: (
        <div className="wc-pdp-panel">
          {qna ?? (
            <p className="wc-pdp-panel__note">아직 등록된 질문이 없습니다.</p>
          )}
        </div>
      ),
    },
    {
      id: 'shipping',
      label: '배송·교환 안내',
      content: (
        <div className="wc-pdp-panel">
          <ShippingGuide policy={shippingPolicy} goods={[good, ...(purchase.additionalChoices ?? []).filter(choice => choice.selected && choice.good).map(choice => choice.good!)]} />
          <ReturnGuide policy={shippingPolicy} />
        </div>
      ),
    },
  ];

  const Root = embedded ? 'div' : 'main';

  return (
    <Root className={`wc-root wc-pdp${embedded ? ' is-embedded' : ''}`}>
      <div className="wc-container">
        <div className="wc-pdp__layout">
          <PdpGallery frames={frames} goodName={good.name} />
          <div className="wc-pdp__info">
            {badges.length ? (
              <div className="wc-pdp__badges">
                {badges.map((badge) => <Badge key={badge}>{badge}</Badge>)}
              </div>
            ) : null}
            <h1 className="wc-pdp__title">{good.name}</h1>
            {good.nameEn ? <p lang="en" className="wc-pdp__english-name">{good.nameEn}</p> : null}
            <PriceBlock className="wc-pdp__price"
              compareAtPrice={displayedGood.compareAtPrice} price={displayedGood.price} priceMax={displayedGood.priceMax} />
            <div className="wc-pdp-tools">
              {reviewSummary ? (
                <p className="wc-pdp-tools__rating">
                  <Stars rating={reviewSummary.average} />
                  <strong className="wc-pdp-tools__average">{formatReviewAverage(reviewSummary.average)}</strong>
                  <span className="wc-pdp-tools__count">리뷰 {reviewSummary.count.toLocaleString('ko-KR')}건</span>
                </p>
              ) : <span />}
              <WishlistHeart
                disabled={embedded}
                goodId={good.id}
                initialWished={engagement?.wished ?? false}
              />
            </div>
            <GoodPurchasePanel purchase={purchase} />
            {ip ? (
              <div className="wc-pdp__brand">
                <span className="wc-pdp__brand-name">{ip.title}</span>
                <Link className="wc-pdp__brand-link" href={`/ip/${ip.id}`}>브랜드 보러가기</Link>
              </div>
            ) : null}
          </div>
        </div>
      </div>

      <div ref={tabsRef} className="wc-pdp-tabs">
        <div className="wc-container">
          <TabPanels
            defaultPanelId={pdpDefaultPanelId(searchParams)}
            idBase="pdp"
            panels={panels}
          />
        </div>
      </div>

      {/* 고정 바는 실제 상세 화면에만 둔다 — 어드민 미리보기에서 화면 하단을 덮으면
          미리보기가 아니라 콘솔을 가리는 바가 된다. */}
      {embedded ? null : (
        <GoodBuyBars
          miniVisible={isMiniBuybarVisible({ embedded, panelsInView })}
          purchase={purchase}
        />
      )}
    </Root>
  );
}

/** 공개 라우트용. 목록 카드와 같은 재고·수량 제약을 그대로 쓴다. */
export function GoodDetail({
  detail,
  shippingPolicy,
  engagement,
  qna,
  qnaSummary,
  reviewSummary,
  reviews,
}: {
  detail: GoodDetailContent;
  shippingPolicy?: GoodShippingPolicy | null;
  engagement?: { wished: boolean; restockRequested: boolean };
  qna?: ReactNode;
  qnaSummary?: { count: number };
  reviewSummary?: ReviewRatingSummary;
  reviews?: ReactNode;
}) {
  return (
    <GoodDetailView
      detail={detail}
      shippingPolicy={shippingPolicy}
      engagement={engagement}
      qna={qna}
      qnaSummary={qnaSummary}
      reviewSummary={reviewSummary}
      reviews={reviews}
    />
  );
}
