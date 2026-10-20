import Link from 'next/link';
import { ShoppingStoryCards } from '@/components/stories/ShoppingStoryCards';
import type { PublicShoppingStorySummary } from '@/lib/shopping-stories';

export function HomeShoppingStories({ stories }: { stories: PublicShoppingStorySummary[] }) {
  if (!stories.length) return null;
  return <section className="wc-shopping-stories wc-shopping-stories--home wc-container" aria-labelledby="home-shopping-stories-title">
    <header className="wc-shopping-stories__heading"><div><p>SHOPPING STORY</p><h2 id="home-shopping-stories-title">쇼핑스토리</h2></div><Link href="/stories">전체 보기 →</Link></header>
    <ShoppingStoryCards stories={stories.slice(0, 3)} />
  </section>;
}
