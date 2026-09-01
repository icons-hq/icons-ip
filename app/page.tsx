import { Home } from '@/components/screens/Home';
import { readCardRewardsEnabled } from '@/lib/card-rewards/gate.server';
import { getHomeSnapshot } from '@/lib/catalog';

export default async function Page() {
  const [home, cardRewardsEnabled] = await Promise.all([
    getHomeSnapshot(),
    readCardRewardsEnabled(),
  ]);

  return <Home cardRewardsEnabled={cardRewardsEnabled} curation={home.curation} />;
}
