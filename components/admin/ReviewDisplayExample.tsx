import type { ReactNode } from 'react';
import { GoodReviews } from '@/components/shop/GoodReviews';
import { PdpPrice } from '@/components/shop/PdpPrice';
import { ProductDetailReviewSummary } from '@/components/shop/ProductDetailPresentation';
import { ProductCard } from '@/components/wc/ProductCard';
import { TabPanels, type TabPanelDef } from '@/components/wc/TabPanels';
import { reviewDisplayExample } from '@/lib/admin/review-display-example';
import { formatReviewAverage, goodReviewsHref, reviewRatingLabel } from '@/lib/reviews';
import { ReviewDisplayExamplePanel } from './ReviewDisplayExamplePanel';

/*
 * SHEET-027(MD-0019): 리뷰 관리 화면의 '고객 화면 노출 예시'. 공개 화면과 같은 부품(상품 목록 카드·리뷰 탭·리뷰 목록)을
 * 합성 데이터로 그린다. DB에 리뷰를 넣지 않고, 이 화면 밖(고객 화면·리뷰 집계·엑셀)에는 나오지 않는다.
 * 서버에서 그려 예시 틀(클라이언트)에 넘긴다 — 상품 상세의 리뷰 블록도 서버 컴포넌트라 같은 방식으로 그려진다.
 *
 * 상품 상세 가격 아래 별점 줄은 GoodDetail 안에 직접 쓰인 마크업이라(따로 내보낸 부품이 없다) 같은 클래스·문구로 옮겨 적었다.
 * GoodDetail이 바뀌면 ReviewDisplayExample.test.tsx의 마크업 대조가 깨진다 — 그때 여기도 맞춘다.
 */

/** 예시 안의 구역 설명 띠. 고객 화면에는 없는 줄이라 점선 띠로 구분하고 '예시'로 시작한다. */
function ExampleNote({ step, children }: { step: string; children: ReactNode }) {
  return <p className="m-0 border-y border-dashed border-[var(--wc-hairline-dark)] bg-[var(--wc-surface-grey)] px-4 py-2 text-[12px] leading-[1.6] text-[var(--wc-ink-sub)]" data-review-example-note="">
    <strong className="font-bold text-[var(--wc-ink)]">예시 {step}</strong> · {children}
  </p>;
}

/** 상품 상세 정보 칼럼의 별점 행(PD-12)과 같은 마크업이다. 리뷰가 있으면 평균과 리뷰 탭을 여는 링크를 둔다. */
function PdpRatingRow({ goodId, average, count }: { goodId: string; average: number; count: number }) {
  const filled = Math.max(0, Math.min(5, Math.round(average)));
  return <div className="wc-pdp-tools">
    <p className="wc-pdp-tools__rating">
      <span className="wc-rating__stars"><span aria-hidden="true">{'★'.repeat(filled)}{'☆'.repeat(5 - filled)}</span><span className="wc-sr-only">{reviewRatingLabel(average)}</span></span>
      <strong className="wc-pdp-tools__average">{formatReviewAverage(average)}</strong>
      <a className="wc-pdp-tools__reviews" href={goodReviewsHref(goodId)}>{count.toLocaleString('ko-KR')}개 리뷰보기</a>
    </p>
  </div>;
}

export function ReviewDisplayExampleContent({ now }: { now?: Date }) {
  const example = reviewDisplayExample(now);
  const { summary } = example.section;
  const placeholder = <div className="wc-pdp-panel"><p className="wc-pdp-panel__note">예시에서는 리뷰 탭만 보여 줍니다.</p></div>;
  /* 상품 상세 하부 탭과 같은 이름·순서다. 리뷰 탭만 열어 둔다. */
  const panels: TabPanelDef[] = [
    { id: 'detail', label: '상세정보', content: placeholder },
    { id: 'reviews', label: '리뷰', count: summary.count, content: <div className="wc-pdp-panel"><GoodReviews goodId={example.goodId} section={example.section} /></div> },
    { id: 'qna', label: 'Q&A', content: placeholder },
    { id: 'info', label: '추가정보', content: placeholder },
  ];
  return <>
    <ExampleNote step="①">상품 목록 카드 — 공개 리뷰가 있으면 가격 아래에 별점과 리뷰 수가 보이고, 리뷰가 없으면 별점 줄이 없습니다.</ExampleNote>
    <div className="wc-container py-4">
      <div className="grid max-w-[440px] grid-cols-2 gap-x-3 gap-y-6">
        {example.cards.map(card => <ProductCard key={card.name} href={`/shop/${example.goodId}`} name={card.name} price={card.price} imageBackground={card.imageBackground} reviewSummary={card.reviewSummary} />)}
      </div>
    </div>
    {/* 상품 상세 안의 위에서 아래 순서 그대로다: 정보 칼럼의 별점 줄 → (켠 경우) 상단 리뷰 요약 → 하부 탭의 리뷰 탭. */}
    <div className="wc-pdp">
      <ExampleNote step="②">상품 상세 — 가격 아래 별점 줄. 평균 별점과 &ldquo;{summary.count}개 리뷰보기&rdquo;를 누르면 리뷰 탭으로 이동합니다.</ExampleNote>
      <div className="wc-container"><div className="wc-pdp__info">
        <h1 className="wc-pdp__title">{example.goodName}</h1>
        <PdpPrice className="wc-pdp__price" price={example.price} />
        <PdpRatingRow goodId={example.goodId} average={summary.average} count={summary.count} />
      </div></div>
      <ExampleNote step="③">상품 상세 상단 리뷰 요약 — 상품 상세 구성에서 켠 경우에만 보입니다. 4·5점 비율과 4점 이상 리뷰 카드(사진 리뷰 먼저)입니다.</ExampleNote>
      <div className="wc-container"><ProductDetailReviewSummary goodId={example.goodId} data={example.highlights} /></div>
      <ExampleNote step="④">상품 상세 &ldquo;리뷰 ({summary.count})&rdquo; 탭 — 평균·별점 분포·사진, 정렬·필터, 리뷰 목록과 운영자 답글. 리뷰이벤트 선정 리뷰에는 혜택 안내가 붙습니다.</ExampleNote>
      <div className="wc-pdp-tabs"><TabPanels idBase="pdp" defaultPanelId="reviews" panels={panels} /></div>
    </div>
  </>;
}

/** 리뷰 관리 화면 아래에 늘 두는 예시 패널. 펼쳤을 때만 예시 화면(iframe)을 만든다. */
export function ReviewDisplayExample() {
  return <ReviewDisplayExamplePanel><ReviewDisplayExampleContent /></ReviewDisplayExamplePanel>;
}
