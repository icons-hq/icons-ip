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
import { getCatalogGoodDetail } from '@/lib/catalog';
import { normalizeGoodQuestionOptions } from '@/lib/product-questions';
import { loadGoodQuestions } from '@/lib/product-questions.server';
import { normalizeGoodReviewOptions } from '@/lib/reviews';
import { loadGoodReviewSection } from '@/lib/reviews.server';
import { loadGoodShippingPolicy } from '@/lib/fulfillment.server';
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

type PageProps = {
  params: Promise<{ goodId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

/* generateMetadata 와 Page 가 같은 요청에서 카탈로그를 두 번 읽지 않도록 묶는다. */
const loadGoodDetail = cache(getCatalogGoodDetail);

/* 굿즈마다 다른 제목을 낸다 — 탭·북마크·검색결과·스크린리더가 상세를 구별할 수 있어야 한다(WCAG 2.4.2). */
export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { goodId } = await params;
  const detail = await loadGoodDetail(goodId);
  /* 없는 굿즈는 여기서 바로 404로 보낸다. 폴백 제목을 돌려주면 그 제목이
     브라우저에 절대 도달하지 않으면서 테스트만 통과하는 죽은 분기가 된다. */
  if (!detail) notFound();

  return {
    title: `${detail.good.name} — ICONS`,
    description: `${detail.good.name} 굿즈의 구성, 고시정보, 리뷰, 배송과 교환·반품 안내를 확인하세요.`,
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
 */
export default async function Page({ params, searchParams }: PageProps) {
  const { goodId } = await params;
  const resolvedSearchParams = await searchParams;
  const reviewOptions = normalizeGoodReviewOptions(resolvedSearchParams);
  const questionOptions = normalizeGoodQuestionOptions(resolvedSearchParams);

  const [detail, reviewSection, questionSection, engagement, shippingPolicy, announcements, presentation, reviewEvents, experience, media, selectedReviews, goodsBenefits, afterSales, sizeChart, otherCompositions] = await Promise.all([
    loadGoodDetail(goodId),
    loadGoodReviewSection(goodId, reviewOptions),
    loadGoodQuestions(goodId, questionOptions),
    getGoodEngagement(goodId),
    loadGoodShippingPolicy(goodId),
    loadGoodAnnouncements(goodId),
    loadPublicDetailPresentation(goodId),
    loadGoodsReviewEvents([goodId]),
    loadPublicDetailExperience(goodId),
    loadPublicGoodMedia(goodId),
    loadSelectedReviewCards(goodId),
    loadPublicGoodsBenefits(goodId),
    loadPublicGoodsAfterSales(goodId),
    loadPublicGoodsSizeChart(goodId),
    loadGoodOtherCompositions(goodId),
  ]);
  if (!detail) notFound();
  const event = reviewEvents.rows.find(row => row.goodId === goodId)?.event;
  const boundaries = [detailPresentationNextChange(presentation), reviewEvents.nextChangeAt, experience?.nextChangeAt, goodOtherCompositionsNextChange(otherCompositions)]
    .flatMap(value => value && Number.isFinite(Date.parse(value)) ? [Date.parse(value)] : []);
  const nextChangeAt = boundaries.length ? new Date(Math.min(...boundaries)).toISOString() : null;

  return (
    <><ProductDetailRefresh nextChangeAt={nextChangeAt} /><GoodDetail
      detail={{ ...detail, sizeChart }}
      shippingPolicy={shippingPolicy}
      announcements={<GoodAnnouncements data={announcements} />}
      promotionBanner={presentation?.banner ? <ProductDetailBanner data={presentation} /> : undefined}
      reviewEventBanner={event ? <ReviewEventBanner event={event} /> : undefined}
      reviewHighlights={<ProductDetailReviewSummary goodId={goodId} data={presentation} />}
      otherCompositions={<GoodOtherCompositions data={otherCompositions} />}
      selectedReviews={selectedReviews.length === 3 ? <GalleryBestReviews goodId={goodId} cards={selectedReviews} /> : undefined}
      automaticRecommendations={<ProductDetailRecommendations data={presentation} manual={detail.relatedGoods} />}
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
    /></>
  );
}
