import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { GoodDetail } from '@/components/screens/GoodDetail';
import { getCatalogGoodDetail } from '@/lib/catalog';

export const metadata: Metadata = {
  title: '굿즈 상세 — ICONS',
  description: 'ICONS 공식 굿즈의 구성, 고시정보, 배송과 교환·반품 안내를 확인하세요.',
};

/* 공개 브라우징 원칙 — 로그인 없이 열람할 수 있고, 로그인은 담기 시점에만 필요하다. */
export default async function Page({ params }: { params: Promise<{ goodId: string }> }) {
  const { goodId } = await params;
  const detail = await getCatalogGoodDetail(goodId);
  if (!detail) notFound();

  return <GoodDetail detail={detail} />;
}
