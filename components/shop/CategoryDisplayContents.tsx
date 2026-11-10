import Link from 'next/link';
import { HeroCarousel } from '@/components/wc/HeroCarousel';
import { ProductCollection } from '@/components/home/ProductCollection';
import { GoodsVideoPlayer } from './GoodsVideoPlayer';
import { imageBg } from '@/lib/media';
import { categoryDisplayHref } from '@/lib/routes';
import type { CategoryDisplayNavigation as NavigationEntry, CategoryDisplayPage } from '@/lib/category-display';

export function CategoryDisplayNavigation({ entries, currentId }: { entries: NavigationEntry[]; currentId?: string }) {
  if (!entries.length) return null;
  return <nav className="wc-category-display__navigation wc-container" aria-label="카테고리 전시">
    <Link href="/shop">전체 굿즈</Link>
    {entries.map(entry => <Link key={entry.id} href={categoryDisplayHref(entry.id)} aria-current={entry.id === currentId ? 'page' : undefined}
      data-depth={entry.depth}>{entry.name}</Link>)}
  </nav>;
}
export function CategoryDisplayContents({ page }: { page: CategoryDisplayPage }) {
  if (page.result.total === 0) return null;
  return <div className="wc-root wc-category-display">
    {page.banner ? <HeroCarousel slides={[page.banner]} className="wc-category-display__banner" /> : null}
    {page.video ? <section className="wc-category-display__video wc-container" aria-label="카테고리 동영상"><GoodsVideoPlayer asset={page.video.asset}
      fallbackBackground={page.video.poster ? imageBg(page.video.poster) : undefined} /><p>{page.video.asset.title}</p></section> : null}
    {page.recommendations ? <ProductCollection band={page.recommendations} /> : null}
  </div>;
}
