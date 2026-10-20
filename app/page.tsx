import { Home } from '@/components/screens/Home';
import { readCardRewardsEnabled } from '@/lib/card-rewards/gate.server';
import { getHomeSnapshot } from '@/lib/catalog';
import { loadHomeAnnouncementPopup } from '@/lib/goods-announcement-popup.server';

export default async function Page() {
  const [home, cardRewardsEnabled, announcementPopup] = await Promise.all([
    getHomeSnapshot(),
    readCardRewardsEnabled(),
    loadHomeAnnouncementPopup(),
  ]);

  return <Home cardRewardsEnabled={cardRewardsEnabled} curation={home.curation} announcementPopup={announcementPopup} />;
}
