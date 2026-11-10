/* eslint-disable @next/next/no-img-element -- Catalog media paths are verified by the artwork pipeline. */
import Link from 'next/link';
import { shoppingStoryHref, type PublicShoppingStorySummary } from '@/lib/shopping-stories';

export function ShoppingStoryCards({ stories }: { stories: PublicShoppingStorySummary[] }) {
  return <div className="wc-shopping-stories__grid">{stories.map(story => <article className="wc-shopping-story-card" key={story.id} data-text-only={!story.imageUrl}>
    <Link href={shoppingStoryHref(story.id)}>
      {story.imageUrl ? <div className="wc-shopping-story-card__image"><img src={story.imageUrl} alt="" loading="lazy" /></div> : null}
      <div className="wc-shopping-story-card__copy"><p>SHOPPING STORY</p><h2>{story.title}</h2>{story.description ? <p>{story.description}</p> : null}<span>스토리 보기 →</span></div>
    </Link></article>)}</div>;
}
