import { Home } from '@/components/screens/Home';
import { getHomeSnapshot } from '@/lib/catalog';
import { loadHomeAnnouncementPopup } from '@/lib/goods-announcement-popup.server';
import { loadListingWishlist } from '@/lib/wishlist-ids.server';

export default async function Page() {
  const [home, announcementPopup, wishlist] = await Promise.all([
    getHomeSnapshot({ includeReviewSummaries: true, storefrontReadCache: true }),
    loadHomeAnnouncementPopup(),
    loadListingWishlist(),
  ]);

  return <Home curation={home.curation} announcementPopup={announcementPopup} wishlist={wishlist} />;
}
