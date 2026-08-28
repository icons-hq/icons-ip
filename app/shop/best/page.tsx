import type { Metadata } from 'next';
import { CollectionPlaceholder } from '@/components/shop/CollectionPlaceholder';

export const metadata: Metadata = {
  title: 'BEST — ICONS',
  description: '가장 사랑받는 굿즈를 모아 보는 BEST를 준비하고 있어요.',
  robots: { index: false, follow: false },
};

/* S4 실장 전까지의 soft 404 방지 껍데기 — 배경과 한시성은 CollectionPlaceholder 주석 참고. */
export default function Page() {
  return (
    <CollectionPlaceholder
      title="BEST를 준비하고 있어요"
      description="가장 사랑받는 굿즈를 한곳에 모아 보는 공간이 곧 열려요. 지금은 굿즈샵에서 인기 굿즈를 먼저 만나 보세요."
    />
  );
}
