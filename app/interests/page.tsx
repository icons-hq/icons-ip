import { notFound } from 'next/navigation';
import { ProductInterests } from '@/components/screens/ProductInterests';
import { loadPublicDetailExperienceConfig } from '@/lib/product-detail-experiences.server';
import { loadListingWishlist } from '@/lib/wishlist-ids.server';
export const metadata = { title: '관심 굿즈 — ICONS' };
/* 카드 목록 하트(LFS 패리티 2차 L4b · CL-01)의 위시 ID 는 운영 스위치와 나란히 회원당 한 번 읽는다(던지지 않는다). */
export default async function InterestsPage() {
  const [config, wishlist] = await Promise.all([loadPublicDetailExperienceConfig(), loadListingWishlist()]);
  if (!config.interests) notFound();
  return <ProductInterests wishlist={wishlist} />;
}
