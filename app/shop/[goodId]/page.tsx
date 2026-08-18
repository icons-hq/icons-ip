import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { cache } from 'react';
import { GoodDetail } from '@/components/screens/GoodDetail';
import { GoodReviews } from '@/components/shop/GoodReviews';
import { getCatalogGoodDetail } from '@/lib/catalog';
import { normalizeGoodReviewOptions } from '@/lib/reviews';
import { loadGoodReviewSection } from '@/lib/reviews.server';

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
 * 리뷰 로더는 굿즈 로더와 병렬로 돌린다. 리뷰가 카탈로그 조회를 기다릴 이유가 없다.
 */
export default async function Page({ params, searchParams }: PageProps) {
  const { goodId } = await params;
  const reviewOptions = normalizeGoodReviewOptions(await searchParams);

  const [detail, reviewSection] = await Promise.all([
    loadGoodDetail(goodId),
    loadGoodReviewSection(goodId, reviewOptions),
  ]);
  if (!detail) notFound();

  return (
    <GoodDetail
      detail={detail}
      reviews={<GoodReviews goodId={goodId} section={reviewSection} />}
    />
  );
}
