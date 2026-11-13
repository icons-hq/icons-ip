import type { GoodsReviewSummary } from '@/lib/goods-review-summary';
import type { PublicDetailPresentation } from '@/lib/product-detail-presentation';
import type { PublicSelectedReviewCard } from '@/lib/review-best';
import { DEFAULT_GOOD_REVIEW_OPTIONS, GOOD_REVIEW_PAGE_SIZE, type ReviewRatingSummary } from '@/lib/reviews';
import type { GoodReviewItem, GoodReviewSection } from '@/lib/reviews.server';

/*
 * SHEET-027(MD-0019 "리뷰가 사이트에서 어떻게 노출되는지 예시 필요", 11/11 결정 "어드민 상시 노출 예시").
 * 리뷰 관리 화면의 '고객 화면 노출 예시'가 그리는 합성 데이터다. DB에 넣지 않고 화면에서만 만든다 —
 * 운영 상품에 가짜 후기를 올리면 실제 후기로 오인될 수 있어서다(R6 SHEET-027 대안 3은 권하지 않음).
 * 상품명·작성자·본문·답글·사진에 모두 '예시'를 적는다. 캡처가 돌아다녀도 실제 후기로 읽히지 않게 한다.
 */

/** 공개 상품 ID 형식(소문자·숫자·하이픈)이지만 실제 상품에 쓰지 않는 값이다. 예시 안 링크는 눌리지 않는다. */
export const REVIEW_DISPLAY_EXAMPLE_GOOD_ID = 'review-display-example';
export const REVIEW_DISPLAY_EXAMPLE_MARK = '[예시]';

export interface ReviewDisplayExampleCard { name: string; price: number; imageBackground: string; reviewSummary: GoodsReviewSummary | null }
export interface ReviewDisplayExample {
  goodId: string;
  goodName: string;
  price: number;
  /** 상품 상세 '리뷰' 탭에 그대로 넘기는 값. 비로그인 방문자가 보는 모습이다(도움이 돼요는 로그인 링크). */
  section: GoodReviewSection;
  /** 상품 목록 카드: 리뷰가 있는 상품과 없는 상품. 없는 상품은 별점 줄이 없다. */
  cards: [ReviewDisplayExampleCard, ReviewDisplayExampleCard];
  /** 상품상세 전시 설정에서 '상단 리뷰 요약'을 켠 상품의 요약(4·5점 비율과 4점 이상 리뷰 카드, 사진 리뷰 먼저). */
  highlights: PublicDetailPresentation;
  /** 대표이미지 마지막 장의 BEST 리뷰. 공개 화면은 선정 리뷰가 3개 이상일 때 무작위 3개만 그린다(GalleryBestReviews는 3개가 아니면 그리지 않는다). */
  bestReviews: PublicSelectedReviewCard[];
}

/** 글자가 들어간 단색 사진. 실제 사진처럼 보이지 않게, 저장소 밖 주소도 쓰지 않는다. */
export function reviewDisplayExampleImage(label: string, hue: number): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="300" height="400" viewBox="0 0 300 400"><rect width="300" height="400" fill="hsl(${hue} 30% 88%)"/>`
    + `<text x="150" y="212" font-family="sans-serif" font-size="30" font-weight="700" text-anchor="middle" fill="hsl(${hue} 20% 34%)">${label}</text></svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

function summaryOf(reviews: readonly GoodReviewItem[]): ReviewRatingSummary {
  const distribution: ReviewRatingSummary['distribution'] = [0, 0, 0, 0, 0];
  for (const review of reviews) distribution[review.rating - 1] += 1;
  const total = reviews.reduce((sum, review) => sum + review.rating, 0);
  return { count: reviews.length, average: Math.round((total / reviews.length) * 100) / 100, distribution, photoCount: reviews.filter(review => review.imageUrls.length > 0).length };
}

export function reviewDisplayExample(now: Date = new Date()): ReviewDisplayExample {
  const daysAgo = (days: number) => new Date(now.getTime() - days * 86_400_000).toISOString();
  /* 비로그인 방문자가 보는 남의 리뷰다 — 내 리뷰 표시·도움 표시 상태 없이 그린다. */
  const base: Pick<GoodReviewItem, 'isMine' | 'editedAt' | 'adminReply' | 'adminReplyAt' | 'imageUrls' | 'helpfulByMe' | 'canMarkHelpful' | 'repeatPurchase' | 'kind'> = {
    isMine: false, editedAt: null, adminReply: null, adminReplyAt: null, imageUrls: [], helpfulByMe: false, canMarkHelpful: false, repeatPurchase: false, kind: 'ordinary' };
  const reviews: GoodReviewItem[] = [
    { ...base, id: 'review-display-example-1', rating: 5, repeatPurchase: true, authorName: '예시고객_A', createdAt: daysAgo(1), helpfulCount: 12,
      body: `${REVIEW_DISPLAY_EXAMPLE_MARK} 색감이 사진과 같고 마감이 깔끔해요.\n책상 위에 두니 잘 어울립니다.`,
      imageUrls: [reviewDisplayExampleImage('예시 사진 1', 212), reviewDisplayExampleImage('예시 사진 2', 32)],
      adminReply: `${REVIEW_DISPLAY_EXAMPLE_MARK} 소중한 후기 감사합니다. 다음 상품도 정성껏 준비하겠습니다.`, adminReplyAt: daysAgo(0) },
    { ...base, id: 'review-display-example-2', rating: 5, kind: 'month', authorName: '예시고객_B', createdAt: daysAgo(3), helpfulCount: 4,
      body: `${REVIEW_DISPLAY_EXAMPLE_MARK} 한 달 써 보니 받침이 단단해서 쓰러지지 않아요.`,
      imageUrls: [reviewDisplayExampleImage('예시 사진 3', 152)],
      eventDisclosure: { eventTitle: '예시 포토리뷰 이벤트', revoked: false } },
    { ...base, id: 'review-display-example-3', rating: 4, authorName: '예시고객_C', createdAt: daysAgo(6), editedAt: daysAgo(5), helpfulCount: 1,
      body: `${REVIEW_DISPLAY_EXAMPLE_MARK} 배송은 하루 늦었지만 포장이 꼼꼼했어요.` },
    { ...base, id: 'review-display-example-4', rating: 3, authorName: '예시고객_D', createdAt: daysAgo(12), helpfulCount: 0,
      body: `${REVIEW_DISPLAY_EXAMPLE_MARK} 생각보다 크기가 작아요. 상세 설명의 크기를 꼭 확인하세요.`,
      adminReply: `${REVIEW_DISPLAY_EXAMPLE_MARK} 불편을 드려 죄송합니다. 크기 안내가 더 잘 보이도록 고치겠습니다.`, adminReplyAt: daysAgo(11) },
  ];
  const summary = summaryOf(reviews);
  const positive = reviews.filter(review => review.rating >= 4)
    .sort((left, right) => Number(right.imageUrls.length > 0) - Number(left.imageUrls.length > 0) || right.rating - left.rating || right.createdAt.localeCompare(left.createdAt));
  const highlights: PublicDetailPresentation = {
    banner: null, nextChangeAt: null, recommendations: { similar: [], together: [], categoryPopular: [], storePopular: [] },
    reviews: { count: summary.count, positiveCount: positive.length, cards: positive.map(review => ({ id: review.id, rating: review.rating, body: review.body, authorName: review.authorName,
      createdAt: review.createdAt, imageUrls: review.imageUrls, ...(review.eventDisclosure ? { eventDisclosure: review.eventDisclosure } : {}) })) },
  };
  return {
    goodId: REVIEW_DISPLAY_EXAMPLE_GOOD_ID,
    goodName: `${REVIEW_DISPLAY_EXAMPLE_MARK} 아크릴 스탠드`,
    price: 15000,
    section: { viewerAuthenticated: false, summary, reviews, total: reviews.length, pageSize: GOOD_REVIEW_PAGE_SIZE, options: DEFAULT_GOOD_REVIEW_OPTIONS },
    cards: [
      { name: `${REVIEW_DISPLAY_EXAMPLE_MARK} 아크릴 스탠드`, price: 15000, imageBackground: `url("${reviewDisplayExampleImage('예시 상품', 212)}") center / cover no-repeat`,
        reviewSummary: { count: summary.count, average: summary.average } },
      { name: `${REVIEW_DISPLAY_EXAMPLE_MARK} 리뷰 없는 키링`, price: 8000, imageBackground: `url("${reviewDisplayExampleImage('예시 상품', 32)}") center / cover no-repeat`,
        reviewSummary: null },
    ],
    highlights,
    /* BEST는 별점과 무관하게 운영자가 고른다 — 예시도 3점 리뷰를 함께 넣는다. */
    bestReviews: [reviews[0], reviews[1], reviews[3]].map(review => ({ id: review.id, kind: review.kind, repeatPurchase: review.repeatPurchase, rating: review.rating,
      body: review.body, authorName: review.authorName, createdAt: review.createdAt, imageUrls: review.imageUrls, ...(review.eventDisclosure ? { eventDisclosure: review.eventDisclosure } : {}) })),
  };
}
