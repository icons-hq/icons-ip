import { Home } from '@/components/screens/Home';
import { readCardRewardsEnabled } from '@/lib/card-rewards/gate.server';
import { getHomeSnapshot } from '@/lib/catalog';
import { loadHomeAnnouncementPopup } from '@/lib/goods-announcement-popup.server';
import { loadListingWishlist } from '@/lib/wishlist-ids.server';

export default async function Page() {
  const [home, cardRewardsEnabled, announcementPopup, wishlist] = await Promise.all([
    getHomeSnapshot({ includeReviewSummaries: true }),
    readCardRewardsEnabled(),
    loadHomeAnnouncementPopup(),
    loadListingWishlist(),
  ]);

  return <Home cardRewardsEnabled={cardRewardsEnabled} curation={home.curation} announcementPopup={announcementPopup} wishlist={wishlist} />;
}
