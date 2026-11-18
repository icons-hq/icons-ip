import { notFound } from 'next/navigation';
import { Binder } from '@/components/screens/Binder';
import { getBinderCatalogOverlay, getCatalogSnapshot } from '@/lib/catalog';
import { readCardRewardsEnabled } from '@/lib/card-rewards/gate.server';
import { readCollectibleFeatures } from '@/lib/collectible-features.server';

/* 카드 바인더는 운영하지 않는다 — DB 공개 스위치(lib/collectible-features.ts)가 꺼진 동안 누구에게나(스태프 포함) 404이고,
   보유 카드를 읽기 전에 닫는다. 켜져 있으면 이전 바인더 그대로다. */
export default async function Page() {
  const features = await readCollectibleFeatures();
  if (!features.binder) notFound();
  const [catalog, cardRewardsEnabled] = await Promise.all([
    getCatalogSnapshot(),
    readCardRewardsEnabled(),
  ]);
  const overlay = catalog.source === 'supabase' ? await getBinderCatalogOverlay() : null;
  const cards = overlay
    ? [...new Map([...catalog.cards, ...overlay.cards].map((card) => [card.id, card])).values()]
    : catalog.cards;
  const ips = overlay
    ? [...new Map([...catalog.ips, ...overlay.ips].map((ip) => [ip.id, ip])).values()]
    : catalog.ips;

  return (
    <Binder
      cardRewardsEnabled={cardRewardsEnabled}
      exchangeEnabled={features.exchange}
      catalog={{ ...catalog, cards, ips }}
      ownedCardIds={overlay?.ownedCardIds ?? null}
    />
  );
}
