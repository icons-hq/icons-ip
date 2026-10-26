import Link from 'next/link';
import { ShoppingStoryCards } from '@/components/stories/ShoppingStoryCards';
import { ShoppingStoryContent } from '@/components/stories/ShoppingStoryContent';
import { ScheduledHomeRefresh } from '@/components/home/ScheduledHomeRefresh';
import type { ListingWishlist } from '@/lib/listing-wishlist';
import type { PublicShoppingStory, PublicShoppingStoryList } from '@/lib/shopping-stories';

export function ShoppingStoriesScreen({ data }: { data: PublicShoppingStoryList }) {
  const lastPage = Math.max(1, Math.ceil(data.total / data.pageSize));
  return <main className="wc-root wc-shopping-stories wc-container">
    {data.nextChangeAt ? <ScheduledHomeRefresh at={data.nextChangeAt} /> : null}
    <header className="wc-shopping-stories__heading"><div><p>SHOPPING STORY</p><h1>쇼핑스토리</h1><p>좋아하는 것들을 더 가까이 만나는 이야기.</p></div></header>
    {data.unavailable ? <p role="status">스토리를 불러오지 못했습니다. 잠시 후 다시 방문해주세요.</p> : data.stories.length ? <ShoppingStoryCards stories={data.stories} /> : <p className="wc-shopping-stories__empty">새로운 이야기를 준비하고 있습니다.</p>}
    {lastPage > 1 ? <nav className="wc-shopping-stories__pages" aria-label="스토리 페이지">{data.page > 1 ? <Link href={`/stories?page=${data.page - 1}`}>이전</Link> : null}<span>{data.page} / {lastPage}</span>{data.page < lastPage ? <Link href={`/stories?page=${data.page + 1}`}>다음</Link> : null}</nav> : null}
  </main>;
}
/* 상품 카드의 목록 하트 초기 상태(L4b · CL-01)는 라우트가 한 번 읽어 내려 준다. */
export function ShoppingStoryScreen({ story, wishlist }: { story: PublicShoppingStory; wishlist?: ListingWishlist | null }) {
  return <main className="wc-root wc-shopping-story-page wc-container">
    {story.nextChangeAt ? <ScheduledHomeRefresh at={story.nextChangeAt} /> : null}
    <Link className="wc-shopping-story__back" href="/stories">← 쇼핑스토리</Link>
    <ShoppingStoryContent {...story} wishlist={wishlist} />
    <Link className="wc-shopping-story__back" href="/stories">모든 스토리 보기 →</Link>
  </main>;
}
