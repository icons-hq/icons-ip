import { loadPublicGoodsAfterSales } from '@/lib/goods-after-sales.server';
import { GoodAfterSalesContent } from '@/components/shop/GoodAfterSalesContent';
import { loadPublicGoodsSizeChart } from '@/lib/goods-size-chart.server';
import { loadPublicGoodsBenefits } from '@/lib/goods-benefits.server';
import { GoodsBenefitContent } from '@/components/wc/GoodsBenefitContent';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { cache } from 'react';
import { GoodDetail } from '@/components/screens/GoodDetail';
import { GoodQna } from '@/components/shop/GoodQna';
import { GoodReviews } from '@/components/shop/GoodReviews';
import { GoodAnnouncements } from '@/components/shop/GoodAnnouncements';
import { loadGoodAnnouncements } from '@/lib/good-announcements.server';
import { getCatalogGoodDetail, isPublishedAdultGood } from '@/lib/catalog';
import { ADULT_GOOD_LABEL, type AdultGoodsAccess } from '@/lib/adult-goods';
import { getAdultGoodsAccess } from '@/lib/adult-goods-access.server';
import { getCurrentAuthState } from '@/lib/auth/server';
import { AdultGoodGate } from '@/components/shop/AdultGoodGate';
import { normalizeGoodQuestionOptions } from '@/lib/product-questions';
import { loadGoodQuestions } from '@/lib/product-questions.server';
import { normalizeGoodReviewOptions } from '@/lib/reviews';
import { loadGoodReviewSection } from '@/lib/reviews.server';
import { loadGoodShippingPolicy } from '@/lib/fulfillment.server';
import { getBusinessInfo } from '@/lib/legal/business-info.server';
import { getGoodEngagement } from '@/lib/wishlist.server';
import { loadPublicDetailPresentation } from '@/lib/product-detail-presentation.server';
import { ProductDetailBanner, ProductDetailReviewSummary, ProductDetailRecommendations, detailPresentationNextChange } from '@/components/shop/ProductDetailPresentation';
import { ProductDetailRefresh } from '@/components/shop/ProductDetailRefresh';
import { loadGoodsReviewEvents } from '@/lib/review-events.server';
import { ReviewEventBanner } from '@/components/reviews/ReviewEventBanner';
import { loadPublicDetailExperience } from '@/lib/product-detail-experiences.server';
import { ProductPurchaseMessages } from '@/components/shop/ProductPurchaseMessages';
import { loadPublicGoodMedia } from '@/lib/goods-media.server';
import { loadSelectedReviewCards } from '@/lib/review-best.server';
import { GalleryBestReviews } from '@/components/shop/GalleryBestReviews';
import { GoodOtherCompositions } from '@/components/shop/GoodOtherCompositions';
import { loadGoodOtherCompositions } from '@/lib/good-other-compositions.server';
import { goodOtherCompositionsNextChange } from '@/lib/good-other-compositions';
import { goodDetailHref } from '@/lib/goods-display';
import { pdpShelfGoodIds } from '@/lib/listing-review-summaries';
import { loadListingReviewSummaries } from '@/lib/listing-review-summaries.server';
import { loadListingWishlist } from '@/lib/wishlist-ids.server';
import { breadcrumbJsonLd, goodImageUrls, goodMetaDescription, jsonLdText, productJsonLd, productOpenGraphTags, siteOrigin } from './structured-data';

type PageProps = {
  params: Promise<{ goodId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

/* generateMetadata 와 Page 가 같은 요청에서 카탈로그를 두 번 읽지 않도록 묶는다. */
const loadGoodDetail = cache((goodId: string, adultGoods: AdultGoodsAccess) => getCatalogGoodDetail(goodId, { adultGoods }));
const loadAdultGoodGate = cache(isPublishedAdultGood);

/* 19금 굿즈(ADR-0024): 인증 성인(full)은 일반 상세를, 인증 전 방문자(masked)는 상품 정보 없는
   인증 안내를 본다. 성인 인증이 닫혀 있으면(hidden) 지금처럼 없는 상품이다. */
async function resolveGoodDetail(goodId: string) {
  const adultGoods = await getAdultGoodsAccess();
  const detail = await loadGoodDetail(goodId, adultGoods);
  if (detail) return { detail, adultGate: false };
  return { detail: null, adultGate: adultGoods !== 'hidden' && await loadAdultGoodGate(goodId) };
}

/* 굿즈마다 다른 제목을 낸다 — 탭·북마크·검색결과·스크린리더가 상세를 구별할 수 있어야 한다(WCAG 2.4.2).
   공유 미리보기용 Open Graph 제목·이미지·주소도 여기서 낸다(PD-17). og:type=product 와 가격(og:price:*)은
   Next metadata 로 property 속성을 낼 수 없어 페이지가 직접 낸다(productOpenGraphTags) — 그래서 여기에는 type 이 없다. */
export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { goodId } = await params;
  const { detail, adultGate } = await resolveGoodDetail(goodId);
  /* 인증 전 19금 굿즈는 상품 이름 없이 안내 제목만 내고 색인하지 않는다. */
  if (!detail && adultGate) {
    return { title: `${ADULT_GOOD_LABEL} — ICONS`, robots: { index: false, follow: false } };
  }
  /* 없는 굿즈는 여기서 바로 404로 보낸다. 폴백 제목을 돌려주면 그 제목이
     브라우저에 절대 도달하지 않으면서 테스트만 통과하는 죽은 분기가 된다. */
  if (!detail) notFound();

  const origin = siteOrigin();
  const description = goodMetaDescription(detail.good.name);
  const image = goodImageUrls(detail, origin)[0];
  return {
    title: `${detail.good.name} — ICONS`,
    description,
    /* 인증 성인에게 열린 19금 상세도 검색에 싣지 않는다 — 수집기는 인증 안내만 본다. */
    ...(detail.good.saleRestriction === 'adult' ? { robots: { index: false, follow: false } } : {}),
    openGraph: {
      siteName: 'ICONS',
      locale: 'ko_KR',
      title: detail.good.name,
      description,
      url: `${origin}${goodDetailHref(detail.good.id)}`,
      ...(image ? { images: [{ url: image, alt: detail.good.name }] } : {}),
    },
  };
}

/*
 * 공개 브라우징 원칙 — 로그인 없이 열람할 수 있고, 로그인은 담기 시점에만 필요하다.
 * 리뷰도 마찬가지다(#254). 살지 말지를 정하는 사람은 아직 로그인하지 않은 사람이라,
 * 리뷰를 로그인 뒤로 미루면 리뷰를 두는 이유 자체가 사라진다.
 *
 * 상품 Q&A(#330)도 같은 이유로 공개다 — 사기 전에 묻는 글이라 로그인 뒤로 미루면
 * 물어볼 사람이 아무도 남지 않는다. 작성만 보호 액션이다.
 *
 * 각 로더는 서로를 기다릴 이유가 없어 함께 돈다. 찜·재입고 신청 여부(#326)는
 * 게스트·mock 모드에서도 던지지 않고 false 로 떨어지므로 공개 열람을 막지 않는다.
 *
 * 선반 카드(연관 굿즈·다른 구성·자동 추천·배송비 절약·관심 굿즈)의 목록 하트와 별점(LFS 패리티 2차 L4b · CL-01·CL-02):
 * 위시 굿즈 ID 는 회원당 한 번(`loadListingWishlist`), 서버가 그리는 세 선반의 별점은 선반 굿즈가 정해진 뒤
 * 한 번의 묶음으로 읽는다 — 다른 로더와 나란히 돌아 카드 수만큼 부르지 않는다. 둘 다 던지지 않는다.
 */
export default async function Page({ params, searchParams }: PageProps) {
  const { goodId } = await params;
  const resolvedSearchParams = await searchParams;
  const reviewOptions = normalizeGoodReviewOptions(resolvedSearchParams);
  const questionOptions = normalizeGoodQuestionOptions(resolvedSearchParams);

  /* 19금 굿즈 판정(ADR-0024)을 함께 돌려주는 상세 요청이다 — 선반 별점 묶음도 이 결과의 상세를 기다린다. */
  const resolvedRequest = resolveGoodDetail(goodId);
  const presentationRequest = loadPublicDetailPresentation(goodId);
  const otherCompositionsRequest = loadGoodOtherCompositions(goodId);
  const shelfReviewSummariesRequest = Promise.all([resolvedRequest, otherCompositionsRequest, presentationRequest])
    .then(([{ detail: loadedDetail }, compositions, loadedPresentation]) => (loadedDetail
      ? loadListingReviewSummaries(pdpShelfGoodIds({ relatedGoods: loadedDetail.relatedGoods, otherCompositions: compositions, presentation: loadedPresentation }))
      : {}));
  const [resolved, reviewSection, questionSection, engagement, shippingPolicy, announcements, presentation, reviewEvents, experience, media, selectedReviews, goodsBenefits, afterSales, sizeChart, otherCompositions, sellerInfo, listingWishlist, listingReviewSummaries] = await Promise.all([
    resolvedRequest,
    loadGoodReviewSection(goodId, reviewOptions),
    loadGoodQuestions(goodId, questionOptions),
    getGoodEngagement(goodId),
    loadGoodShippingPolicy(goodId),
    loadGoodAnnouncements(goodId),
    presentationRequest,
    loadGoodsReviewEvents([goodId]),
    loadPublicDetailExperience(goodId),
    loadPublicGoodMedia(goodId),
    loadSelectedReviewCards(goodId),
    loadPublicGoodsBenefits(goodId),
    loadPublicGoodsAfterSales(goodId),
    loadPublicGoodsSizeChart(goodId),
    otherCompositionsRequest,
    /* 추가정보 탭의 판매자 정보 — 푸터와 같은 쿠키 없는 캐시 읽기다(PD-06). */
    getBusinessInfo(),
    loadListingWishlist(),
    shelfReviewSummariesRequest,
  ]);
  const detail = resolved.detail;
  if (!detail && resolved.adultGate) {
    const auth = await getCurrentAuthState();
    return <AdultGoodGate goodId={goodId} signedIn={Boolean(auth.user)} />;
  }
  if (!detail) notFound();
  const event = reviewEvents.rows.find(row => row.goodId === goodId)?.event;
  const boundaries = [detailPresentationNextChange(presentation), reviewEvents.nextChangeAt, experience?.nextChangeAt, goodOtherCompositionsNextChange(otherCompositions)]
    .flatMap(value => value && Number.isFinite(Date.parse(value)) ? [Date.parse(value)] : []);
  const nextChangeAt = boundaries.length ? new Date(Math.min(...boundaries)).toISOString() : null;

  /* 구조화 데이터(PD-17)는 공개 상세가 뜬 굿즈에만 붙는다 — 미공개·판매 제한은 위 로더가 404 다. */
  const origin = siteOrigin();

  return (
    <>
      <script dangerouslySetInnerHTML={{ __html: jsonLdText(productJsonLd(detail, origin)) }} type="application/ld+json" />
      <script dangerouslySetInnerHTML={{ __html: jsonLdText(breadcrumbJsonLd(detail, origin)) }} type="application/ld+json" />
      {productOpenGraphTags(detail.good).map((tag) => <meta content={tag.content} key={tag.property} property={tag.property} />)}
      <ProductDetailRefresh nextChangeAt={nextChangeAt} />
      <GoodDetail
        detail={{ ...detail, sizeChart }}
        shippingPolicy={shippingPolicy}
        announcements={<GoodAnnouncements data={announcements} />}
        promotionBanner={presentation?.banner ? <ProductDetailBanner data={presentation} /> : undefined}
        reviewEventBanner={event ? <ReviewEventBanner event={event} /> : undefined}
        reviewHighlights={<ProductDetailReviewSummary goodId={goodId} data={presentation} />}
        otherCompositions={<GoodOtherCompositions data={otherCompositions} reviewSummaries={listingReviewSummaries} wishlist={listingWishlist} />}
        selectedReviews={selectedReviews.length === 3 ? <GalleryBestReviews goodId={goodId} cards={selectedReviews} /> : undefined}
        automaticRecommendations={<ProductDetailRecommendations data={presentation} manual={detail.relatedGoods} reviewSummaries={listingReviewSummaries} wishlist={listingWishlist} />}
        purchaseMessages={experience?.messages.length ? <ProductPurchaseMessages messages={experience.messages} /> : undefined}
        discovery={experience?.discovery}
        media={media}
        goodsBenefits={<GoodsBenefitContent value={goodsBenefits} />}
        afterSales={<GoodAfterSalesContent value={afterSales} />}
        engagement={engagement}
        qna={<GoodQna goodId={goodId} section={questionSection} />}
        qnaSummary={{ count: questionSection.count }}
        reviewSummary={reviewSection.unavailable ? undefined : reviewSection.summary}
        reviews={<GoodReviews goodId={goodId} section={reviewSection} />}
        sellerInfo={sellerInfo}
        listingWishlist={listingWishlist}
        listingReviewSummaries={listingReviewSummaries}
      />
    </>
  );
}
