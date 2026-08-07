import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { cache } from 'react';
import { GoodDetail } from '@/components/screens/GoodDetail';
import { getCatalogGoodDetail } from '@/lib/catalog';

type PageProps = { params: Promise<{ goodId: string }> };

/* generateMetadata 와 Page 가 같은 요청에서 카탈로그를 두 번 읽지 않도록 묶는다. */
const loadGoodDetail = cache(getCatalogGoodDetail);

/* 굿즈마다 다른 제목을 낸다 — 탭·북마크·검색결과·스크린리더가 상세를 구별할 수 있어야 한다(WCAG 2.4.2). */
export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { goodId } = await params;
  const detail = await loadGoodDetail(goodId);
  /* 없는 굿즈에서 throw 하지 않는다. 404 판정은 Page 한 곳이 한다. */
  if (!detail) return { title: '굿즈를 찾을 수 없습니다 — ICONS' };

  return {
    title: `${detail.good.name} — ICONS`,
    description: `${detail.good.name} 굿즈의 구성, 고시정보, 배송과 교환·반품 안내를 확인하세요.`,
  };
}

/* 공개 브라우징 원칙 — 로그인 없이 열람할 수 있고, 로그인은 담기 시점에만 필요하다. */
export default async function Page({ params }: PageProps) {
  const { goodId } = await params;
  const detail = await loadGoodDetail(goodId);
  if (!detail) notFound();

  return <GoodDetail detail={detail} />;
}
