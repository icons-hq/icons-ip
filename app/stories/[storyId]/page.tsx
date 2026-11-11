import type { Metadata } from 'next';
import { cache } from 'react';
import { notFound } from 'next/navigation';
import { ShoppingStoryScreen } from '@/components/screens/ShoppingStories';
import { getPublicShoppingStory } from '@/lib/shopping-stories.server';
import { loadListingWishlist } from '@/lib/wishlist-ids.server';
const loadStory = cache(getPublicShoppingStory);
type Props = { params: Promise<{ storyId: string }> };
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const story = await loadStory((await params).storyId);
  if (!story) notFound();
  return { title: `${story.title} — ICONS`, description: story.description || undefined };
}
/* 상품 카드의 목록 하트(LFS 패리티 2차 L4b · CL-01) — 회원의 위시 ID 를 스토리와 나란히 한 번 읽는다(던지지 않는다).
   스토리 로더가 이미 요청 쿠키를 읽는 동적 렌더라 렌더 방식은 바뀌지 않는다. */
export default async function ShoppingStoryPage({ params }: Props) {
  const { storyId } = await params;
  const [story, wishlist] = await Promise.all([loadStory(storyId), loadListingWishlist()]);
  if (!story) notFound();
  return <ShoppingStoryScreen story={story} wishlist={wishlist} />;
}
