'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useRef, useState, type MouseEvent, type ReactNode } from 'react';
import { GoodBuyBars, GoodPurchasePanel, GoodRailBuyBox, purchaseSheetAvailable, useAddToCartResult, useGoodPurchase } from '@/components/shop/GoodPurchasePanel';
import { useGiftPurchaseAvailable } from '@/components/gifts/GiftPurchaseEntry';
import { useSubscriptionPurchaseAvailable } from '@/components/subscriptions/SubscriptionPurchaseEntry';
import { AddToCartResultDialog } from '@/components/shop/AddToCartResultDialog';
import { GoodPurchaseSheet } from '@/components/shop/GoodPurchaseSheet';
import { OverlayPortal } from '@/components/shell/OverlayPortal';
import { PdpGallery } from '@/components/shop/PdpGallery';
import { WishlistHeart } from '@/components/shop/WishlistHeart';
import { GoodShareButton } from '@/components/shop/GoodShareButton';
import { PdpPrice } from '@/components/shop/PdpPrice';
import { Badge } from '@/components/wc/Badge';
import { TabPanels, type TabPanelDef } from '@/components/wc/TabPanels';
import type { GoodDetailContent } from '@/lib/goods-detail';
import { goodsNoticeRows } from '@/lib/goods-notice';
import { GoodsKcDisclosure } from '@/components/shop/GoodsKcDisclosure';
import { GoodsDescription } from '@/components/shop/GoodsDescription';
import { GoodRelatedProducts } from '@/components/shop/GoodRelatedProducts';
import { GoodIpCard, GoodIpStory } from '@/components/shop/GoodIpCard';
import { GoodsGroupSelector } from '@/components/shop/GoodsGroupSelector';
import { goodDisplayBadges } from '@/lib/goods-taxonomy';
import { newInquiryHref } from '@/lib/inquiries';
import { formatReviewAverage, goodReviewsHref, reviewRatingLabel, type ReviewRatingSummary } from '@/lib/reviews';
import type { GoodShippingPolicy } from '@/lib/fulfillment';
import type { BusinessInfo } from '@/lib/legal/business-info';
import type { DetailDiscovery } from '@/lib/product-detail-experiences';
import { ProductShippingSavings } from '@/components/shop/ProductShippingSavings';
import { ProductInterestShelf } from '@/components/shop/ProductInterestShelf';
import { ProductShortclips } from '@/components/shop/ProductShortclips';
import type { PublicGoodMedia } from '@/lib/goods-media';
import { cartOptionGood, variantSearchForSelection, variantSyncDefault } from '@/lib/goods-options';
import { GoodSizeChart } from '@/components/shop/GoodSizeChart';
import { goodsVolumeBoundary } from '@/lib/goods-transaction-presentation';
import { GoodAdditionalInfo } from '@/components/shop/GoodAdditionalInfo';

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

export type PdpPanelId = 'detail' | 'reviews' | 'qna' | 'info';

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

/**
 * 데스크톱 레일 박스의 화면 위치(CH-16). 탭 섹션이 화면 밖이면 없음, 탭 섹션 안에서는 박스가
 * 화면 하단에 붙어 있다(docked). 레일 끝이 화면에 들어오면 박스가 레일과 함께 밀려 올라간다(leaving).
 */
export function pdpRailBoxState(state: { panelsInView: boolean; railEndInView: boolean }): 'docked' | 'leaving' | undefined {
  if (!state.panelsInView) return undefined;
  return state.railEndInView ? 'leaving' : 'docked';
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

/* 고시정보 표 — 추가정보 탭의 첫 아코디언에 들어간다(PD-06). 제목은 아코디언 펼침 제목
   ("고시정보", CONTEXT.md 용어)이 맡는다. */
function NoticeTable({ detail }: { detail: GoodDetailContent }) {
  const rows = goodsNoticeRows(detail.notice);

  return rows.length ? (
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
      <h2 className="wc-pdp-panel__title" id="pdp-inquiry-heading">굿즈 문의</h2>
      <p className="wc-pdp-panel__note">
        구성, 재고, 배송 일정처럼 이 굿즈에 대해 궁금한 점을 운영자에게 비공개로 물어볼 수 있습니다.
        영업일 기준 24시간 안에 첫 답변을 드립니다.
      </p>
      <Link className="wc-pdp-guide__link" href={newInquiryHref({ category: 'good', goodId })}>
        굿즈 문의하기
      </Link>
    </section>
  );
}

export interface GoodDetailViewProps {
  detail: GoodDetailContent;
  shippingPolicy?: GoodShippingPolicy | null;
  announcements?: ReactNode;
  promotionBanner?: ReactNode;
  reviewEventBanner?: ReactNode;
  reviewHighlights?: ReactNode;
  otherCompositions?: ReactNode;
  selectedReviews?: ReactNode;
  automaticRecommendations?: ReactNode;
  purchaseMessages?: ReactNode;
  goodsBenefits?: ReactNode;
  afterSales?: ReactNode;
  discovery?: DetailDiscovery;
  media?: PublicGoodMedia | null;
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
  /** 추가정보 탭의 판매자 정보 — 푸터와 같은 공개 사업자 정보 소스. 없으면 기본값을 쓴다. */
  sellerInfo?: BusinessInfo;
}

export function GoodDetailView({
  detail,
  shippingPolicy,
  announcements,
  promotionBanner,
  reviewEventBanner,
  reviewHighlights,
  otherCompositions,
  selectedReviews,
  automaticRecommendations,
  purchaseMessages,
  goodsBenefits,
  afterSales,
  discovery,
  media,
  embedded = false,
  engagement,
  qna,
  qnaSummary,
  reviewSummary,
  reviews,
  sellerInfo,
}: GoodDetailViewProps) {
  const { good, ip } = detail;
  const searchParams = useSearchParams();
  const router = useRouter();
  const tabsRef = useRef<HTMLDivElement>(null);
  const railEndRef = useRef<HTMLSpanElement>(null);
  const [panelsInView, setPanelsInView] = useState(false);
  const [railEndInView, setRailEndInView] = useState(false);

  const purchase = useGoodPurchase({
    disabled: embedded,
    good,
    additionalGoods: detail.additionalGoods ?? [],
    restockRequested: engagement?.restockRequested ?? false,
    /* 주소의 ?variant= 가 고를 수 있는 옵션이면 그 옵션으로 연다(PD-14). 서버 렌더도 같은 값을 읽는다. */
    initialVariantId: embedded ? null : searchParams?.get('variant'),
  });
  /* 옵션을 바꾸면 주소의 ?variant= 를 같은 기록 항목 안에서 바꾼다(PD-14, Next 의 history.replaceState
     연동 — 서버 요청·라우팅 없이 useSearchParams 만 따라 바뀐다). 첫 화면의 자동 기본 선택은 쓰지 않는다.
     같은 상세 안 이동(리뷰·Q&A 페이지 링크)이 주소에서 variant 를 지우면 다시 써 넣는다 — 그래서 주소의
     variant 도 따라 읽는다. 주소에서 온 첫 선택은 기본 선택이 아니라 사용자가 고른 선택으로 본다. */
  const selectedVariantId = purchase.selectedOption?.id;
  const urlVariantId = embedded ? null : searchParams?.get('variant') ?? null;
  const [defaultVariantId] = useState(() => variantSyncDefault(urlVariantId, selectedVariantId));
  useEffect(() => {
    if (embedded) return;
    const search = variantSearchForSelection(window.location.search, selectedVariantId, defaultVariantId);
    if (search !== null) window.history.replaceState(null, '', `${window.location.pathname}${search}${window.location.hash}`);
  }, [embedded, defaultVariantId, selectedVariantId, urlVariantId]);
  /* 정기배송·선물 진입 가용성은 상세에서 한 번만 묻는다. 구매 패널은 시트를 열고 닫을 때마다 본문과 시트
     사이를 오가며 다시 마운트되므로, 패널이 직접 물으면 그때마다 같은 요청이 나가고 응답 전까지 진입이
     비어 시트 높이가 튄다. */
  const subscriptionAvailable = useSubscriptionPurchaseAvailable(good.id, !embedded);
  const giftAvailable = useGiftPurchaseAvailable(!embedded);
  const otherPurchases = { subscription: subscriptionAvailable, gift: giftAvailable };
  /* 담기 함수는 컨트롤러 것을 그대로 부르고, 확정된 결과만 모달로 알린다(PD-02).
     패널·고정 바가 같은 감싼 담기를 써야 어느 표면에서 담아도 같은 모달이 뜬다. */
  const addResult = useAddToCartResult(purchase);
  const surfacePurchase = embedded ? purchase : { ...purchase, addToCart: addResult.addToCart };
  /* 모바일 구매 시트(PD-01). 담기 결과 모달이 뜨면 시트는 내려간다 — 두 모달이 겹치면
     Escape 하나에 둘이 함께 닫히고 아래 시트가 보조기기에 열린 채 남는다. */
  const [sheetOpen, setSheetOpen] = useState(false);
  const sheetVisible = !embedded && sheetOpen && !addResult.items;
  useEffect(() => {
    if (!sheetOpen) return;
    /* 시트는 모바일 바에서만 열린다. 창을 넓혀 데스크톱 배치로 넘어가면 닫아 본문 패널로 돌려준다. */
    const desktop = window.matchMedia('(min-width: 990px)');
    const closeOnDesktop = () => { if (desktop.matches) setSheetOpen(false); };
    desktop.addEventListener('change', closeOnDesktop);
    return () => desktop.removeEventListener('change', closeOnDesktop);
  }, [sheetOpen]);
  const nextPriceChange = [good, ...(detail.additionalGoods ?? [])].reduce<number | null>((next, item) => {
    return [goodsVolumeBoundary(item), item.salePeriod?.nextChangeAt, ...(item.options ?? []).flatMap(option => [option.pricing?.nextChangeAt, option.supply?.nextChangeAt])].reduce<number | null>((earliest, changeAt) => {
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

  /* 데스크톱 레일 박스는 레일 안 sticky 라 탭 섹션이 화면에 있는 동안 화면 하단에 붙고,
     레일 끝이 화면에 들어오면 레일과 함께 밀려 올라간다. 문의 런처가 그 박스와 겹치지 않도록
     (CH-16) 두 시점을 스크롤 좌표 대신 가시성으로 읽어 지면에 상태로 남긴다. */
  useEffect(() => {
    const tabs = tabsRef.current;
    const railEnd = railEndRef.current;
    if (embedded || !tabs || !railEnd || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (entry.target === tabs) setPanelsInView(entry.isIntersecting);
        else setRailEndInView(entry.isIntersecting);
      }
    }, { threshold: 0 });
    observer.observe(tabs);
    observer.observe(railEnd);
    return () => observer.disconnect();
  }, [embedded]);
  const railBox = pdpRailBoxState({ panelsInView, railEndInView });

  /* 별점 행의 "N개 리뷰보기"(PD-12) — 같은 문서에서는 리뷰 탭을 열고 탭바 자리로 스크롤한다(탭이
     scrollOnSelect). 새 탭·수정 키 클릭과 스크립트 전에는 리뷰 탭으로 여는 주소로 그대로 간다. */
  const openReviewsTab = (event: MouseEvent<HTMLAnchorElement>) => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const tab = document.getElementById('pdp-tab-reviews');
    if (!tab) return;
    event.preventDefault();
    tab.click();
    tab.focus({ preventScroll: true });
  };

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
          {ip ? <GoodIpStory ip={ip} /> : null}
          <GoodsKcDisclosure disclosures={detail.kcDisclosures ?? []} />
          <InquiryEntry goodId={good.id} />
          {reviewEventBanner}
          {ip ? <GoodIpCard className="wc-pdp-ipcard--panel" ip={ip} /> : null}
          {/* 추천 블록(연관 굿즈 → 자동 추천)은 상세 설명 패널 맨 끝이다(LD-6, 2026-10-22 확정 — 탭 위에서 이동). */}
          {!embedded && detail.relatedGoods ? <GoodRelatedProducts data={detail.relatedGoods} /> : null}
          {!embedded ? automaticRecommendations : null}
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
      /* 4번째 탭(PD-06): 고시정보·배송·교환/반품·판매자 정보 아코디언. 고시정보는 상세 패널에서 옮겼다. */
      id: 'info',
      label: '추가정보',
      content: (
        <div className="wc-pdp-panel">
          <GoodAdditionalInfo
            notice={<NoticeTable detail={detail} />}
            goods={[good, ...(purchase.additionalChoices ?? []).filter(choice => choice.selected && choice.good).map(choice => choice.good!)]}
            sellerInfo={sellerInfo}
            shippingPolicy={shippingPolicy}
          />
        </div>
      ),
    },
  ];

  const Root = embedded ? 'div' : 'main';

  return (
    <Root className={`wc-root wc-pdp${embedded ? ' is-embedded' : ''}`} data-rail-box={embedded ? undefined : railBox}>
      <div className="wc-container">
        <div className="wc-pdp__layout">
          {promotionBanner && !embedded ? <div className="wc-pdp__gallery-column">{promotionBanner}<PdpGallery key={`${good.id}:${media?.settings.priority}:${media?.video?.id}:${media?.shortclip?.id}`} frames={frames} goodName={good.name} overlay={purchaseMessages} media={media} selectedReviews={selectedReviews} /></div> : <PdpGallery key={`${good.id}:${media?.settings.priority}:${media?.video?.id}:${media?.shortclip?.id}`} frames={frames} goodName={good.name} overlay={!embedded ? purchaseMessages : undefined} media={!embedded ? media : undefined} selectedReviews={!embedded ? selectedReviews : undefined} />}
          <div className="wc-pdp__info">
            {badges.length ? (
              <div className="wc-pdp__badges">
                {badges.map((badge) => <Badge key={badge}>{badge}</Badge>)}
              </div>
            ) : null}
            <h1 className="wc-pdp__title">{good.name}</h1>
            {good.nameEn ? <p lang="en" className="wc-pdp__english-name">{good.nameEn}</p> : null}
            <PdpPrice className="wc-pdp__price"
              showDiscountRate={displayedGood.showDiscountRate} compareAtPrice={displayedGood.compareAtPrice} price={displayedGood.price} priceMax={displayedGood.priceMax} />
            <div className="wc-pdp-tools">
              {/* 리뷰 0건은 회색 별만 둔다(숫자·"리뷰 0건" 없음). 있으면 평균과 리뷰 탭을 여는 링크다(PD-12).
                  조회 실패(요약 없음)는 0건처럼 보이지 않게 비운다. */}
              {reviewSummary ? reviewSummary.count > 0 ? (
                <p className="wc-pdp-tools__rating">
                  <Stars rating={reviewSummary.average} />
                  <strong className="wc-pdp-tools__average">{formatReviewAverage(reviewSummary.average)}</strong>
                  <a className="wc-pdp-tools__reviews" href={goodReviewsHref(good.id)} onClick={openReviewsTab}>
                    {reviewSummary.count.toLocaleString('ko-KR')}개 리뷰보기
                  </a>
                </p>
              ) : (
                <p className="wc-pdp-tools__rating is-empty">
                  <span aria-hidden="true" className="wc-rating__stars">☆☆☆☆☆</span>
                  <span className="wc-sr-only">아직 등록된 리뷰가 없습니다.</span>
                </p>
              ) : <span />}
              <div className="wc-pdp-tools__actions">
                <WishlistHeart
                  disabled={embedded}
                  goodId={good.id}
                  initialWished={engagement?.wished ?? false}
                />
                <GoodShareButton disabled={embedded} goodName={good.name} />
              </div>
            </div>
            {!embedded ? goodsBenefits : null}
            {!embedded ? <GoodsGroupSelector group={detail.goodsGroup} /> : null}
            {/* 모바일에서 본문 패널은 숨고 같은 패널이 구매 시트에 들어간다(CSS가 숨김을 맡는다).
                시트가 열린 동안은 본문 사본을 내린다 — 직접 입력 칸의 id 가 두 벌이 되면 라벨이
                숨은 쪽 입력에 붙는다. 컨트롤러가 하나라 내렸다 다시 그려도 선택·수량은 그대로다.
                시트를 열 수 없는 상태(판매 불가·품절 — 바가 비활성 안내·재입고 알림이다)에서는 숨기지
                않는다(is-inline). 숨기면 옵션·가격·예약·한도 안내와 품절 합계를 모바일에서 볼 길이 없다. */}
            <div className={`wc-pdp__purchase${purchaseSheetAvailable(purchase) ? '' : ' is-inline'}`}>
              {sheetVisible ? null : <GoodPurchasePanel otherPurchases={otherPurchases} purchase={surfacePurchase} />}
            </div>
            {!embedded && discovery?.shippingSavings ? <a className="wc-pdp-shipping-shortcut" href="#pdp-shipping-savings">배송비 절약 굿즈 보기</a> : null}
            {ip ? <GoodIpCard ip={ip} /> : null}
          </div>
        </div>
      </div>

      {!embedded && reviewHighlights ? <div className="wc-container">{reviewHighlights}</div> : null}
      {!embedded && otherCompositions ? <div className="wc-container">{otherCompositions}</div> : null}
      {announcements ? <div className="wc-container">{announcements}</div> : null}
      {detail.attributes?.length ? <div className="wc-container"><section className="wc-pdp-notice" aria-labelledby="pdp-attributes-heading"><h2 className="wc-pdp-panel__title" id="pdp-attributes-heading">굿즈 정보</h2><div className="wc-pdp-notice__scroll"><table className="wc-pdp-notice__table"><caption className="sr-only">굿즈 속성</caption><tbody>{detail.attributes.map(row => <tr key={row.id}><th scope="row">{row.name}</th><td>{row.value}</td></tr>)}</tbody></table></div></section></div> : null}
      {detail.sizeChart ? <div className="wc-container"><GoodSizeChart chart={detail.sizeChart} /></div> : null}
      {!embedded && discovery?.shippingSavings ? <div className="wc-container"><ProductShippingSavings goodId={good.id} option={purchase.selectedOption} quantity={purchase.quantity} /></div> : null}
      {!embedded && media?.settings.shortclips && media.shortclip ? <div className="wc-container"><ProductShortclips clip={media.shortclip} fallbackBackground={good.img} /></div> : null}
      {/* 하부 탭 섹션(PD-05): 탭바는 화면 전폭, 패널 840 + 우측 레일 340(데스크톱).
          레일은 구매 요약 박스만 담고 탭 섹션 범위에서만 보인다(PD-03). */}
      <div ref={tabsRef} className="wc-pdp-tabs">
        {/* 탭을 고르면 탭바 자리로 창을 스크롤한다(PD-13). 어드민 미리보기 안에서는 창이 콘솔이라 끈다. */}
        <TabPanels
          defaultPanelId={pdpDefaultPanelId(searchParams)}
          idBase="pdp"
          panels={panels}
          scrollOnSelect={!embedded}
        />
        {embedded ? null : (
          <div className="wc-pdp-rail">
            <GoodRailBuyBox purchase={surfacePurchase} />
            <span ref={railEndRef} aria-hidden="true" className="wc-pdp-rail__end" />
          </div>
        )}
      </div>

      {!embedded && afterSales ? <div className="wc-container">{afterSales}</div> : null}

      {!embedded && discovery?.interests ? <div className="wc-container"><ProductInterestShelf currentGoodId={good.id} /></div> : null}

      {/* 고정 바는 실제 상세 화면에만 둔다 — 어드민 미리보기에서 화면 하단을 덮으면
          미리보기가 아니라 콘솔을 가리는 바가 된다. */}
      {embedded ? null : (
        <GoodBuyBars
          onOpenSheet={() => setSheetOpen(true)}
          purchase={surfacePurchase}
          sheetOpen={sheetVisible}
        />
      )}
      {sheetVisible ? (
        <OverlayPortal>
          <GoodPurchaseSheet onClose={() => setSheetOpen(false)} otherPurchases={otherPurchases} purchase={surfacePurchase} />
        </OverlayPortal>
      ) : null}
      {!embedded && addResult.items ? (
        <OverlayPortal>
          <AddToCartResultDialog
            items={addResult.items}
            onClose={() => {
              addResult.close();
              setSheetOpen(false);
            }}
            open
          />
        </OverlayPortal>
      ) : null}
    </Root>
  );
}

/** 공개 라우트용. 목록 카드와 같은 재고·수량 제약을 그대로 쓴다. 미리보기 전용 embedded 만 받지 않는다. */
export function GoodDetail(props: Omit<GoodDetailViewProps, 'embedded'>) {
  return <GoodDetailView {...props} />;
}
